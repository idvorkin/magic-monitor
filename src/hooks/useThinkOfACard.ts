import { useCallback, useEffect, useRef, useState } from "react";
import {
	ThinkOfACardMachine,
	type ThinkOfACardRound,
	type ThinkOfACardState,
	type ThinkOfACardTrigger,
} from "../machines/ThinkOfACardMachine";
import { createCardPicker } from "../utils/cardPicker";
import { GestureHold } from "../utils/gestureHold";
import { anyHandIsVSign, type HandLandmark } from "../utils/handPose";

/**
 * Timing for the V-sign trigger.
 *
 * HOLD_MS: the pose has to survive this long before it fires. Hands pass
 * through V-ish shapes constantly while handling cards — a spread double-lift,
 * a two-card fan — and those are gone in a frame or two. 600ms is short enough
 * to feel instant when you mean it and long enough that incidental poses never
 * reach it.
 *
 * COOLDOWN_MS: after a round ends, the gesture is deaf this long. Without it,
 * a hand still sitting in a V when the card comes down instantly starts
 * another round. 2s is about how long it takes to lower a hand.
 *
 * GRACE_MS: how long the V may disappear without restarting the hold. The
 * classifier runs per frame and is not perfect — MediaPipe drops a blurred
 * hand for a frame, and a finger crossing the extension dead band reads as
 * neither extended nor curled. Without this, one bad frame in twenty resets
 * the 600ms clock and a genuinely held V never fires. 150ms is ~4 frames at
 * 30fps: long enough to bridge a dropout, far shorter than the time it takes
 * to actually lower a hand.
 */
export const V_GESTURE_CONFIG = {
	HOLD_MS: 600,
	COOLDOWN_MS: 2000,
	GRACE_MS: 150,
} as const;

interface UseThinkOfACardOptions {
	/**
	 * Live MediaPipe hand landmarks, written at frame rate by useHandLandmarks
	 * (directly, or through useSmartZoom when auto-framing is on).
	 * Omit (or leave empty) and only the key/button triggers work.
	 */
	landmarksRef?: React.RefObject<HandLandmark[][]>;
	/**
	 * Dimensions of the frame MediaPipe normalized its landmarks against —
	 * the processing canvas from `useHandLandmarks`/`useSmartZoom`. Read each
	 * tick and reduced to `aspect = width / height` so the V-sign spread angle
	 * is computed in an isotropic space; without this the same V would
	 * classify differently depending on the camera's tilt/aspect. Omit and
	 * the angle assumes a square frame (aspect 1), which is correct for the
	 * synthetic fixtures but wrong for any non-square production frame.
	 */
	processingResRef?: React.RefObject<{ width: number; height: number }>;
	/** Watch for the V sign. False while replaying, or when hand tracking is off. */
	gestureEnabled?: boolean;
}

/**
 * Runs think-of-a-card rounds: countdown, card reveal, and the V-sign trigger.
 *
 * State changes at most once a second, so plain useState is right here — the
 * rAF ref pattern is for 60fps data, and this is not that. Only the gesture
 * watcher runs per frame, and it writes to refs.
 */
export function useThinkOfACard(options: UseThinkOfACardOptions = {}) {
	const { landmarksRef, processingResRef, gestureEnabled = false } = options;

	const [state, setState] = useState<ThinkOfACardState>({ type: "idle" });

	// Rounds so far this page load. There is no session-event store in the app
	// to hang these off yet, so they live here and in the console.
	const roundsRef = useRef<ThinkOfACardRound[]>([]);

	// Gesture debounce, driven from the rAF loop below.
	const gestureHoldRef = useRef<GestureHold | null>(null);
	gestureHoldRef.current ??= new GestureHold({
		holdMs: V_GESTURE_CONFIG.HOLD_MS,
		cooldownMs: V_GESTURE_CONFIG.COOLDOWN_MS,
		graceMs: V_GESTURE_CONFIG.GRACE_MS,
	});

	const machineRef = useRef<ThinkOfACardMachine | null>(null);
	if (machineRef.current === null) {
		const picker = createCardPicker();
		machineRef.current = new ThinkOfACardMachine({
			pickCard: picker.pick,
			onStateChange: (next) => {
				setState(next);
				// A round that ended by key, tap or timeout also starts the
				// cooldown, so a hand still held in a V doesn't restart it.
				if (next.type === "idle") {
					gestureHoldRef.current?.startCooldown(performance.now());
				}
			},
			onRoundRevealed: (round) => {
				roundsRef.current.push(round);
				console.log("[ThinkOfACard] round", {
					card: round.label,
					trigger: round.trigger,
					startedAt: new Date(round.startedAt).toISOString(),
					countdownMs: round.revealedAt - round.startedAt,
				});
			},
		});
	}

	useEffect(() => {
		const machine = machineRef.current;
		return () => machine?.destroy();
	}, []);

	const start = useCallback((trigger: ThinkOfACardTrigger) => {
		machineRef.current?.start(trigger);
	}, []);

	const dismiss = useCallback(() => {
		machineRef.current?.dismiss();
	}, []);

	const toggle = useCallback((trigger: ThinkOfACardTrigger) => {
		machineRef.current?.toggle(trigger);
	}, []);

	const getRounds = useCallback(() => [...roundsRef.current], []);

	// V-sign watcher. Reads landmarks from the ref every frame; never renders.
	useEffect(() => {
		if (!gestureEnabled || !landmarksRef) return;

		let rafId = 0;

		const watch = () => {
			const machine = machineRef.current;
			const hold = gestureHoldRef.current;
			// Reduce the processing frame to its aspect ratio. MediaPipe
			// normalizes x by width and y by height, so the spread angle is
			// only tilt-invariant once y is rescaled to the x/z (per-width)
			// units — see `fingerSpreadDegrees`. A square or unknown frame
			// (ref absent, or height not yet measured) fall back to aspect 1.
			const res = processingResRef?.current;
			const aspect = res && res.height > 0 ? res.width / res.height : 1;
			// A round already running counts as "no gesture" so the hold clock
			// restarts cleanly once it ends.
			const showingV =
				machine !== null &&
				!machine.isBusy() &&
				anyHandIsVSign(landmarksRef.current, aspect);

			if (hold?.update(showingV, performance.now())) {
				machine?.start("gesture");
			}

			rafId = requestAnimationFrame(watch);
		};

		watch();

		return () => {
			cancelAnimationFrame(rafId);
			gestureHoldRef.current?.reset();
		};
	}, [gestureEnabled, landmarksRef, processingResRef]);

	return {
		state,
		isActive: state.type !== "idle",
		start,
		dismiss,
		toggle,
		getRounds,
	};
}

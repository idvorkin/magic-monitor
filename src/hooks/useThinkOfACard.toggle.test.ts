import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HandLandmark } from "../utils/handPose";
import { V_SIGN } from "../utils/handPose.fixtures";
import { useThinkOfACard, V_GESTURE_CONFIG } from "./useThinkOfACard";

/**
 * Bug b70d230 regression: CameraStage swaps the landmarksRef identity on a
 * smart-zoom toggle (between smartZoom.debugLandmarksRef and
 * gestureLandmarks.landmarksRef). Because that ref is in the watcher
 * effect's dependency array, the effect tears down mid-hold. The teardown
 * used to call gestureHoldRef.current?.reset(), wiping an in-progress V
 * hold even though the hand never left the frame — so the hold clock
 * restarted from zero and the gesture fired ~HOLD_MS late.
 *
 * The grace window (GRACE_MS) now bridges the ref-source swap; the
 * stale-hold guard is keyed to gestureEnabled alone (see the hook source).
 * These cases must hold with a properly-cancelling rAF mock so the watcher
 * loop does not leak across the swap.
 */
describe("useThinkOfACard toggle-mid-hold", () => {
	let rafCallbacks: Map<number, FrameRequestCallback>;
	let nextRafId: number;
	let clock = 0;

	beforeEach(() => {
		rafCallbacks = new Map();
		nextRafId = 0;
		clock = 0;
		// Properly-cancelling rAF mock: the production watcher schedules the
		// next frame with a real id and cancels it in the effect teardown.
		// A no-op cancelAnimationFrame would let the outgoing watcher's
		// pending frame fire after a ref swap (reading the stale, still
		// populated old ref), which masks the grace-window behaviour.
		vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
			const id = ++nextRafId;
			rafCallbacks.set(id, cb);
			return id;
		});
		vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => {
			rafCallbacks.delete(id);
		});
		vi.spyOn(performance, "now").mockImplementation(() => clock);
		vi.spyOn(console, "log").mockImplementation(() => {});
	});

	afterEach(() => vi.restoreAllMocks());

	const tick = (deltaMs = 33) => {
		const pending = [...rafCallbacks.values()];
		rafCallbacks.clear();
		act(() => {
			for (const cb of pending) cb(clock);
		});
		clock += deltaMs;
	};

	const holdFor = (ms: number) => {
		const until = clock + ms;
		while (clock < until) tick();
		tick();
	};

	it("should keep an in-progress V hold across a landmarks-ref swap (smart-zoom toggle)", () => {
		const refA: React.RefObject<HandLandmark[][]> = { current: [V_SIGN] };
		const refB: React.RefObject<HandLandmark[][]> = { current: [V_SIGN] };

		const rendered = renderHook(
			({ landmarksRef }: { landmarksRef: React.RefObject<HandLandmark[][]> }) =>
				useThinkOfACard({ landmarksRef, gestureEnabled: true }),
			{ initialProps: { landmarksRef: refA } },
		);

		holdFor(V_GESTURE_CONFIG.HOLD_MS - 50);
		expect(rendered.result.current.isActive).toBe(false);

		rendered.rerender({ landmarksRef: refB });
		holdFor(100);

		expect(rendered.result.current.isActive).toBe(true);
	});

	it("should carry an in-progress hold across a ref swap when the new ref emits a V within GRACE_MS", () => {
		const refA: React.RefObject<HandLandmark[][]> = { current: [V_SIGN] };
		const refB: React.RefObject<HandLandmark[][]> = { current: [] };

		const rendered = renderHook(
			({ landmarksRef }: { landmarksRef: React.RefObject<HandLandmark[][]> }) =>
				useThinkOfACard({ landmarksRef, gestureEnabled: true }),
			{ initialProps: { landmarksRef: refA } },
		);

		holdFor(500);
		expect(rendered.result.current.isActive).toBe(false);

		rendered.rerender({ landmarksRef: refB });
		tick();
		tick(); // ~66ms of empty frames, inside the 150ms grace window

		refB.current = [V_SIGN];
		holdFor(100); // total hold ~566ms

		expect(rendered.result.current.isActive).toBe(true);
	});

	it("should restart the hold fresh if the new ref is empty longer than GRACE_MS", () => {
		const refA: React.RefObject<HandLandmark[][]> = { current: [V_SIGN] };
		const refB: React.RefObject<HandLandmark[][]> = { current: [] };

		const rendered = renderHook(
			({ landmarksRef }: { landmarksRef: React.RefObject<HandLandmark[][]> }) =>
				useThinkOfACard({ landmarksRef, gestureEnabled: true }),
			{ initialProps: { landmarksRef: refA } },
		);

		holdFor(500);
		rendered.rerender({ landmarksRef: refB });
		holdFor(V_GESTURE_CONFIG.GRACE_MS + 100); // empty > 150ms -> grace expires

		refB.current = [V_SIGN];
		holdFor(V_GESTURE_CONFIG.HOLD_MS - 200); // fresh hold, only 400ms -> no fire
		expect(rendered.result.current.isActive).toBe(false);

		holdFor(200); // 600ms total -> fires
		expect(rendered.result.current.isActive).toBe(true);
	});

	it("should not leave a stale hold that fires on re-entry when leaving live mode", () => {
		const ref: React.RefObject<HandLandmark[][]> = { current: [V_SIGN] };

		const rendered = renderHook(
			({ gestureEnabled }: { gestureEnabled: boolean }) =>
				useThinkOfACard({ landmarksRef: ref, gestureEnabled }),
			{ initialProps: { gestureEnabled: true } },
		);

		holdFor(300);
		rendered.rerender({ gestureEnabled: false });

		clock += 10_000; // 10s in another app state, ref stays populated

		rendered.rerender({ gestureEnabled: true });
		tick();
		expect(rendered.result.current.isActive).toBe(false); // not a stale fire

		holdFor(V_GESTURE_CONFIG.HOLD_MS);
		expect(rendered.result.current.isActive).toBe(true);
	});
});

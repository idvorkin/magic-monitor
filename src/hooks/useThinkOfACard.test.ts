import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HandLandmark } from "../utils/handPose";
import { FIST, V_SIGN } from "../utils/handPose.fixtures";
import { useThinkOfACard, V_GESTURE_CONFIG } from "./useThinkOfACard";

/**
 * The gesture watcher is the glue between the landmark producer and the round
 * machine. handPose and GestureHold are unit-tested on their own; what is
 * tested here is that a V sitting in the ref actually starts a round, and that
 * it stops doing so when the watcher is off.
 */
describe("useThinkOfACard gesture watcher", () => {
	let frameCallbacks: FrameRequestCallback[] = [];
	let clock = 0;

	beforeEach(() => {
		frameCallbacks = [];
		clock = 0;
		vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
			frameCallbacks.push(cb);
			return frameCallbacks.length;
		});
		vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
		vi.spyOn(performance, "now").mockImplementation(() => clock);
		vi.spyOn(console, "log").mockImplementation(() => {});
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	/** Run one rAF tick at `clock`, then advance the clock. */
	const tick = (deltaMs = 33) => {
		const pending = frameCallbacks;
		frameCallbacks = [];
		act(() => {
			for (const cb of pending) cb(clock);
		});
		clock += deltaMs;
	};

	const render = (
		landmarks: HandLandmark[][],
		gestureEnabled = true,
	): { landmarksRef: React.RefObject<HandLandmark[][]> } & ReturnType<
		typeof renderHook<ReturnType<typeof useThinkOfACard>, unknown>
	> => {
		const landmarksRef = { current: landmarks };
		const rendered = renderHook(() =>
			useThinkOfACard({ landmarksRef, gestureEnabled }),
		);
		return { landmarksRef, ...rendered };
	};

	/** Run frames for `ms`, landing one final frame at or past the boundary. */
	const holdFor = (ms: number) => {
		const until = clock + ms;
		while (clock < until) tick();
		tick();
	};

	it("starts a round once the V has been held long enough", () => {
		const { result } = render([V_SIGN]);
		expect(result.current.isActive).toBe(false);

		holdFor(V_GESTURE_CONFIG.HOLD_MS);

		expect(result.current.isActive).toBe(true);
		expect(result.current.state.type).toBe("countdown");
	});

	it("does not start a round from a hand that is not a V", () => {
		const { result } = render([FIST]);

		holdFor(V_GESTURE_CONFIG.HOLD_MS * 2);

		expect(result.current.isActive).toBe(false);
	});

	it("ignores the V entirely when the watcher is disabled", () => {
		const { result } = render([V_SIGN], false);

		holdFor(V_GESTURE_CONFIG.HOLD_MS * 2);

		expect(result.current.isActive).toBe(false);
	});

	it("does not fire before the hold window elapses", () => {
		const { result } = render([V_SIGN]);

		holdFor(V_GESTURE_CONFIG.HOLD_MS - 100);

		expect(result.current.isActive).toBe(false);
	});

	it("still fires when a frame or two drops the hand", () => {
		const { landmarksRef, result } = render([V_SIGN]);

		// Two frames (66ms, inside the grace window) where MediaPipe found nothing.
		holdFor(300);
		landmarksRef.current = [];
		tick();
		tick();
		landmarksRef.current = [V_SIGN];
		holdFor(V_GESTURE_CONFIG.HOLD_MS - 400);

		expect(result.current.isActive).toBe(true);
	});

	it("restarts the hold when the hand is away longer than the grace window", () => {
		const { landmarksRef, result } = render([V_SIGN]);

		holdFor(500);
		landmarksRef.current = [];
		holdFor(V_GESTURE_CONFIG.GRACE_MS + 100);
		landmarksRef.current = [V_SIGN];
		// The 500ms already banked is gone, so this alone is not enough.
		holdFor(V_GESTURE_CONFIG.HOLD_MS - 200);

		expect(result.current.isActive).toBe(false);
	});

	it("leaves the key and button triggers working with no landmarks at all", () => {
		const { result } = renderHook(() => useThinkOfACard());

		act(() => result.current.start("key"));

		expect(result.current.state.type).toBe("countdown");
	});
});

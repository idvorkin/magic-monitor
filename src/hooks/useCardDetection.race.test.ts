import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CardDetection } from "../types/cards";
import { useCardDetection } from "./useCardDetection";

// Regression coverage for the disable-during-in-flight race in useCardDetection.
// `CardDetectorService.detect` has no AbortSignal; before the fix, its
// post-`await` continuation unconditionally wrote `detectionsRef.current` (and
// conditionally `setDetections`, gated on `frameCountRef.current % 3 === 0`)
// even after the effect's cleanup set `running = false`. That clobbered the
// disable-clear effect's `[]` reset with the pre-disable frame's stale
// results, which then flashed in `CardOverlay`/`CardList` on re-enable. The
// fix re-checks `running` immediately after the `await`. These tests drive the
// bug ordering explicitly (resolve lands strictly *after* the disable-clear
// effect flushes) and assert the stale writes no longer occur.
//
// Harness mirrors src/hooks/useCardDetection.test.ts (same mocking style,
// rAF capture, async `advanceFrame` with triple `await Promise.resolve()` to
// settle the awaited `CardDetectorService.detect()` microtask chain).

const mockDetect = vi.fn();
const mockIsReady = vi.fn();
const mockSubscribe = vi.fn();
const mockLoad = vi.fn();

vi.mock("../services/CardDetectorService", () => ({
	CardDetectorService: {
		isReady: (...args: unknown[]) => mockIsReady(...args),
		detect: (...args: unknown[]) => mockDetect(...args),
		subscribe: (...args: unknown[]) => mockSubscribe(...args),
		load: (...args: unknown[]) => mockLoad(...args),
	},
}));

const makeDetection = (label: string): CardDetection => ({
	card: { rank: "A", suit: "\u2660" },
	label,
	bbox: { x: 0.5, y: 0.5, width: 0.1, height: 0.1 },
	confidence: 0.99,
});

describe("useCardDetection disable race (post-await running re-check)", () => {
	let videoElement: HTMLVideoElement;
	let videoRefObj: { current: HTMLVideoElement | null };
	let frameCallback: FrameRequestCallback | null = null;

	beforeEach(() => {
		mockIsReady.mockReturnValue(true);
		mockSubscribe.mockReturnValue(() => {});
		mockLoad.mockResolvedValue(undefined);
		mockDetect.mockReset();

		videoElement = document.createElement("video");
		Object.defineProperty(videoElement, "paused", {
			value: false,
			configurable: true,
		});
		Object.defineProperty(videoElement, "ended", {
			value: false,
			configurable: true,
		});
		Object.defineProperty(videoElement, "readyState", {
			value: 4,
			configurable: true,
		});
		Object.defineProperty(videoElement, "videoWidth", {
			value: 1920,
			configurable: true,
		});
		Object.defineProperty(videoElement, "currentTime", {
			value: 0,
			writable: true,
		});

		// Stable ref object across re-renders (a fresh `{ current }` literal
		// inside renderHook would change identity per render and re-trigger the
		// detection effect, resetting frameCountRef and breaking the parity
		// math these tests rely on).
		videoRefObj = { current: videoElement };

		frameCallback = null;
		vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
			frameCallback = cb;
			return 1;
		});
		vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	const advanceFrame = async (timeDelta = 16) => {
		const cb = frameCallback;
		if (!cb) return;
		videoElement.currentTime += timeDelta / 1000;
		await act(async () => {
			cb(performance.now());
			await Promise.resolve();
			await Promise.resolve();
			await Promise.resolve();
		});
	};

	it("does NOT clobber detectionsRef.current when an in-flight detect resolves after disable (frameCount=2, ref only)", async () => {
		let resolveDetect: (val: CardDetection[]) => void = () => {};
		mockDetect.mockImplementation(
			() =>
				new Promise<CardDetection[]>((resolve) => {
					resolveDetect = resolve;
				}),
		);
		const STALE: CardDetection[] = [makeDetection("STALE_CARD")];

		const { result, rerender } = renderHook(
			({ enabled }: { enabled: boolean }) =>
				useCardDetection({ videoRef: videoRefObj, enabled }),
			{ initialProps: { enabled: true } },
		);

		// Mount: frameCountRef 0->1 (odd, skip), schedules rAF.
		await act(async () => {
			await Promise.resolve();
		});
		// advanceFrame #1: currentTime 0->0.016, frameCountRef 1->2 (even) -> detect() pending.
		await advanceFrame();
		expect(mockDetect).toHaveBeenCalledTimes(1);

		// Disable while detect() is in flight. The disable-clear effect runs
		// in this commit (before the awaited promise's microtask), resetting
		// both ref and state to [].
		rerender({ enabled: false });
		expect(result.current.detections).toEqual([]);
		expect(result.current.detectionsRef.current).toEqual([]);

		// Now the in-flight detect() resolves AFTER the disable clear. Before
		// the fix this unconditionally clobbered the ref. With the fix, the
		// post-`await` `if (!running) return;` suppresses the write.
		await act(async () => {
			resolveDetect(STALE);
			await Promise.resolve();
			await Promise.resolve();
			await Promise.resolve();
		});

		// FIX: ref is preserved as [] (stale write suppressed).
		expect(result.current.detectionsRef.current).toEqual([]);
		// State was never going to be written here (frameCount=2, 2%3!==0) and
		// remains [].
		expect(result.current.detections).toEqual([]);
	});

	it("does NOT clobber detections state when an in-flight detect resolves after disable on a %3 frame (frameCount=3)", async () => {
		let resolveDetect: (val: CardDetection[]) => void = () => {};
		mockDetect.mockImplementation(
			() =>
				new Promise<CardDetection[]>((resolve) => {
					resolveDetect = resolve;
				}),
		);
		const STALE: CardDetection[] = [makeDetection("STALE_CARD")];

		const { result, rerender } = renderHook(
			({ enabled }: { enabled: boolean }) =>
				useCardDetection({ videoRef: videoRefObj, enabled }),
			{ initialProps: { enabled: true } },
		);

		await act(async () => {
			await Promise.resolve();
		});
		// advanceFrame #1: frameCountRef 1->2 (even) -> detect() pending.
		await advanceFrame();
		// advanceFrame #2: frameCountRef 2->3 (odd, skip), reschedules rAF.
		// frameCountRef.current is now 3, so had the post-`await` continuation
		// run, `setDetections(STALE)` would have fired (3%3==0).
		await advanceFrame();
		expect(mockDetect).toHaveBeenCalledTimes(1);

		rerender({ enabled: false });
		expect(result.current.detections).toEqual([]);
		expect(result.current.detectionsRef.current).toEqual([]);

		await act(async () => {
			resolveDetect(STALE);
			await Promise.resolve();
			await Promise.resolve();
			await Promise.resolve();
		});

		// FIX: BOTH halves preserved as [] (stale write suppressed before the
		// unconditional ref write AND before the %3-gated state write).
		expect(result.current.detectionsRef.current).toEqual([]);
		expect(result.current.detections).toEqual([]);
	});

	it("produces no stale flash on re-enable after a disable-during-in-flight", async () => {
		let resolveDetect: (val: CardDetection[]) => void = () => {};
		mockDetect.mockImplementation(
			() =>
				new Promise<CardDetection[]>((resolve) => {
					resolveDetect = resolve;
				}),
		);
		const STALE: CardDetection[] = [makeDetection("STALE_CARD")];

		const { result, rerender } = renderHook(
			({ enabled }: { enabled: boolean }) =>
				useCardDetection({ videoRef: videoRefObj, enabled }),
			{ initialProps: { enabled: true } },
		);

		await act(async () => {
			await Promise.resolve();
		});
		await advanceFrame(); // frameCountRef 1->2 (even) -> detect() pending
		await advanceFrame(); // frameCountRef 2->3 (odd, skip)
		expect(mockDetect).toHaveBeenCalledTimes(1);

		// Disable while detect in flight; disable-clear runs, then the
		// in-flight detect resolves (would clobber both halves pre-fix).
		rerender({ enabled: false });
		expect(result.current.detections).toEqual([]);
		expect(result.current.detectionsRef.current).toEqual([]);

		await act(async () => {
			resolveDetect(STALE);
			await Promise.resolve();
			await Promise.resolve();
			await Promise.resolve();
		});

		// FIX: nothing lodged while disabled.
		expect(result.current.detectionsRef.current).toEqual([]);
		expect(result.current.detections).toEqual([]);

		// Re-enable. New effect closure runs; new detects resolve with [].
		// frameCountRef (3) and lastVideoTimeRef (0.032) persist across
		// re-enable. First synchronous detect() on re-enable finds
		// currentTime==lastVideoTime (0.032) and skips.
		mockDetect.mockResolvedValue([]);
		rerender({ enabled: true });
		await act(async () => {
			await Promise.resolve();
		});

		// FIX: on the re-enable commit the ref/state are already [] (no stale
		// flash). Previously the bug left STALE lodged here and the consumer
		// (`CardOverlay`/`CardList`) would paint it for up to 3 rAF ticks.
		expect(result.current.detectionsRef.current).toEqual([]);
		expect(result.current.detections).toEqual([]);

		// Drive several post-re-enable frames; values stay [] throughout —
		// nothing stale ever surfaces.
		await advanceFrame(); // frameCountRef 3->4 (even), detect resolves [], 4%3!==0
		expect(result.current.detectionsRef.current).toEqual([]);
		expect(result.current.detections).toEqual([]);

		await advanceFrame(); // 4->5 (odd, skip)
		await advanceFrame(); // 5->6 (even, 6%3==0 -> setDetections([]))
		expect(result.current.detectionsRef.current).toEqual([]);
		expect(result.current.detections).toEqual([]);

		// 1 pre-disable detect (still pending/in-flight, resolved manually) +
		// 2 post-re-enable detects (resolved immediately with []).
		expect(mockDetect).toHaveBeenCalledTimes(3);
	});

	it("still writes detectionsRef.current for an in-flight detect that resolves while enabled (fix does not over-suppress)", async () => {
		// Guards against the fix being too aggressive: a legitimate in-flight
		// detect that resolves while the loop is still running must still
		// write the ref and reschedule the next rAF.
		let resolveDetect: (val: CardDetection[]) => void = () => {};
		mockDetect.mockImplementation(
			() =>
				new Promise<CardDetection[]>((resolve) => {
					resolveDetect = resolve;
				}),
		);
		const FRESH: CardDetection[] = [makeDetection("FRESH_CARD")];

		const { result } = renderHook(
			({ enabled }: { enabled: boolean }) =>
				useCardDetection({ videoRef: videoRefObj, enabled }),
			{ initialProps: { enabled: true } },
		);

		await act(async () => {
			await Promise.resolve();
		});
		// frameCountRef 1->2 (even) -> detect() pending. 2%3!==0, so a state
		// write is NOT expected even on a successful resolve (throttle).
		await advanceFrame();
		expect(mockDetect).toHaveBeenCalledTimes(1);

		const rafSpy = vi.mocked(window.requestAnimationFrame);
		const rafCallsBeforeResolve = rafSpy.mock.calls.length;

		// Resolve while still enabled — the post-await guard passes
		// (running is still true) and the legitimate writes proceed.
		await act(async () => {
			resolveDetect(FRESH);
			await Promise.resolve();
			await Promise.resolve();
			await Promise.resolve();
		});

		// Ref is written with the fresh results.
		expect(result.current.detectionsRef.current).toEqual(FRESH);
		// State throttle: 2%3!==0, so setDetections was NOT called.
		expect(result.current.detections).toEqual([]);
		// The loop scheduled the next rAF (not torn down).
		expect(rafSpy.mock.calls.length).toBeGreaterThan(rafCallsBeforeResolve);
		expect(frameCallback).not.toBeNull();

		// Driving the next frame keeps the loop alive — running is still true,
		// frameCountRef 2->3 (odd, skip) just reschedules.
		await advanceFrame();
		expect(mockDetect).toHaveBeenCalledTimes(1); // no new detect on odd frame
		expect(frameCallback).not.toBeNull();
	});

	it("still throttles detections state updates to %3 frames while enabled stays true", async () => {
		// Confirms the %3 UI_UPDATE_INTERVAL throttle continues to gate state
		// writes on the happy path (the fix must not alter the throttle).
		// frameCount 6 is the first even frame that is also a multiple of 3.
		const CARD: CardDetection[] = [makeDetection("CARD")];
		mockDetect.mockResolvedValue(CARD);

		const { result } = renderHook(
			({ enabled }: { enabled: boolean }) =>
				useCardDetection({ videoRef: videoRefObj, enabled }),
			{ initialProps: { enabled: true } },
		);

		await act(async () => {
			await Promise.resolve();
		});

		// Mount: frameCount 0->1 (odd, skip).
		// #1: 1->2 (even, 2%3!==0) detect; ref set, state NOT set.
		await advanceFrame();
		expect(result.current.detectionsRef.current).toEqual(CARD);
		expect(result.current.detections).toEqual([]);

		// #2: 2->3 (odd, skip).
		await advanceFrame();
		// #3: 3->4 (even, 4%3!==0) detect; ref set, state NOT set.
		await advanceFrame();
		expect(result.current.detections).toEqual([]);

		// #4: 4->5 (odd, skip).
		await advanceFrame();
		// #5: 5->6 (even, 6%3==0) detect; ref set AND state set.
		await advanceFrame();
		expect(result.current.detectionsRef.current).toEqual(CARD);
		expect(result.current.detections).toEqual(CARD);
	});

	it("does not schedule a lone rAF tick after teardown races with an in-flight detect", async () => {
		// With the fix, the post-`await` `if (!running) return;` also prevents
		// the trailing `requestRef.current = requestAnimationFrame(...)` from
		// being scheduled once the detect resolves after teardown. Before the
		// fix, that lone post-teardown rAF was allocated (harmless because
		// detect() re-checks `running` at its top, but unnecessary). We assert
		// no new rAF is scheduled by the late continuation.
		let resolveDetect: (val: CardDetection[]) => void = () => {};
		mockDetect.mockImplementation(
			() =>
				new Promise<CardDetection[]>((resolve) => {
					resolveDetect = resolve;
				}),
		);
		const STALE: CardDetection[] = [makeDetection("STALE_CARD")];

		const { rerender } = renderHook(
			({ enabled }: { enabled: boolean }) =>
				useCardDetection({ videoRef: videoRefObj, enabled }),
			{ initialProps: { enabled: true } },
		);

		await act(async () => {
			await Promise.resolve();
		});
		await advanceFrame(); // frameCountRef 1->2 (even) -> detect() pending
		expect(mockDetect).toHaveBeenCalledTimes(1);

		const rafSpy = vi.mocked(window.requestAnimationFrame);
		const rafCallsAtDisable = rafSpy.mock.calls.length;

		// Disable while in flight; teardown cancels the pending rAF and sets
		// running=false. No new rAF should be scheduled between here and the
		// late resolve.
		rerender({ enabled: false });

		await act(async () => {
			resolveDetect(STALE);
			await Promise.resolve();
			await Promise.resolve();
			await Promise.resolve();
		});

		// FIX: the late continuation returned at the post-`await` guard and did
		// NOT schedule a leftover rAF (otherwise calls.length would exceed the
		// count captured at disable).
		expect(rafSpy.mock.calls.length).toBe(rafCallsAtDisable);
	});
});

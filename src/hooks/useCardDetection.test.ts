import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCardDetection } from "./useCardDetection";

// Mock CardDetectorService (module-level, per useSmartZoom.test.ts's pattern for
// HandLandmarkerService's underlying @mediapipe/tasks-vision mock).
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

describe("useCardDetection", () => {
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
		// HAVE_ENOUGH_DATA + non-zero width - matches a real post-loadedmetadata
		// camera stream. The pre-metadata guard test below builds its own mock
		// video with a lower readyState / zero width instead of overriding these.
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

		// Stable ref object across re-renders — a fresh `{ current }` literal
		// created inside the renderHook callback would change identity on every
		// re-render and re-trigger the detection effect (it's in that effect's
		// deps), which would reset frameCountRef and break the frame-parity math
		// the tests below rely on.
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

	// Advances the video clock and fires the pending rAF callback, then flushes
	// microtasks so the awaited CardDetectorService.detect() promise (and any
	// resulting state updates) settle before we assert.
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

	it("survives a rejected detect() and keeps the loop alive (M2)", async () => {
		// detect rejects once, then resolves with []
		mockDetect.mockRejectedValueOnce(new Error("boom")).mockResolvedValue([]);

		const { result } = renderHook(() =>
			useCardDetection({ videoRef: videoRefObj, enabled: true }),
		);

		// Mount call: frameCountRef -> 1 (odd), detect() is skipped, loop schedules once.
		await act(async () => {
			await Promise.resolve();
		});
		expect(frameCallback).not.toBeNull();

		const rafSpy = vi.mocked(window.requestAnimationFrame);
		const rafCallsBeforeFrame = rafSpy.mock.calls.length;

		// frame1: frameCountRef -> 2 (even) -> CardDetectorService.detect() rejects
		await advanceFrame();

		expect(mockDetect).toHaveBeenCalledTimes(1);
		// The loop must still be alive: rAF was scheduled again despite the rejection.
		expect(rafSpy.mock.calls.length).toBeGreaterThan(rafCallsBeforeFrame);
		expect(frameCallback).not.toBeNull();

		await waitFor(() => {
			expect(result.current.detectError).toBe("boom");
		});

		// frame2 (part a): frameCountRef -> 3 (odd), skip detect, just reschedule.
		await advanceFrame();
		// frame2 (part b): frameCountRef -> 4 (even) -> detect() resolves with [].
		await advanceFrame();

		expect(mockDetect).toHaveBeenCalledTimes(2);
		await waitFor(() => {
			expect(result.current.detectError).toBeNull();
		});
	});

	it("exposes the rejection via detectError while the loop continues", async () => {
		// detect always rejects
		mockDetect.mockRejectedValue(new Error("still broken"));

		const { result } = renderHook(() =>
			useCardDetection({ videoRef: videoRefObj, enabled: true }),
		);

		await act(async () => {
			await Promise.resolve();
		});

		const rafSpy = vi.mocked(window.requestAnimationFrame);

		// Drive frame 1: frameCountRef -> 2 (even) -> first rejection.
		await advanceFrame();
		const rafCallsAfterFrame1 = rafSpy.mock.calls.length;
		await waitFor(() => {
			expect(result.current.detectError).toBe("still broken");
		});

		// Drive frame 2: frameCountRef -> 3 (odd, skip) then -> 4 (even) -> second rejection.
		await advanceFrame();
		await advanceFrame();

		expect(mockDetect).toHaveBeenCalledTimes(2);
		// Queue length keeps growing each drive — the loop never dies.
		expect(rafSpy.mock.calls.length).toBeGreaterThan(rafCallsAfterFrame1);
		expect(result.current.detectError).toBe("still broken");
	});

	it("should skip detection for dimensionless pre-metadata frames", async () => {
		// A video before `loadedmetadata` reports videoWidth 0 and readyState
		// HAVE_METADATA(1) or lower. Calling detect() on a 0x0 frame crashes the
		// ONNX/MediaPipe WASM in production; here we assert CardDetectorService
		// .detect is never called until dimensions are real. Uses its own mock
		// (mutable getters) instead of the shared `videoElement`, whose
		// videoWidth/readyState are fixed via the beforeEach above.
		mockDetect.mockResolvedValue([]);

		let mockWidth = 0;
		let mockReadyState = 1; // HAVE_METADATA, no frame data yet
		const preMetadataVideo = document.createElement("video");
		Object.defineProperty(preMetadataVideo, "videoWidth", { get: () => mockWidth });
		Object.defineProperty(preMetadataVideo, "readyState", { get: () => mockReadyState });
		Object.defineProperty(preMetadataVideo, "paused", { value: false });
		Object.defineProperty(preMetadataVideo, "ended", { value: false });
		Object.defineProperty(preMetadataVideo, "currentTime", {
			value: 0,
			writable: true,
		});
		const preMetadataRefObj = { current: preMetadataVideo };

		renderHook(() =>
			useCardDetection({ videoRef: preMetadataRefObj, enabled: true }),
		);

		await act(async () => {
			await Promise.resolve();
		});

		const advancePreMetadataFrame = async (timeDelta = 16) => {
			const cb = frameCallback;
			if (!cb) return;
			preMetadataVideo.currentTime += timeDelta / 1000;
			await act(async () => {
				cb(performance.now());
				await Promise.resolve();
				await Promise.resolve();
				await Promise.resolve();
			});
		};

		// Drive several frames - frameCountRef increments on each, so this
		// covers both odd (always-skip) and even (would-detect) frame parities.
		for (let i = 0; i < 6; i++) {
			await advancePreMetadataFrame();
		}

		expect(mockDetect).not.toHaveBeenCalled();

		// loadedmetadata fires: real dimensions and enough data to decode a frame.
		mockWidth = 1920;
		mockReadyState = 4;

		await advancePreMetadataFrame();
		await advancePreMetadataFrame();

		expect(mockDetect).toHaveBeenCalled();
	});
});

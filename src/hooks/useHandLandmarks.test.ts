import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HandLandmarkerService } from "../services/HandLandmarkerService";
import type { HandLandmark } from "../utils/handPose";
import {
	computeProcessingDimensions,
	useHandLandmarks,
} from "./useHandLandmarks";

// Mock MediaPipe
const mockDetectForVideo = vi.fn();
const mockClose = vi.fn();

vi.mock("@mediapipe/tasks-vision", () => ({
	FilesetResolver: {
		forVisionTasks: vi.fn().mockResolvedValue("mock-vision-source"),
	},
	HandLandmarker: {
		createFromOptions: vi.fn().mockResolvedValue({
			detectForVideo: (...args: unknown[]) => mockDetectForVideo(...args),
			close: () => mockClose(),
		}),
	},
}));

/** A hand whose landmarks are far enough apart to be distinguishable. */
const HAND: HandLandmark[] = [
	{ x: 0.375, y: 0.375, z: 0 },
	{ x: 0.625, y: 0.625, z: 0 },
];

describe("useHandLandmarks", () => {
	let videoElement: HTMLVideoElement;
	// Stable across renders, as CameraStage's useRef is. A fresh object literal
	// each render would restart the detection effect and mask real regressions.
	let videoRef: React.RefObject<HTMLVideoElement | null>;
	let frameCallback: FrameRequestCallback | null = null;

	beforeEach(() => {
		vi.useFakeTimers();
		HandLandmarkerService._reset();

		globalThis.fetch = vi.fn().mockResolvedValue({
			ok: true,
			headers: { get: vi.fn().mockReturnValue("8192000") },
			body: {
				getReader: vi.fn().mockReturnValue({
					read: vi
						.fn()
						.mockResolvedValueOnce({ done: false, value: new Uint8Array(1024) })
						.mockResolvedValueOnce({ done: true }),
				}),
			},
		});

		videoElement = document.createElement("video");
		Object.defineProperty(videoElement, "videoWidth", { value: 1920 });
		Object.defineProperty(videoElement, "videoHeight", { value: 1080 });
		Object.defineProperty(videoElement, "paused", { value: false });
		Object.defineProperty(videoElement, "ended", { value: false });
		Object.defineProperty(videoElement, "readyState", { value: 4 });
		Object.defineProperty(videoElement, "currentTime", {
			value: 0,
			writable: true,
		});
		videoRef = { current: videoElement };

		frameCallback = null;
		vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
			frameCallback = cb;
			return 1;
		});
		vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});

		mockDetectForVideo.mockReturnValue({ landmarks: [] });
	});

	afterEach(() => {
		vi.clearAllMocks();
		vi.useRealTimers();
	});

	const advanceFrame = (timeDelta = 16) => {
		if (!frameCallback) return;
		videoElement.currentTime += timeDelta / 1000;
		act(() => {
			frameCallback?.(performance.now());
		});
	};

	/** Render the hook and wait for the mocked model load to settle. */
	const renderLoaded = async (
		options: Partial<Parameters<typeof useHandLandmarks>[0]> = {},
	) => {
		const rendered = renderHook(
			(props: { enabled: boolean }) =>
				useHandLandmarks({
					videoRef,
					enabled: props.enabled,
					...options,
				}),
			{ initialProps: { enabled: options.enabled ?? true } },
		);
		await act(async () => {
			await Promise.resolve();
			await Promise.resolve();
		});
		return rendered;
	};

	it("publishes the detected landmarks into the ref", async () => {
		const { result } = await renderLoaded();
		mockDetectForVideo.mockReturnValue({ landmarks: [HAND] });

		advanceFrame();

		expect(result.current.landmarksRef.current).toEqual([HAND]);
	});

	it("publishes an empty array when no hands are found", async () => {
		const { result } = await renderLoaded();
		mockDetectForVideo.mockReturnValue({ landmarks: [HAND] });
		advanceFrame();

		mockDetectForVideo.mockReturnValue({ landmarks: [] });
		advanceFrame();

		expect(result.current.landmarksRef.current).toEqual([]);
	});

	it("survives a detector result with no landmarks field", async () => {
		const { result } = await renderLoaded();
		mockDetectForVideo.mockReturnValue(undefined);

		advanceFrame();

		expect(result.current.landmarksRef.current).toEqual([]);
	});

	it("calls onDetect once per newly decoded frame", async () => {
		const onDetect = vi.fn();
		await renderLoaded({ onDetect });
		// The loop detects once as it starts; count only the frames after that.
		onDetect.mockClear();
		mockDetectForVideo.mockReturnValue({ landmarks: [HAND] });

		advanceFrame();
		advanceFrame();

		expect(onDetect).toHaveBeenCalledTimes(2);
		expect(onDetect).toHaveBeenLastCalledWith([HAND], videoElement);
	});

	it("does not detect twice for the same video frame", async () => {
		await renderLoaded();

		advanceFrame();
		const afterFirst = mockDetectForVideo.mock.calls.length;
		// currentTime unchanged: the same frame is still on screen.
		act(() => {
			frameCallback?.(performance.now());
		});

		expect(mockDetectForVideo.mock.calls.length).toBe(afterFirst);
	});

	it("does not run the detector while disabled", async () => {
		await renderLoaded({ enabled: false });

		advanceFrame();

		expect(mockDetectForVideo).not.toHaveBeenCalled();
	});

	it("clears the landmarks when it stops, so a stale V cannot linger", async () => {
		const { result, rerender } = await renderLoaded();
		mockDetectForVideo.mockReturnValue({ landmarks: [HAND] });
		advanceFrame();
		expect(result.current.landmarksRef.current).toEqual([HAND]);

		act(() => rerender({ enabled: false }));

		expect(result.current.landmarksRef.current).toEqual([]);
	});

	it("skips frames before the video has dimensions", async () => {
		const blankVideo = document.createElement("video");
		Object.defineProperty(blankVideo, "videoWidth", { value: 0 });
		Object.defineProperty(blankVideo, "videoHeight", { value: 0 });
		Object.defineProperty(blankVideo, "paused", { value: false });
		Object.defineProperty(blankVideo, "ended", { value: false });
		Object.defineProperty(blankVideo, "readyState", { value: 1 });
		Object.defineProperty(blankVideo, "currentTime", {
			value: 0,
			writable: true,
		});

		renderHook(() =>
			useHandLandmarks({ videoRef: { current: blankVideo }, enabled: true }),
		);
		await act(async () => {
			await Promise.resolve();
			await Promise.resolve();
		});

		act(() => {
			frameCallback?.(performance.now());
		});

		expect(mockDetectForVideo).not.toHaveBeenCalled();
	});

	it("reports the downscaled processing resolution", async () => {
		const { result } = await renderLoaded();

		advanceFrame();

		expect(result.current.processingResRef.current).toEqual({
			width: 640,
			height: 360,
		});
	});

	it("uses the latest onDetect without restarting the loop", async () => {
		const first = vi.fn();
		const second = vi.fn();
		const { rerender } = renderHook(
			(props: { onDetect: () => void }) =>
				useHandLandmarks({
					videoRef,
					enabled: true,
					onDetect: props.onDetect,
				}),
			{ initialProps: { onDetect: first } },
		);
		await act(async () => {
			await Promise.resolve();
			await Promise.resolve();
		});

		first.mockClear();
		mockDetectForVideo.mockClear();

		advanceFrame();
		act(() => rerender({ onDetect: second }));
		advanceFrame();

		expect(first).toHaveBeenCalledTimes(1);
		expect(second).toHaveBeenCalledTimes(1);
		// A restarted loop would have re-detected the frame it already saw.
		expect(mockDetectForVideo).toHaveBeenCalledTimes(2);
	});

	it("keeps the rAF loop alive when detectForVideo throws", async () => {
		const { result } = await renderLoaded();
		mockDetectForVideo.mockClear();

		mockDetectForVideo.mockImplementation(() => {
			throw new Error(
				"Failed to obtain WebGL context from the provided canvas.",
			);
		});
		advanceFrame();

		mockDetectForVideo.mockReturnValue({ landmarks: [HAND] });
		advanceFrame();

		expect(mockDetectForVideo).toHaveBeenCalledTimes(2);
		expect(result.current.landmarksRef.current).toEqual([HAND]);
	});
});

describe("computeProcessingDimensions", () => {
	it("should scale 16:9 landscape to 640x360", () => {
		const result = computeProcessingDimensions(1920, 1080);
		expect(result).toEqual({ width: 640, height: 360 });
	});

	it("should preserve 4:3 aspect ratio (640x480)", () => {
		const result = computeProcessingDimensions(1280, 960);
		expect(result).toEqual({ width: 640, height: 480 });
	});

	it("should handle portrait video (1080x1920 → 360x640)", () => {
		const result = computeProcessingDimensions(1080, 1920);
		expect(result).toEqual({ width: 360, height: 640 });
	});

	it("should not upscale small video (320x240 → 320x240)", () => {
		const result = computeProcessingDimensions(320, 240);
		expect(result).toEqual({ width: 320, height: 240 });
	});

	it("should handle square video (1000x1000 → 640x640)", () => {
		const result = computeProcessingDimensions(1000, 1000);
		expect(result).toEqual({ width: 640, height: 640 });
	});

	it("should respect custom maxDimension", () => {
		const result = computeProcessingDimensions(1920, 1080, 320);
		expect(result).toEqual({ width: 320, height: 180 });
	});
});

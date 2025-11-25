import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSmartZoom } from "./useSmartZoom";

// Mock MediaPipe
const mockDetectForVideo = vi.fn();
const mockClose = vi.fn();

vi.mock("@mediapipe/tasks-vision", () => ({
	FilesetResolver: {
		forVisionTasks: vi.fn().mockResolvedValue("mock-vision-source"),
	},
	HandLandmarker: {
		createFromOptions: vi.fn().mockResolvedValue({
			detectForVideo: (...args: any[]) => {
				return mockDetectForVideo(...args);
			},
			close: () => mockClose(),
		}),
	},
}));

describe("useSmartZoom", () => {
	let videoElement: HTMLVideoElement;
	let frameCallback: FrameRequestCallback | null = null;

	beforeEach(() => {
		vi.useFakeTimers();

		// Mock Video Element
		videoElement = document.createElement("video");
		Object.defineProperty(videoElement, "videoWidth", { value: 1920 });
		Object.defineProperty(videoElement, "videoHeight", { value: 1080 });
		Object.defineProperty(videoElement, "paused", { value: false });
		Object.defineProperty(videoElement, "ended", { value: false });
		Object.defineProperty(videoElement, "currentTime", {
			value: 0,
			writable: true,
		});

		// Mock RAF
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

	const advanceFrame = (timeDelta: number = 16) => {
		if (frameCallback) {
			videoElement.currentTime += timeDelta / 1000;
			act(() => {
				frameCallback?.(performance.now());
			});
		}
	};

	it("should initialize with default zoom 1", async () => {
		const { result } = renderHook(() =>
			useSmartZoom({
				videoRef: { current: videoElement },
				enabled: true,
			}),
		);

		// Wait for model load
		await act(async () => {
			await Promise.resolve();
		});

		expect(result.current.zoom).toBe(1);
	});

	it("should smooth movement towards target", async () => {
		const { result } = renderHook(() =>
			useSmartZoom({
				videoRef: { current: videoElement },
				enabled: true,
				smoothFactor: 0.1, // Use 0.1 for faster test convergence
			}),
		);

		// Wait for model load
		await act(async () => {
			await Promise.resolve();
		});

		// Mock hands detected at center (should zoom in)
		// Box size 0.1 (very small) -> Target Zoom high (clamped to 5)
		// Let's make box size 0.25 -> Target Zoom ~ 1 / (0.25 * 2) = 2.0
		const landmarks = [
			[
				{ x: 0.375, y: 0.375, z: 0 },
				{ x: 0.625, y: 0.625, z: 0 },
			],
		];
		mockDetectForVideo.mockReturnValue({ landmarks: landmarks });

		// Run a few frames
		for (let i = 0; i < 10; i++) {
			advanceFrame();
		}

		// Should have moved from 1.0 towards 2.0
		expect(result.current.zoom).toBeGreaterThan(1.0);
		expect(result.current.zoom).toBeLessThan(2.1);
	});

	it("should ignore small changes (hysteresis)", async () => {
		const { result } = renderHook(() =>
			useSmartZoom({
				videoRef: { current: videoElement },
				enabled: true,
				smoothFactor: 1.0, // Instant smoothing to isolate hysteresis
			}),
		);

		await act(async () => {
			await Promise.resolve();
		});

		// 1. Establish initial target
		// Box 0.25 -> Target 2.0
		const landmarks1 = [
			[
				{ x: 0.375, y: 0.375, z: 0 },
				{ x: 0.625, y: 0.625, z: 0 },
			],
		];
		mockDetectForVideo.mockReturnValue({ landmarks: landmarks1 });
		advanceFrame();

		// Should be at 2.0
		const initialZoom = result.current.zoom;
		expect(initialZoom).toBeCloseTo(2.0, 1);

		// 2. Small change
		// Change box slightly. Target 2.05. Delta 0.05 < Threshold 0.1
		// Box size needs to be slightly smaller.
		// 1 / (size * 2) = 2.05 => size = 1/4.1 = 0.2439
		const landmarks2 = [
			[
				{ x: 0.378, y: 0.378, z: 0 }, // slightly shifted/smaller
				{ x: 0.622, y: 0.622, z: 0 },
			],
		];
		mockDetectForVideo.mockReturnValue({ landmarks: landmarks2 });
		advanceFrame();

		// Should NOT change
		expect(result.current.zoom).toBe(initialZoom);
	});

	it("should respond to large changes", async () => {
		const { result } = renderHook(() =>
			useSmartZoom({
				videoRef: { current: videoElement },
				enabled: true,
				smoothFactor: 1.0,
			}),
		);

		await act(async () => {
			await Promise.resolve();
		});

		// 1. Initial Target 2.0
		const landmarks1 = [
			[
				{ x: 0.375, y: 0.375, z: 0 },
				{ x: 0.625, y: 0.625, z: 0 },
			],
		];
		mockDetectForVideo.mockReturnValue({ landmarks: landmarks1 });
		advanceFrame();

		const initialZoom = result.current.zoom;

		// 2. Large Change
		// Target 3.0. Delta 1.0 > Threshold 0.1
		// 1 / (size * 2) = 3.0 => size = 1/6 = 0.166
		const landmarks2 = [
			[
				{ x: 0.41, y: 0.41, z: 0 },
				{ x: 0.58, y: 0.58, z: 0 },
			],
		];
		mockDetectForVideo.mockReturnValue({ landmarks: landmarks2 });
		advanceFrame();

		// Should change
		expect(mockDetectForVideo).toHaveBeenCalled();
		expect(result.current.zoom).not.toBe(initialZoom);
		expect(result.current.zoom).toBeCloseTo(2.9, 1);
	});
});

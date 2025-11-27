import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clampPanToViewport, useSmartZoom } from "./useSmartZoom";

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

	it("should respond to large changes (clamped to MAX_ZOOM=2)", async () => {
		// See docs/SMART_ZOOM_SPEC.md for constants
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

		// 1. Initial: Box 0.5 -> Target 1.0 (at edge of zoom)
		const landmarks1 = [
			[
				{ x: 0.25, y: 0.25, z: 0 },
				{ x: 0.75, y: 0.75, z: 0 },
			],
		];
		mockDetectForVideo.mockReturnValue({ landmarks: landmarks1 });
		advanceFrame();

		const initialZoom = result.current.zoom;
		expect(initialZoom).toBeCloseTo(1.0, 1);

		// 2. Large Change: Box 0.25 -> Target 2.0
		// Delta 1.0 > ZOOM_THRESHOLD (0.1), so should commit
		const landmarks2 = [
			[
				{ x: 0.375, y: 0.375, z: 0 },
				{ x: 0.625, y: 0.625, z: 0 },
			],
		];
		mockDetectForVideo.mockReturnValue({ landmarks: landmarks2 });
		advanceFrame();

		// Should change to MAX_ZOOM (2.0)
		expect(mockDetectForVideo).toHaveBeenCalled();
		expect(result.current.zoom).not.toBe(initialZoom);
		expect(result.current.zoom).toBeCloseTo(2.0, 1);
	});
});

// Pure function tests (see docs/SMART_ZOOM_SPEC.md - Viewport Bounds Constraint)
describe("clampPanToViewport", () => {
	const videoSize = { width: 1920, height: 1080 };

	it("should allow no pan at zoom 1 (spec: maxPan = 0)", () => {
		// Positive input pan → clamped to 0, hit left/top boundaries
		const result = clampPanToViewport({ x: 100, y: 50 }, 1, videoSize);

		expect(result.pan.x).toBe(0);
		expect(result.pan.y).toBe(0);
		// Positive pan was clamped → hit left (positive direction) and top
		expect(result.clampedEdges.left).toBe(true);
		expect(result.clampedEdges.top).toBe(true);
		// Wasn't trying to go right or bottom
		expect(result.clampedEdges.right).toBe(false);
		expect(result.clampedEdges.bottom).toBe(false);
	});

	it("should allow pan up to 480px at zoom 2 (spec: maxPanX = 480)", () => {
		// At zoom 2: maxPanX = 1920 * (1 - 1/2) / 2 = 1920 * 0.5 / 2 = 480
		const result = clampPanToViewport({ x: 400, y: 200 }, 2, videoSize);

		expect(result.pan.x).toBe(400); // Within bounds
		expect(result.pan.y).toBe(200); // Within bounds
		expect(result.clampedEdges.left).toBe(false);
		expect(result.clampedEdges.right).toBe(false);
	});

	it("should clamp pan at boundary and set clampedEdges (spec example)", () => {
		// At zoom 2: maxPanX = 480, maxPanY = 270
		const result = clampPanToViewport({ x: 600, y: -300 }, 2, videoSize);

		expect(result.pan.x).toBe(480); // Clamped to max
		expect(result.pan.y).toBe(-270); // Clamped to -max
		expect(result.clampedEdges.left).toBe(true); // At +maxPanX
		expect(result.clampedEdges.right).toBe(false);
		expect(result.clampedEdges.top).toBe(false);
		expect(result.clampedEdges.bottom).toBe(true); // At -maxPanY
	});

	it("should allow pan up to 640px at zoom 3 (spec: maxPanX = 640)", () => {
		// At zoom 3: maxPanX = 1920 * (1 - 1/3) / 2 = 1920 * (2/3) / 2 = 640
		// Test exceeding boundary to trigger clamping
		const result = clampPanToViewport({ x: 700, y: 400 }, 3, videoSize);

		expect(result.pan.x).toBeCloseTo(640, 0); // Clamped to max
		expect(result.pan.y).toBeCloseTo(360, 0); // Clamped to max
		expect(result.clampedEdges.left).toBe(true);
		expect(result.clampedEdges.top).toBe(true);
	});

	it("should handle negative pan values", () => {
		// At zoom 2: maxPan = 480, 270
		const result = clampPanToViewport({ x: -500, y: -100 }, 2, videoSize);

		expect(result.pan.x).toBe(-480); // Clamped
		expect(result.pan.y).toBe(-100); // Within bounds
		expect(result.clampedEdges.right).toBe(true); // At -maxPanX
		expect(result.clampedEdges.left).toBe(false);
	});
});

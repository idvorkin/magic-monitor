import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	clampNormalizedPan,
	clampPanToViewport,
	useSmartZoom,
} from "./useSmartZoom";

// Mock MediaPipe
const mockDetectForVideo = vi.fn();
const mockClose = vi.fn();

vi.mock("@mediapipe/tasks-vision", () => ({
	FilesetResolver: {
		forVisionTasks: vi.fn().mockResolvedValue("mock-vision-source"),
	},
	HandLandmarker: {
		createFromOptions: vi.fn().mockResolvedValue({
			detectForVideo: (...args: unknown[]) => {
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
				smoothingPreset: "ema", // Use EMA for predictable smoothing behavior
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
				smoothingPreset: "ema",
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

		// Run many frames to let smoothing converge
		for (let i = 0; i < 100; i++) {
			advanceFrame();
		}

		// Should be close to 2.0 after convergence
		const initialZoom = result.current.zoom;
		expect(initialZoom).toBeCloseTo(2.0, 0.5);

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

		// Run a few frames - should NOT change committed target
		for (let i = 0; i < 10; i++) {
			advanceFrame();
		}

		// Should stay near initial zoom (hysteresis prevents update)
		expect(result.current.zoom).toBeCloseTo(initialZoom, 0.1);
	});

	it("should respond to large changes (clamped to MAX_ZOOM=3)", async () => {
		// See docs/SMART_ZOOM_SPEC.md for constants
		const { result } = renderHook(() =>
			useSmartZoom({
				videoRef: { current: videoElement },
				enabled: true,
				smoothingPreset: "ema",
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

		// Converge to initial state
		for (let i = 0; i < 50; i++) {
			advanceFrame();
		}

		const initialZoom = result.current.zoom;
		expect(initialZoom).toBeCloseTo(1.0, 0.5);

		// 2. Large Change: Box 0.25 -> Target 2.0
		// Delta 1.0 > ZOOM_THRESHOLD (0.1), so should commit
		const landmarks2 = [
			[
				{ x: 0.375, y: 0.375, z: 0 },
				{ x: 0.625, y: 0.625, z: 0 },
			],
		];
		mockDetectForVideo.mockReturnValue({ landmarks: landmarks2 });

		// Run many frames to converge
		for (let i = 0; i < 100; i++) {
			advanceFrame();
		}

		// Should change to target 2.0
		expect(mockDetectForVideo).toHaveBeenCalled();
		expect(result.current.zoom).not.toBeCloseTo(initialZoom, 0.5);
		expect(result.current.zoom).toBeCloseTo(2.0, 0.5);
	});

	it("should return normalized pan values (0-1 range)", async () => {
		const { result } = renderHook(() =>
			useSmartZoom({
				videoRef: { current: videoElement },
				enabled: true,
				smoothingPreset: "ema",
			}),
		);

		await act(async () => {
			await Promise.resolve();
		});

		// Hand at right side of frame: center at x=0.8
		// Target pan = 0.5 - 0.8 = -0.3 (shift view right to center hand)
		// At zoom 2, maxPan = 0.25, so clamped to -0.25
		const landmarks = [
			[
				{ x: 0.7, y: 0.4, z: 0 }, // Box from 0.7-0.9, center at 0.8
				{ x: 0.9, y: 0.6, z: 0 },
			],
		];
		mockDetectForVideo.mockReturnValue({ landmarks });
		advanceFrame();

		// Pan should be in normalized range, not pixels
		// Should be small values like -0.25, not large values like -480
		expect(result.current.pan.x).toBeGreaterThan(-1);
		expect(result.current.pan.x).toBeLessThan(1);
		expect(result.current.pan.y).toBeGreaterThan(-1);
		expect(result.current.pan.y).toBeLessThan(1);
	});
});

// Pure function tests for NORMALIZED pan (resolution-independent)
// See docs/SMART_ZOOM_SPEC.md - using 0-1 coordinates throughout
describe("clampNormalizedPan", () => {
	/**
	 * Normalized Pan Coordinate System:
	 * - Pan is in range [-maxPan, +maxPan] where maxPan = (1 - 1/zoom) / 2
	 * - Pan of 0 means centered
	 * - Positive pan shifts view left/up (shows right/bottom of video)
	 * - At zoom 1: maxPan = 0 (no pan allowed)
	 * - At zoom 2: maxPan = 0.25 (can shift 25% from center)
	 * - At zoom 3: maxPan = 0.333 (can shift 33% from center)
	 *
	 * CSS usage: transform: scale(zoom) translate(pan.x * 100%, pan.y * 100%)
	 */

	it("should allow no pan at zoom 1", () => {
		const result = clampNormalizedPan({ x: 0.5, y: 0.3 }, 1);

		expect(result.pan.x).toBe(0);
		expect(result.pan.y).toBe(0);
		expect(result.clampedEdges.left).toBe(true);
		expect(result.clampedEdges.top).toBe(true);
	});

	it("should allow pan up to 0.25 at zoom 2", () => {
		// maxPan = (1 - 1/2) / 2 = 0.25
		const result = clampNormalizedPan({ x: 0.2, y: 0.1 }, 2);

		expect(result.pan.x).toBe(0.2); // Within bounds
		expect(result.pan.y).toBe(0.1); // Within bounds
		expect(result.clampedEdges.left).toBe(false);
		expect(result.clampedEdges.right).toBe(false);
	});

	it("should clamp pan at 0.25 boundary for zoom 2", () => {
		const result = clampNormalizedPan({ x: 0.4, y: -0.3 }, 2);

		expect(result.pan.x).toBe(0.25); // Clamped to max
		expect(result.pan.y).toBe(-0.25); // Clamped to -max
		expect(result.clampedEdges.left).toBe(true);
		expect(result.clampedEdges.bottom).toBe(true);
	});

	it("should allow pan up to ~0.333 at zoom 3", () => {
		// maxPan = (1 - 1/3) / 2 = 1/3 ≈ 0.333
		const result = clampNormalizedPan({ x: 0.5, y: 0.5 }, 3);

		expect(result.pan.x).toBeCloseTo(0.333, 2);
		expect(result.pan.y).toBeCloseTo(0.333, 2);
		expect(result.clampedEdges.left).toBe(true);
		expect(result.clampedEdges.top).toBe(true);
	});

	it("should handle negative pan values", () => {
		const result = clampNormalizedPan({ x: -0.3, y: -0.1 }, 2);

		expect(result.pan.x).toBe(-0.25); // Clamped
		expect(result.pan.y).toBe(-0.1); // Within bounds
		expect(result.clampedEdges.right).toBe(true);
		expect(result.clampedEdges.left).toBe(false);
	});

	it("should work with CSS transform math", () => {
		// At zoom 2, max normalized pan = 0.25
		// CSS: scale(2) translate(25%, 0)
		// Visual shift = 25% * 2 = 50% of element
		// At zoom 2, visible area is 50% of video, hidden is 50% (25% each side)
		// So 50% visual shift exactly reaches the edge ✓

		const result = clampNormalizedPan({ x: 1.0, y: 0 }, 2);
		expect(result.pan.x).toBe(0.25);

		// Verify: visual shift = pan * zoom = 0.25 * 2 = 0.5 (50%)
		// Max allowed = (zoom - 1) / (2 * zoom) * zoom = (zoom - 1) / 2 = 0.5 ✓
		const visualShift = result.pan.x * 2;
		expect(visualShift).toBe(0.5);
	});
});

// Pure function tests (see docs/SMART_ZOOM_SPEC.md - Viewport Bounds Constraint)
// LEGACY: pixel-based clamp function - keeping for backwards compatibility during migration
describe("clampPanToViewport (legacy pixel-based)", () => {
	const videoSize = { width: 1920, height: 1080 };

	/**
	 * CSS Transform Order Bug Test
	 *
	 * The CSS transform `scale(Z) translate(X, Y)` applies right-to-left:
	 * 1. Translate by (X, Y)
	 * 2. Scale by Z
	 *
	 * This means the visual pan = X * Z, not X.
	 *
	 * For the video to fill the viewport without blank space:
	 * - At zoom Z, the video is Z times larger
	 * - The visible portion is 1/Z of the video
	 * - Max visual pan = (videoSize * Z - videoSize) / 2 = videoSize * (Z - 1) / 2
	 *
	 * But if pan is in pre-scale coordinates (gets multiplied by Z):
	 * - maxPan * Z must not exceed videoSize * (Z - 1) / 2
	 * - maxPan = videoSize * (Z - 1) / (2 * Z)
	 *
	 * Current formula: maxPan = videoSize * (1 - 1/Z) / 2 = videoSize * (Z - 1) / (2 * Z)
	 * This IS correct for pre-scale pan coordinates!
	 *
	 * BUT if CSS uses `translate() scale()` (translate in post-scale screen coords):
	 * - maxPan = videoSize * (Z - 1) / 2 (no division by Z needed)
	 *
	 * The spec formula assumes pan is in VIDEO coordinates (post-scale).
	 * If CameraStage uses scale() translate(), pan is in PRE-scale coords.
	 */
	describe("CSS transform integration", () => {
		it("should ensure video fills viewport at max clamped pan (zoom 2)", () => {
			// At zoom 2 on 1920px video:
			// - Scaled video width = 1920 * 2 = 3840px
			// - Viewport sees 1920px centered
			// - Max shift before exposing edge = (3840 - 1920) / 2 = 960px
			//
			// With scale(2) translate(X, Y):
			// - Visual shift = X * 2
			// - For 960px max visual shift: X must be <= 480px
			//
			// With translate(X, Y) scale(2):
			// - Visual shift = X (translate happens after scale, in screen coords)
			// - For 960px max visual shift: X can be 960px
			//
			// Current clampPanToViewport returns maxPanX = 480 at zoom 2
			// This is correct for scale() translate() order

			const result = clampPanToViewport({ x: 1000, y: 0 }, 2, videoSize);

			// The clamped pan value
			expect(result.pan.x).toBe(480);

			// Critical: when applied as scale(2) translate(480px, 0),
			// the visual shift is 480 * 2 = 960px
			// This should exactly reach the edge (no blank space, no overflow)
			const visualShift = result.pan.x * 2; // CSS multiplies by zoom
			const maxAllowedVisualShift = (videoSize.width * 2 - videoSize.width) / 2;
			expect(visualShift).toBe(maxAllowedVisualShift);
		});

		it("should ensure video fills viewport at max clamped pan (zoom 3)", () => {
			// At zoom 3 on 1920px video:
			// - Scaled video = 5760px, viewport = 1920px
			// - Max visual shift = (5760 - 1920) / 2 = 1920px
			//
			// With scale(3) translate(X, Y):
			// - Visual shift = X * 3
			// - For 1920px max: X <= 640px
			//
			// clampPanToViewport should return maxPanX ≈ 640

			const result = clampPanToViewport({ x: 1000, y: 0 }, 3, videoSize);

			expect(result.pan.x).toBeCloseTo(640, 0);

			// Verify visual math
			const visualShift = result.pan.x * 3;
			const maxAllowedVisualShift = (videoSize.width * 3 - videoSize.width) / 2;
			expect(visualShift).toBeCloseTo(maxAllowedVisualShift, 0);
		});
	});

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

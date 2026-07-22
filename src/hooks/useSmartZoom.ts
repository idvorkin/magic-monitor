import { useCallback, useEffect, useRef, useState } from "react";
import { PAN_CONSTANTS, ZOOM_CONSTANTS } from "../constants/zoom";
import { HandLandmarkerService } from "../services/HandLandmarkerService";
import {
	clampSpeed,
	createSmoother,
	DEFAULT_SPEED_CLAMP,
	type Smoother,
	type SmoothingPreset,
} from "../smoothing";
import { useModelLoadingState } from "./useModelLoadingState";

// Clamped edges indicator for debug overlay (see docs/SMART_ZOOM_SPEC.md)
export interface ClampedEdges {
	left: boolean;
	right: boolean;
	top: boolean;
	bottom: boolean;
}

// Hand landmark point from MediaPipe
interface HandLandmark {
	x: number;
	y: number;
	z: number;
}

// Debug trace entry for diagnostics
export interface DebugTraceEntry {
	timestamp: number;
	frame: number;
	// Detection
	handsDetected: number;
	boundingBox: {
		minX: number;
		maxX: number;
		minY: number;
		maxY: number;
	} | null;
	// Calculated values
	targetZoom: number;
	targetPan: { x: number; y: number };
	// After hysteresis
	committedZoom: number;
	committedPan: { x: number; y: number };
	// After lerp + clamp
	currentZoom: number;
	currentPan: { x: number; y: number };
	clampedEdges: ClampedEdges;
	// Context
	videoSize: { width: number; height: number };
}

const DEBUG_TRACE_MAX_ENTRIES = 900; // ~30 seconds at 30fps

// Pure function: Clamp NORMALIZED pan to viewport bounds (resolution-independent)
// Pan is in range [-maxPan, +maxPan] where maxPan = (1 - 1/zoom) / 2
// See docs/SMART_ZOOM_SPEC.md for derivation
export function clampNormalizedPan(
	pan: { x: number; y: number },
	zoom: number,
): { pan: { x: number; y: number }; clampedEdges: ClampedEdges } {
	// maxPan = (1 - 1/zoom) / 2
	// At zoom 1: maxPan = 0 (no pan allowed)
	// At zoom 2: maxPan = 0.25 (can shift 25% from center)
	// At zoom 3: maxPan = 0.333 (can shift 33% from center)
	const maxPan = (1 - 1 / zoom) / 2;

	const clampedEdges: ClampedEdges = {
		left: pan.x >= maxPan,
		right: pan.x <= -maxPan,
		top: pan.y >= maxPan,
		bottom: pan.y <= -maxPan,
	};

	const clampedPan = {
		x: Math.min(Math.max(pan.x, -maxPan), maxPan),
		y: Math.min(Math.max(pan.y, -maxPan), maxPan),
	};

	return { pan: clampedPan, clampedEdges };
}

// LEGACY: Pixel-based clamp function - kept for backwards compatibility
// Prefer clampNormalizedPan for new code
export function clampPanToViewport(
	pan: { x: number; y: number },
	zoom: number,
	videoSize: { width: number; height: number },
): { pan: { x: number; y: number }; clampedEdges: ClampedEdges } {
	// maxPan = videoSize × (1 - 1/zoom) / 2
	const maxPanX = (videoSize.width * (1 - 1 / zoom)) / 2;
	const maxPanY = (videoSize.height * (1 - 1 / zoom)) / 2;

	const clampedEdges: ClampedEdges = {
		left: pan.x >= maxPanX,
		right: pan.x <= -maxPanX,
		top: pan.y >= maxPanY,
		bottom: pan.y <= -maxPanY,
	};

	const clampedPan = {
		x: Math.min(Math.max(pan.x, -maxPanX), maxPanX),
		y: Math.min(Math.max(pan.y, -maxPanY), maxPanY),
	};

	return { pan: clampedPan, clampedEdges };
}

/**
 * Compute processing canvas dimensions that preserve the source aspect ratio.
 * Scales so the larger dimension fits within maxDimension; never upscales.
 */
export function computeProcessingDimensions(
	videoWidth: number,
	videoHeight: number,
	maxDimension = 640,
): { width: number; height: number } {
	const scale = Math.min(1, maxDimension / Math.max(videoWidth, videoHeight));
	return {
		width: Math.round(videoWidth * scale),
		height: Math.round(videoHeight * scale),
	};
}

interface SmartZoomConfig {
	videoRef: React.RefObject<HTMLVideoElement | null>;
	enabled: boolean;
	padding?: number; // Extra space around hands (default 2.0)
	smoothingPreset?: SmoothingPreset; // Smoothing algorithm preset (default "ema")
}

export function useSmartZoom({
	videoRef,
	enabled,
	padding = 2.0,
	smoothingPreset = "ema",
}: SmartZoomConfig) {
	const { isModelLoading, loadingProgress, loadingPhase, modelError } =
		useModelLoadingState(HandLandmarkerService, { initialIsLoading: true });
	// Use ref instead of state for landmarks to avoid 60fps re-renders
	// HandSkeleton reads from this ref directly in its own rAF loop
	const debugLandmarksRef = useRef<HandLandmark[][]>([]);

	// Smoother instance (recreated when preset changes)
	const smootherRef = useRef<Smoother>(createSmoother(smoothingPreset));

	// Track previous position for speed clamping
	const prevPositionRef = useRef({ x: 0, y: 0, zoom: 1 });

	// Committed target state (for hysteresis/deadband)
	const committedTargetRef = useRef({ zoom: 1, pan: { x: 0, y: 0 } });

	// Recreate smoother when preset changes
	useEffect(() => {
		smootherRef.current = createSmoother(smoothingPreset);
		smootherRef.current.reset();
	}, [smoothingPreset]);

	// Use constants directly from imports (not destructured) to avoid useEffect dep issues
	// See docs/SMART_ZOOM_SPEC.md for constant meanings

	// Output state
	const [zoom, setZoom] = useState(1);
	const [pan, setPan] = useState({ x: 0, y: 0 });
	const [clampedEdges, setClampedEdges] = useState<ClampedEdges>({
		left: false,
		right: false,
		top: false,
		bottom: false,
	});

	// Refs for high-frequency updates (60fps) - these drive the actual transform
	const zoomRef = useRef(1);
	const panRef = useRef({ x: 0, y: 0 });
	const clampedEdgesRef = useRef<ClampedEdges>({
		left: false,
		right: false,
		top: false,
		bottom: false,
	});

	// Throttle UI state updates to ~10Hz (every 6 frames) to avoid render storms
	// The refs above always have the real-time value; state is for UI display only
	const UI_UPDATE_INTERVAL = 6;

	// Perf timing for detection (exposed via ref for overlay)
	const detectTimeMsRef = useRef(0);

	// Offscreen canvas for downscaling video before detection
	// MediaPipe's hand model works at 224x224 internally, so 640-wide is more than enough
	const processingCanvasRef = useRef<
		OffscreenCanvas | HTMLCanvasElement | null
	>(null);
	const processingCtxRef = useRef<
		CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null
	>(null);
	const lastVideoDimsRef = useRef({ width: 0, height: 0 });
	const processingResRef = useRef({ width: 0, height: 0 });

	const requestRef = useRef<number>(0);
	const lastVideoTimeRef = useRef<number>(-1);

	// Debug trace buffer (circular)
	const debugTraceRef = useRef<DebugTraceEntry[]>([]);
	const frameCountRef = useRef(0);

	// Clear debug trace when smart zoom is disabled
	useEffect(() => {
		if (!enabled) {
			debugTraceRef.current = [];
		}
	}, [enabled]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: isModelLoading triggers effect re-run when model loads
	useEffect(() => {
		const landmarker = HandLandmarkerService.getModel();
		if (!enabled || !landmarker || !videoRef.current) return;

		const detect = () => {
			const video = videoRef.current;
			if (
				!video ||
				video.paused ||
				video.ended ||
				video.readyState < 2 ||
				video.videoWidth === 0
			) {
				requestRef.current = requestAnimationFrame(detect);
				return;
			}

			// Only process if video time has changed
			if (video.currentTime !== lastVideoTimeRef.current) {
				lastVideoTimeRef.current = video.currentTime;

				// Create or resize processing canvas to match video aspect ratio
				const vw = video.videoWidth;
				const vh = video.videoHeight;
				if (
					!processingCanvasRef.current ||
					lastVideoDimsRef.current.width !== vw ||
					lastVideoDimsRef.current.height !== vh
				) {
					const dims = computeProcessingDimensions(vw, vh);
					if (!processingCanvasRef.current) {
						processingCanvasRef.current = document.createElement("canvas");
					}
					processingCanvasRef.current.width = dims.width;
					processingCanvasRef.current.height = dims.height;
					processingCtxRef.current = (
						processingCanvasRef.current as HTMLCanvasElement
					).getContext("2d");
					lastVideoDimsRef.current = { width: vw, height: vh };
					processingResRef.current = dims;
				}

				// Downscale video preserving aspect ratio before detection.
				// Falls back to raw video if drawImage fails (e.g. in jsdom tests).
				let detectInput: HTMLVideoElement | HTMLCanvasElement = video;
				const processingCtx = processingCtxRef.current;
				const procRes = processingResRef.current;
				if (processingCtx) {
					try {
						processingCtx.drawImage(video, 0, 0, procRes.width, procRes.height);
						detectInput = processingCanvasRef.current as HTMLCanvasElement;
					} catch {
						// jsdom canvas doesn't support drawImage with video — use raw video
					}
				}

				const startTimeMs = performance.now();
				const t0 = performance.now();
				const result = landmarker.detectForVideo(
					detectInput as unknown as HTMLVideoElement,
					startTimeMs,
				);
				detectTimeMsRef.current = performance.now() - t0;

				if (result?.landmarks && result.landmarks.length > 0) {
					// Calculate bounding box of all hands
					let minX = 1,
						minY = 1,
						maxX = 0,
						maxY = 0;

					result.landmarks.forEach((hand) => {
						hand.forEach((point) => {
							if (point.x < minX) minX = point.x;
							if (point.x > maxX) maxX = point.x;
							if (point.y < minY) minY = point.y;
							if (point.y > maxY) maxY = point.y;
						});
					});

					// Calculate center and size
					const centerX = (minX + maxX) / 2;
					const centerY = (minY + maxY) / 2;
					const width = maxX - minX;
					const height = maxY - minY;

					// Determine target zoom based on bounding box size
					// We want the box to fill (1 / padding) of the screen
					// e.g. if padding is 2.0, box should be half the screen
					const maxDim = Math.max(width, height);
					let targetZoom = 1 / (maxDim * padding);

					// Clamp zoom (see docs/SMART_ZOOM_SPEC.md)
					targetZoom = Math.min(
						Math.max(targetZoom, ZOOM_CONSTANTS.MIN_ZOOM),
						ZOOM_CONSTANTS.MAX_ZOOM,
					);

					// Determine target pan in NORMALIZED coordinates (0-1 range)
					// Pan of 0 = centered, positive = shift view left/up
					// If center is 0.5, pan is 0.
					// If center is 0.8 (right side), pan is -0.3 (shift view right to center hand)
					const targetPanX = 0.5 - centerX;
					const targetPanY = 0.5 - centerY;

					// Hysteresis / Deadband Check (all in normalized coordinates)
					const zoomDelta = Math.abs(
						targetZoom - committedTargetRef.current.zoom,
					);
					const panDist = Math.sqrt(
						(targetPanX - committedTargetRef.current.pan.x) ** 2 +
							(targetPanY - committedTargetRef.current.pan.y) ** 2,
					);
					// panDist is now in normalized units (0-1), threshold is also normalized

					// Only update committed target if change is significant
					if (
						zoomDelta > ZOOM_CONSTANTS.THRESHOLD ||
						panDist > PAN_CONSTANTS.THRESHOLD
					) {
						committedTargetRef.current = {
							zoom: targetZoom,
							pan: { x: targetPanX, y: targetPanY },
						};
					}

					// Smooth using the selected smoother (EMA or Kalman)
					const smoothed = smootherRef.current.update({
						x: committedTargetRef.current.pan.x,
						y: committedTargetRef.current.pan.y,
						zoom: committedTargetRef.current.zoom,
					});

					// Apply speed clamping to prevent jarring movements
					const speedClamped = clampSpeed(
						prevPositionRef.current,
						smoothed,
						DEFAULT_SPEED_CLAMP.maxPanSpeed,
						DEFAULT_SPEED_CLAMP.maxZoomSpeed,
					);

					// Clamp pan to viewport bounds (using normalized coordinates)
					const { pan: clampedPan, clampedEdges: edges } = clampNormalizedPan(
						{ x: speedClamped.x, y: speedClamped.y },
						speedClamped.zoom,
					);

					// Update refs for next frame
					prevPositionRef.current = {
						x: clampedPan.x,
						y: clampedPan.y,
						zoom: speedClamped.zoom,
					};

					// Record debug trace entry (pan values are now normalized)
					frameCountRef.current++;
					const traceEntry: DebugTraceEntry = {
						timestamp: performance.now(),
						frame: frameCountRef.current,
						handsDetected: result.landmarks.length,
						boundingBox: { minX, maxX, minY, maxY },
						targetZoom,
						targetPan: { x: targetPanX, y: targetPanY },
						committedZoom: committedTargetRef.current.zoom,
						committedPan: { ...committedTargetRef.current.pan },
						currentZoom: prevPositionRef.current.zoom,
						currentPan: {
							x: prevPositionRef.current.x,
							y: prevPositionRef.current.y,
						},
						clampedEdges: edges,
						videoSize: { width: video.videoWidth, height: video.videoHeight },
					};
					debugTraceRef.current.push(traceEntry);
					if (debugTraceRef.current.length > DEBUG_TRACE_MAX_ENTRIES) {
						debugTraceRef.current.shift();
					}

					// Always update refs (real-time values for transforms)
					zoomRef.current = prevPositionRef.current.zoom;
					panRef.current = {
						x: prevPositionRef.current.x,
						y: prevPositionRef.current.y,
					};
					clampedEdgesRef.current = edges;
					debugLandmarksRef.current = result.landmarks;

					// Throttle React state updates to ~10Hz to avoid render storms
					if (frameCountRef.current % UI_UPDATE_INTERVAL === 0) {
						setZoom(zoomRef.current);
						setPan(panRef.current);
						setClampedEdges(clampedEdgesRef.current);
					}
				} else {
					// No hands? Slowly zoom out to 1
					// For zoom out, we can bypass hysteresis or set target to 1
					committedTargetRef.current = { zoom: 1, pan: { x: 0, y: 0 } };

					// Smooth using the selected smoother (target is default position)
					const smoothed = smootherRef.current.update({
						x: 0,
						y: 0,
						zoom: 1,
					});

					// Apply speed clamping (use slower speed when no hands for gentler return)
					const speedClamped = clampSpeed(
						prevPositionRef.current,
						smoothed,
						DEFAULT_SPEED_CLAMP.maxPanSpeed * 0.5, // Half speed when no hands
						DEFAULT_SPEED_CLAMP.maxZoomSpeed * 0.5,
					);

					// Clamp pan to viewport bounds (using normalized coordinates)
					const { pan: clampedPan, clampedEdges: edges } = clampNormalizedPan(
						{ x: speedClamped.x, y: speedClamped.y },
						speedClamped.zoom,
					);

					// Update refs for next frame
					prevPositionRef.current = {
						x: clampedPan.x,
						y: clampedPan.y,
						zoom: speedClamped.zoom,
					};

					// Record debug trace entry (no hands, pan values are normalized)
					frameCountRef.current++;
					const traceEntry: DebugTraceEntry = {
						timestamp: performance.now(),
						frame: frameCountRef.current,
						handsDetected: 0,
						boundingBox: null,
						targetZoom: 1,
						targetPan: { x: 0, y: 0 },
						committedZoom: 1,
						committedPan: { x: 0, y: 0 },
						currentZoom: prevPositionRef.current.zoom,
						currentPan: {
							x: prevPositionRef.current.x,
							y: prevPositionRef.current.y,
						},
						clampedEdges: edges,
						videoSize: { width: video.videoWidth, height: video.videoHeight },
					};
					debugTraceRef.current.push(traceEntry);
					if (debugTraceRef.current.length > DEBUG_TRACE_MAX_ENTRIES) {
						debugTraceRef.current.shift();
					}

					// Always update refs (real-time values for transforms)
					zoomRef.current = prevPositionRef.current.zoom;
					panRef.current = {
						x: prevPositionRef.current.x,
						y: prevPositionRef.current.y,
					};
					clampedEdgesRef.current = edges;
					debugLandmarksRef.current = [];

					// Throttle React state updates to ~10Hz to avoid render storms
					if (frameCountRef.current % UI_UPDATE_INTERVAL === 0) {
						setZoom(zoomRef.current);
						setPan(panRef.current);
						setClampedEdges(clampedEdgesRef.current);
					}
				}
			}

			requestRef.current = requestAnimationFrame(detect);
		};

		detect();

		return () => {
			if (requestRef.current) cancelAnimationFrame(requestRef.current);
		};
	}, [enabled, videoRef, padding, smoothingPreset, isModelLoading]);

	// Get debug trace as JSON for download
	const getDebugTrace = useCallback(() => {
		return {
			exportedAt: new Date().toISOString(),
			config: {
				padding,
				smoothingPreset,
				minZoom: 1,
				maxZoom: 3,
				zoomThreshold: 0.1,
				panThreshold: 0.025,
			},
			entries: [...debugTraceRef.current],
		};
	}, [padding, smoothingPreset]);

	return {
		isModelLoading,
		loadingProgress,
		loadingPhase,
		modelError,
		zoom,
		pan,
		clampedEdges,
		// Refs for real-time access (60fps) - use these for transforms
		zoomRef,
		panRef,
		clampedEdgesRef,
		debugLandmarksRef,
		detectTimeMsRef,
		processingResRef,
		getDebugTrace,
	};
}

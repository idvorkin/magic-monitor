import { FilesetResolver, HandLandmarker } from "@mediapipe/tasks-vision";
import { useCallback, useEffect, useRef, useState } from "react";

// Clamped edges indicator for debug overlay (see docs/SMART_ZOOM_SPEC.md)
export interface ClampedEdges {
	left: boolean;
	right: boolean;
	top: boolean;
	bottom: boolean;
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

interface SmartZoomConfig {
	videoRef: React.RefObject<HTMLVideoElement | null>;
	enabled: boolean;
	padding?: number; // Extra space around hands (default 1.5x)
	smoothFactor?: number; // 0-1, lower is smoother (default 0.1)
}

export function useSmartZoom({
	videoRef,
	enabled,
	padding = 2.0,
	smoothFactor = 0.05, // Slower default for stability
}: SmartZoomConfig) {
	const [isModelLoading, setIsModelLoading] = useState(true);
	const [debugLandmarks, setDebugLandmarks] = useState<any[]>([]);

	// Current state (for smoothing)
	const currentZoomRef = useRef(1);
	const currentPanRef = useRef({ x: 0, y: 0 });

	// Committed target state (for hysteresis/deadband)
	const committedTargetRef = useRef({ zoom: 1, pan: { x: 0, y: 0 } });

	// Constants (see docs/SMART_ZOOM_SPEC.md)
	const MIN_ZOOM = 1;
	const MAX_ZOOM = 3;
	const ZOOM_THRESHOLD = 0.1;
	// Pan threshold in normalized coords (0.025 ≈ 50px on 1920px video)
	const PAN_THRESHOLD = 0.025;

	// Output state
	const [zoom, setZoom] = useState(1);
	const [pan, setPan] = useState({ x: 0, y: 0 });
	const [clampedEdges, setClampedEdges] = useState<ClampedEdges>({
		left: false,
		right: false,
		top: false,
		bottom: false,
	});

	const landmarkerRef = useRef<HandLandmarker | null>(null);
	const requestRef = useRef<number>(0);
	const lastVideoTimeRef = useRef<number>(-1);

	// Debug trace buffer (circular)
	const debugTraceRef = useRef<DebugTraceEntry[]>([]);
	const frameCountRef = useRef(0);

	useEffect(() => {
		async function loadModel() {
			try {
				// Use local WASM files for offline support
				const vision = await FilesetResolver.forVisionTasks("/mediapipe/wasm");

				// Use local model file for offline support
				landmarkerRef.current = await HandLandmarker.createFromOptions(vision, {
					baseOptions: {
						modelAssetPath: "/mediapipe/hand_landmarker.task",
						delegate: "GPU",
					},
					runningMode: "VIDEO",
					numHands: 2,
				});

				setIsModelLoading(false);
			} catch (error) {
				console.error("Error loading HandLandmarker:", error);
				setIsModelLoading(false);
			}
		}

		loadModel();
	}, []);

	// biome-ignore lint/correctness/useExhaustiveDependencies: isModelLoading triggers effect re-run when model loads
	useEffect(() => {
		if (!enabled || !landmarkerRef.current || !videoRef.current) return;

		const detect = () => {
			const video = videoRef.current;
			if (!video || video.paused || video.ended) {
				requestRef.current = requestAnimationFrame(detect);
				return;
			}

			// Only process if video time has changed
			if (video.currentTime !== lastVideoTimeRef.current) {
				lastVideoTimeRef.current = video.currentTime;

				const startTimeMs = performance.now();
				const result = landmarkerRef.current?.detectForVideo(
					video,
					startTimeMs,
				);

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
					targetZoom = Math.min(Math.max(targetZoom, MIN_ZOOM), MAX_ZOOM);

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
					if (zoomDelta > ZOOM_THRESHOLD || panDist > PAN_THRESHOLD) {
						committedTargetRef.current = {
							zoom: targetZoom,
							pan: { x: targetPanX, y: targetPanY },
						};
					}

					// Smooth Interpolation (Lerp) towards COMMITTED target
					currentZoomRef.current =
						currentZoomRef.current +
						(committedTargetRef.current.zoom - currentZoomRef.current) *
							smoothFactor;
					currentPanRef.current.x =
						currentPanRef.current.x +
						(committedTargetRef.current.pan.x - currentPanRef.current.x) *
							smoothFactor;
					currentPanRef.current.y =
						currentPanRef.current.y +
						(committedTargetRef.current.pan.y - currentPanRef.current.y) *
							smoothFactor;

					// Clamp pan to viewport bounds (using normalized coordinates)
					const { pan: clampedPan, clampedEdges: edges } = clampNormalizedPan(
						currentPanRef.current,
						currentZoomRef.current,
					);
					currentPanRef.current = clampedPan;

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
						currentZoom: currentZoomRef.current,
						currentPan: { ...currentPanRef.current },
						clampedEdges: edges,
						videoSize: { width: video.videoWidth, height: video.videoHeight },
					};
					debugTraceRef.current.push(traceEntry);
					if (debugTraceRef.current.length > DEBUG_TRACE_MAX_ENTRIES) {
						debugTraceRef.current.shift();
					}

					setZoom(currentZoomRef.current);
					setPan({ ...currentPanRef.current });
					setClampedEdges(edges);
					setDebugLandmarks(result.landmarks);
				} else {
					// No hands? Slowly zoom out to 1
					// For zoom out, we can bypass hysteresis or set target to 1
					committedTargetRef.current = { zoom: 1, pan: { x: 0, y: 0 } };

					currentZoomRef.current =
						currentZoomRef.current +
						(1 - currentZoomRef.current) * (smoothFactor * 0.5);
					currentPanRef.current.x =
						currentPanRef.current.x +
						(0 - currentPanRef.current.x) * (smoothFactor * 0.5);
					currentPanRef.current.y =
						currentPanRef.current.y +
						(0 - currentPanRef.current.y) * (smoothFactor * 0.5);

					// Clamp pan to viewport bounds (using normalized coordinates)
					const { pan: clampedPan, clampedEdges: edges } = clampNormalizedPan(
						currentPanRef.current,
						currentZoomRef.current,
					);
					currentPanRef.current = clampedPan;

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
						currentZoom: currentZoomRef.current,
						currentPan: { ...currentPanRef.current },
						clampedEdges: edges,
						videoSize: { width: video.videoWidth, height: video.videoHeight },
					};
					debugTraceRef.current.push(traceEntry);
					if (debugTraceRef.current.length > DEBUG_TRACE_MAX_ENTRIES) {
						debugTraceRef.current.shift();
					}

					setZoom(currentZoomRef.current);
					setPan({ ...currentPanRef.current });
					setClampedEdges(edges);
					setDebugLandmarks([]);
				}
			}

			requestRef.current = requestAnimationFrame(detect);
		};

		detect();

		return () => {
			if (requestRef.current) cancelAnimationFrame(requestRef.current);
		};
	}, [enabled, videoRef, padding, smoothFactor, isModelLoading]);

	// Get debug trace as JSON for download
	const getDebugTrace = useCallback(() => {
		return {
			exportedAt: new Date().toISOString(),
			config: {
				padding,
				smoothFactor,
				minZoom: 1,
				maxZoom: 3,
				zoomThreshold: 0.1,
				panThreshold: 50,
			},
			entries: [...debugTraceRef.current],
		};
	}, [padding, smoothFactor]);

	return {
		isModelLoading,
		zoom,
		pan,
		clampedEdges,
		debugLandmarks,
		getDebugTrace,
	};
}

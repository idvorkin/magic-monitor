import { FilesetResolver, HandLandmarker } from "@mediapipe/tasks-vision";
import { useEffect, useRef, useState } from "react";

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

	// Thresholds
	const ZOOM_THRESHOLD = 0.1;
	const PAN_THRESHOLD = 50;

	// Output state
	const [zoom, setZoom] = useState(1);
	const [pan, setPan] = useState({ x: 0, y: 0 });

	const landmarkerRef = useRef<HandLandmarker | null>(null);
	const requestRef = useRef<number>(0);
	const lastVideoTimeRef = useRef<number>(-1);

	useEffect(() => {
		async function loadModel() {
			try {
				const vision = await FilesetResolver.forVisionTasks(
					"https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0/wasm",
				);

				landmarkerRef.current = await HandLandmarker.createFromOptions(vision, {
					baseOptions: {
						modelAssetPath: `https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task`,
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

					// Clamp zoom
					targetZoom = Math.min(Math.max(targetZoom, 1), 5);

					// Determine target pan
					// Pan is offset from center.
					// If center is 0.5, pan is 0.
					// If center is 0.8, pan should shift view right.
					// Pan units in CSS transform translate(x, y) are usually pixels or percent.
					// Our CameraStage uses pixels: translate(${pan.x}px, ${pan.y}px)
					// But wait, the CameraStage logic for manual pan is:
					// translate(x, y) applied BEFORE scale? Or AFTER?
					// Let's check CameraStage: transform: `scale(${zoom}) translate(${pan.x}px, ${pan.y}px)`
					// This means pan is in PRE-ZOOM coordinates (or post-zoom depending on order).
					// Actually, standard CSS transform order is right-to-left for composition, but written left-to-right.
					// `scale(Z) translate(X, Y)` means:
					// 1. Translate by (X, Y)
					// 2. Scale by Z
					// So X and Y are in the unscaled coordinate space? No, wait.
					// If I translate 100px then scale 2x, the visual shift is 200px.

					// Let's look at how manual pan works in CameraStage:
					// setPan(prev => ({ x: prev.x + dx / zoom, y: prev.y + dy / zoom }));
					// It divides by zoom, implying pan is in "world" (video) coordinates?
					// If I drag 100px on screen, and zoom is 2x, I want to move 50px in video space.

					// Target Center (0-1) needs to be moved to Screen Center (0.5).
					// Delta = 0.5 - CenterX.
					// If CenterX is 0.8 (right side), Delta is -0.3. We need to shift LEFT.
					// So PanX = Delta * VideoWidth.

					const targetPanX = (0.5 - centerX) * video.videoWidth;
					const targetPanY = (0.5 - centerY) * video.videoHeight;

					// Hysteresis / Deadband Check
					const zoomDelta = Math.abs(
						targetZoom - committedTargetRef.current.zoom,
					);
					const panDist = Math.sqrt(
						(targetPanX - committedTargetRef.current.pan.x) ** 2 +
							(targetPanY - committedTargetRef.current.pan.y) ** 2,
					);

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

					setZoom(currentZoomRef.current);
					setPan({ ...currentPanRef.current });
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

					setZoom(currentZoomRef.current);
					setPan({ ...currentPanRef.current });
					setDebugLandmarks([]);
				}
			}

			requestRef.current = requestAnimationFrame(detect);
		};

		detect();

		return () => {
			if (requestRef.current) cancelAnimationFrame(requestRef.current);
		};
	}, [enabled, videoRef, padding, smoothFactor]);

	return {
		isModelLoading,
		zoom,
		pan,
		debugLandmarks,
	};
}

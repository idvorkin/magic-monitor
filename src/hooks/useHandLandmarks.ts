import { useEffect, useRef } from "react";
import { HandLandmarkerService } from "../services/HandLandmarkerService";
import type { HandLandmark } from "../utils/handPose";
import { useLatest } from "./useLatest";
import { useModelLoadingState } from "./useModelLoadingState";

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

interface UseHandLandmarksConfig {
	videoRef: React.RefObject<HTMLVideoElement | null>;
	/** Run the detection loop. False stops it and clears the landmarks. */
	enabled: boolean;
	/**
	 * Called once per newly decoded frame, after `landmarksRef` is updated,
	 * with that frame's hands (an empty array when none were found).
	 * Held in a ref, so a fresh closure each render never restarts the loop.
	 */
	onDetect?: (landmarks: HandLandmark[][], video: HTMLVideoElement) => void;
}

/**
 * Runs MediaPipe hand detection over the live video and publishes the
 * landmarks. Nothing else — no zoom, no pan, no overlay.
 *
 * This is the sole landmark producer in the app. Smart zoom consumes it via
 * `onDetect` to drive its framing; the V-sign trigger consumes `landmarksRef`
 * to watch for the gesture. Because the gesture has to work with smart zoom
 * off, CameraStage runs a second, bare instance of this hook in that case —
 * the two are mutually exclusive, so MediaPipe never runs twice.
 *
 * The loop follows the rAF ref pattern from CLAUDE.md: landmarks change 30-60
 * times a second and no React state is written here at all.
 */
export function useHandLandmarks({
	videoRef,
	enabled,
	onDetect,
}: UseHandLandmarksConfig) {
	const modelLoadingState = useModelLoadingState(HandLandmarkerService, {
		initialIsLoading: true,
	});
	const { isModelLoading } = modelLoadingState;

	// Refs, not state: consumers read these from their own rAF loops.
	const landmarksRef = useRef<HandLandmark[][]>([]);
	const detectTimeMsRef = useRef(0);
	const processingResRef = useRef({ width: 0, height: 0 });

	const onDetectRef = useLatest(onDetect);

	// Offscreen canvas for downscaling video before detection.
	// MediaPipe's hand model works at 224x224 internally, so 640-wide is plenty.
	const processingCanvasRef = useRef<HTMLCanvasElement | null>(null);
	const processingCtxRef = useRef<CanvasRenderingContext2D | null>(null);
	const lastVideoDimsRef = useRef({ width: 0, height: 0 });

	const requestRef = useRef<number>(0);
	const lastVideoTimeRef = useRef<number>(-1);

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
					processingCanvasRef.current ??= document.createElement("canvas");
					processingCanvasRef.current.width = dims.width;
					processingCanvasRef.current.height = dims.height;
					processingCtxRef.current =
						processingCanvasRef.current.getContext("2d");
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
				const result = landmarker.detectForVideo(
					detectInput as unknown as HTMLVideoElement,
					startTimeMs,
				);
				detectTimeMsRef.current = performance.now() - startTimeMs;

				const landmarks = result?.landmarks ?? [];
				landmarksRef.current = landmarks;
				onDetectRef.current?.(landmarks, video);
			}

			requestRef.current = requestAnimationFrame(detect);
		};

		detect();

		return () => {
			if (requestRef.current) cancelAnimationFrame(requestRef.current);
			// Stale landmarks must not outlive the loop: a frozen V in the ref
			// would keep the gesture watcher's hold clock running.
			landmarksRef.current = [];
			lastVideoTimeRef.current = -1;
		};
	}, [enabled, videoRef, isModelLoading, onDetectRef]);

	return {
		...modelLoadingState,
		landmarksRef,
		detectTimeMsRef,
		processingResRef,
	};
}

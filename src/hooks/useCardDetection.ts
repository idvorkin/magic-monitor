import { useEffect, useRef, useState } from "react";
import { CardDetectorService } from "../services/CardDetectorService";
import type { CardDetection } from "../types/cards";
import { useModelLoadingState } from "./useModelLoadingState";

interface CardDetectionConfig {
	videoRef: React.RefObject<HTMLVideoElement | null>;
	enabled: boolean;
	confidenceThreshold?: number; // 0-1, default 0.5
}

export function useCardDetection({
	videoRef,
	enabled,
	confidenceThreshold = 0.5,
}: CardDetectionConfig) {
	const { isModelLoading, loadingProgress, loadingPhase, modelError } =
		useModelLoadingState(CardDetectorService, { enabled });

	// Frame-level detection errors (rejected detect() calls once the model is
	// loaded and running) — a different failure class from modelError above,
	// which only tracks load-time failures via CardDetectorService.subscribe.
	const [detectError, setDetectError] = useState<string | null>(null);

	// Detections stored in ref for 60fps reads (overlay), throttled to state for UI
	const detectionsRef = useRef<CardDetection[]>([]);
	const [detections, setDetections] = useState<CardDetection[]>([]);

	// Perf timing
	const detectTimeMsRef = useRef(0);

	const requestRef = useRef<number>(0);
	const lastVideoTimeRef = useRef<number>(-1);
	const frameCountRef = useRef(0);

	// Throttle React state updates to ~10Hz (every 3 frames at 30fps)
	const UI_UPDATE_INTERVAL = 3;

	// Detection loop
	// biome-ignore lint/correctness/useExhaustiveDependencies: isModelLoading triggers re-run when model loads
	useEffect(() => {
		if (!enabled || !CardDetectorService.isReady() || !videoRef.current) return;

		let running = true;

		const detect = async () => {
			if (!running) return;

			const video = videoRef.current;
			if (
				!video ||
				video.paused ||
				video.ended ||
				video.readyState < 2 ||
				video.videoWidth === 0
			) {
				requestRef.current = requestAnimationFrame(() => {
					detect();
				});
				return;
			}

			// Only process if video time changed
			if (video.currentTime !== lastVideoTimeRef.current) {
				lastVideoTimeRef.current = video.currentTime;
				frameCountRef.current++;

				// Skip every other frame to reduce GPU contention with hand tracking
				if (frameCountRef.current % 2 === 0) {
					const t0 = performance.now();
					try {
						const results = await CardDetectorService.detect(
							video,
							confidenceThreshold,
						);
						detectTimeMsRef.current = performance.now() - t0;

						detectionsRef.current = results;

						// Clear any previous frame-level error now that detection succeeded.
						// Functional update instead of reading `detectError` from the
						// closure: this effect only depends on [enabled, videoRef,
						// confidenceThreshold, isModelLoading], so a closure read would be
						// stale, and adding detectError to the deps would tear down and
						// restart the whole rAF loop every time it's cleared.
						setDetectError((prev) => (prev === null ? prev : null));

						// Throttle React state updates
						if (frameCountRef.current % UI_UPDATE_INTERVAL === 0) {
							setDetections(results);
						}
					} catch (err) {
						// Keep the loop alive: one bad frame (WebGPU device loss, transient
						// ORT error) must not kill card detection permanently.
						console.error("Card detection frame failed:", err);
						setDetectError(
							err instanceof Error ? err.message : "Detection failed",
						);
					}
				}
			}

			requestRef.current = requestAnimationFrame(() => {
				detect();
			});
		};

		detect();

		return () => {
			running = false;
			if (requestRef.current) cancelAnimationFrame(requestRef.current);
		};
	}, [enabled, videoRef, confidenceThreshold, isModelLoading]);

	// Clear detections when disabled
	useEffect(() => {
		if (!enabled) {
			detectionsRef.current = [];
			// eslint-disable-next-line react-hooks/set-state-in-effect -- clearing detections on disable
			setDetections([]);
		}
	}, [enabled]);

	return {
		isModelLoading,
		loadingProgress,
		loadingPhase,
		modelError,
		detectError,
		detections,
		detectionsRef,
		detectTimeMsRef,
	};
}

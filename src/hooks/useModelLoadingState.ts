import { useEffect, useState } from "react";
import type { LoadingState } from "../services/createModelLoader";

export interface ModelLoadingState {
	isModelLoading: boolean;
	loadingProgress: number;
	loadingPhase: "downloading" | "initializing";
	modelError: string | null;
}

interface LoadableService {
	subscribe(listener: (state: LoadingState) => void): () => void;
	load(): Promise<unknown>;
}

interface UseModelLoadingStateOptions {
	/**
	 * Whether to trigger `service.load()`. Defaults to true (load
	 * unconditionally on mount, as HandLandmarkerService's consumer does).
	 * Pass a live boolean (e.g. CardDetectorService's `enabled` config) to
	 * gate loading and re-trigger it when it flips to true.
	 */
	enabled?: boolean;
	/**
	 * Initial `isModelLoading` value for the render before the subscription
	 * effect's first notification arrives. Callers that always load on
	 * mount want `true` here to avoid a one-frame "not loading" flash.
	 */
	initialIsLoading?: boolean;
}

/**
 * Subscribes to a createModelLoader-backed singleton service's loading
 * state and mirrors it into React state. Shared by useSmartZoom
 * (HandLandmarkerService) and useCardDetection (CardDetectorService) —
 * previously each hook duplicated this subscribe/load effect itself.
 */
export function useModelLoadingState(
	service: LoadableService,
	{
		enabled = true,
		initialIsLoading = false,
	}: UseModelLoadingStateOptions = {},
): ModelLoadingState {
	const [isModelLoading, setIsModelLoading] = useState(initialIsLoading);
	const [loadingProgress, setLoadingProgress] = useState(0);
	const [loadingPhase, setLoadingPhase] = useState<
		"downloading" | "initializing"
	>("downloading");
	const [modelError, setModelError] = useState<string | null>(null);

	useEffect(() => {
		const handleStateChange = (state: LoadingState) => {
			setIsModelLoading(
				state.phase === "downloading" || state.phase === "initializing",
			);
			setLoadingProgress(state.progress);
			setLoadingPhase(
				state.phase === "initializing" ? "initializing" : "downloading",
			);
			setModelError(
				state.phase === "error"
					? (state.error?.message ?? "Unknown error")
					: null,
			);
		};

		const unsubscribe = service.subscribe(handleStateChange);

		if (enabled) {
			// Trigger model loading (no-op if already loaded/loading)
			service.load();
		}

		return unsubscribe;
	}, [service, enabled]);

	return { isModelLoading, loadingProgress, loadingPhase, modelError };
}

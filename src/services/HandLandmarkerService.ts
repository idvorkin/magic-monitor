/**
 * Singleton service for MediaPipe HandLandmarker model.
 *
 * The model takes 3-5 seconds to download and initialize. This service
 * ensures the model is loaded once and shared across all components
 * (CameraStage, ReplayView) instead of reloading on every mount.
 */
import { FilesetResolver, HandLandmarker } from "@mediapipe/tasks-vision";
import { createModelLoader, fetchModelBytes } from "./createModelLoader";

export type { LoadingPhase, LoadingState } from "./createModelLoader";

const loader = createModelLoader<HandLandmarker>({
	name: "HandLandmarkerService",
	fetchAndInit: async (reportProgress, setPhase) => {
		// Use local WASM files for offline support
		const vision = await FilesetResolver.forVisionTasks("/mediapipe/wasm");

		// Fetch model with progress tracking
		const modelBuffer = await fetchModelBytes(
			"/mediapipe/hand_landmarker.task",
			reportProgress,
		);

		// Download complete, now initializing model
		setPhase("initializing");

		// Create HandLandmarker with GPU delegate specified during creation
		console.log(
			"[HandLandmarkerService] Creating HandLandmarker with GPU delegate...",
		);
		const model = await HandLandmarker.createFromOptions(vision, {
			baseOptions: {
				modelAssetBuffer: modelBuffer,
				delegate: "GPU",
			},
			runningMode: "VIDEO",
			numHands: 2,
		});

		// Log WebGL availability for GPU delegate diagnostics
		const canvas = document.createElement("canvas");
		const gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
		console.log(
			"[HandLandmarkerService] WebGL available:",
			!!gl,
			gl ? `(${gl.getParameter(gl.VERSION)})` : "",
		);
		console.log(
			"[HandLandmarkerService] HandLandmarker initialized successfully",
		);

		return model;
	},
});

// Export singleton instance
export const HandLandmarkerService = {
	/**
	 * Get the current loading state
	 */
	getState: () => loader.getState(),

	/**
	 * Get the model if loaded, or null if not ready
	 */
	getModel: () => loader.getModel(),

	/**
	 * Subscribe to loading state changes
	 */
	subscribe: (listener: Parameters<typeof loader.subscribe>[0]) =>
		loader.subscribe(listener),

	/**
	 * Load the model if not already loaded/loading.
	 * Returns a promise that resolves when the model is ready.
	 * Safe to call multiple times - subsequent calls return the same promise.
	 */
	load: () => loader.load(),

	/**
	 * Check if the model is ready for use
	 */
	isReady: () => loader.isReady(),

	/**
	 * Check if the model is currently loading
	 */
	isLoading: () => loader.isLoading(),

	/**
	 * Reset the service state (for testing only).
	 * Closes any loaded model and resets to initial state.
	 */
	_reset: (): void => {
		loader.getModel()?.close();
		loader._reset();
	},
};

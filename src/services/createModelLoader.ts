/**
 * Shared model-loading infrastructure for singleton ML services.
 *
 * HandLandmarkerService (MediaPipe) and CardDetectorService (ONNX Runtime)
 * both download a large binary model over HTTP with progress reporting,
 * then hand the bytes off to a service-specific construction step
 * (`HandLandmarker.createFromOptions` vs `ort.InferenceSession.create`).
 * This module owns the parts that were duplicated verbatim between them:
 * the idle/downloading/initializing/ready/error state machine, pub-sub,
 * and load() dedup. `fetchModelBytes` is the shared streaming-download-
 * with-progress helper — services call it from inside their `fetchAndInit`
 * so the M6 `response.ok` check lives in exactly one place.
 *
 * Domain logic (WASM setup, model construction, resource disposal) stays
 * in each service; `_reset()` here only clears the state this module owns
 * — callers are responsible for disposing the resource itself.
 */

export type LoadingPhase =
	| "idle"
	| "downloading"
	| "initializing"
	| "ready"
	| "error";

export interface LoadingState {
	phase: LoadingPhase;
	progress: number; // 0-100 for downloading phase
	error?: Error;
}

type LoadingListener = (state: LoadingState) => void;

export interface ModelLoader<TModel> {
	getState(): LoadingState;
	getModel(): TModel | null;
	subscribe(listener: LoadingListener): () => void;
	load(): Promise<TModel | null>;
	isReady(): boolean;
	isLoading(): boolean;
	_reset(): void;
}

export interface CreateModelLoaderConfig<TModel> {
	/** Used in error-log prefixes, e.g. "[HandLandmarkerService]". */
	name: string;
	/**
	 * Downloads and constructs the model/session. Receives reporters to
	 * update the shared loading state while streaming the download and
	 * while doing service-specific initialization afterward.
	 */
	fetchAndInit: (
		reportProgress: (progress: number) => void,
		setPhase: (phase: "downloading" | "initializing") => void,
	) => Promise<TModel>;
}

export function createModelLoader<TModel>(
	config: CreateModelLoaderConfig<TModel>,
): ModelLoader<TModel> {
	let model: TModel | null = null;
	let loadingState: LoadingState = { phase: "idle", progress: 0 };
	let loadPromise: Promise<TModel | null> | null = null;
	const listeners: Set<LoadingListener> = new Set();

	const notifyListeners = () => {
		for (const listener of listeners) {
			listener(loadingState);
		}
	};

	const updateState = (state: Partial<LoadingState>) => {
		loadingState = { ...loadingState, ...state };
		notifyListeners();
	};

	const loadModel = async (): Promise<TModel | null> => {
		try {
			updateState({ phase: "downloading", progress: 0 });

			const reportProgress = (progress: number) => updateState({ progress });
			// Download is complete once we transition to "initializing" — force
			// progress to 100 regardless of the last streamed percentage (mirrors
			// both services' original behavior of setting phase+progress together).
			const setPhase = (phase: "downloading" | "initializing") =>
				updateState(
					phase === "initializing" ? { phase, progress: 100 } : { phase },
				);

			model = await config.fetchAndInit(reportProgress, setPhase);

			updateState({ phase: "ready" });
			return model;
		} catch (error) {
			console.error(`[${config.name}] Error loading model:`, error);
			updateState({ phase: "error", error: error as Error });
			loadPromise = null; // Allow retry
			return null;
		}
	};

	return {
		getState(): LoadingState {
			return loadingState;
		},

		getModel(): TModel | null {
			return model;
		},

		subscribe(listener: LoadingListener): () => void {
			listeners.add(listener);
			// Immediately notify with current state
			listener(loadingState);
			return () => {
				listeners.delete(listener);
			};
		},

		async load(): Promise<TModel | null> {
			// Already loaded
			if (model) {
				return model;
			}

			// Already loading - return existing promise
			if (loadPromise) {
				return loadPromise;
			}

			// Start loading
			loadPromise = loadModel();
			return loadPromise;
		},

		isReady(): boolean {
			return loadingState.phase === "ready" && model !== null;
		},

		isLoading(): boolean {
			return (
				loadingState.phase === "downloading" ||
				loadingState.phase === "initializing"
			);
		},

		_reset(): void {
			model = null;
			loadingState = { phase: "idle", progress: 0 };
			loadPromise = null;
			listeners.clear();
		},
	};
}

/**
 * Streaming fetch with download-progress reporting, shared by both model
 * loaders. Throws if the HTTP response isn't ok (M6: a 404/500 must not be
 * silently treated as a valid model body) or if the response has no body.
 */
export async function fetchModelBytes(
	url: string,
	onProgress: (progress: number) => void,
): Promise<Uint8Array> {
	const response = await fetch(url);

	if (!response.ok) {
		throw new Error(`Model download failed: HTTP ${response.status}`);
	}

	const contentLength = response.headers.get("Content-Length");
	const total = contentLength ? parseInt(contentLength, 10) : 0;

	if (!response.body) {
		throw new Error("Response body is null");
	}

	const reader = response.body.getReader();
	let receivedLength = 0;
	const chunks: Uint8Array[] = [];

	// Read chunks and track progress
	while (true) {
		const { done, value } = await reader.read();

		if (done) break;

		chunks.push(value);
		receivedLength += value.length;

		// Update progress (0-100%)
		if (total > 0) {
			onProgress(Math.round((receivedLength / total) * 100));
		}
	}

	// Combine chunks into single Uint8Array
	const modelBuffer = new Uint8Array(receivedLength);
	let position = 0;
	for (const chunk of chunks) {
		modelBuffer.set(chunk, position);
		position += chunk.length;
	}

	return modelBuffer;
}

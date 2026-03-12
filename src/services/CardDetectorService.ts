/**
 * Singleton service for YOLO playing card detection via ONNX Runtime Web.
 *
 * Mirrors HandLandmarkerService: loads model once, shares across components,
 * exposes loading state via subscribe pattern.
 *
 * Model: PD-Mera YOLOv8s (416x416 input, 52 card classes)
 */
import * as ort from "onnxruntime-web";
import {
	NUM_CLASSES,
	cardToLabel,
	classIndexToCard,
	type BoundingBox,
	type CardDetection,
} from "../types/cards";

export type LoadingPhase = "idle" | "downloading" | "initializing" | "ready" | "error";

export interface LoadingState {
	phase: LoadingPhase;
	progress: number; // 0-100 for downloading phase
	error?: Error;
}

type LoadingListener = (state: LoadingState) => void;

// YOLO model input size (square)
const MODEL_INPUT_SIZE = 416;
const MODEL_PATH =
	"https://idvorkin-models.s3.us-west-2.amazonaws.com/card-detector.onnx";

// NMS parameters
const NMS_IOU_THRESHOLD = 0.5;

/**
 * Compute IoU (intersection over union) between two boxes.
 * Boxes are in center format: { x, y, width, height } normalized 0-1.
 */
function computeIoU(a: BoundingBox, b: BoundingBox): number {
	const ax1 = a.x - a.width / 2;
	const ay1 = a.y - a.height / 2;
	const ax2 = a.x + a.width / 2;
	const ay2 = a.y + a.height / 2;

	const bx1 = b.x - b.width / 2;
	const by1 = b.y - b.height / 2;
	const bx2 = b.x + b.width / 2;
	const by2 = b.y + b.height / 2;

	const ix1 = Math.max(ax1, bx1);
	const iy1 = Math.max(ay1, by1);
	const ix2 = Math.min(ax2, bx2);
	const iy2 = Math.min(ay2, by2);

	const iw = Math.max(0, ix2 - ix1);
	const ih = Math.max(0, iy2 - iy1);
	const intersection = iw * ih;

	const aArea = a.width * a.height;
	const bArea = b.width * b.height;
	const union = aArea + bArea - intersection;

	return union > 0 ? intersection / union : 0;
}

/**
 * Non-max suppression: remove overlapping detections, keep highest confidence.
 */
export function nms(detections: CardDetection[], iouThreshold = NMS_IOU_THRESHOLD): CardDetection[] {
	const sorted = [...detections].sort((a, b) => b.confidence - a.confidence);
	const kept: CardDetection[] = [];

	for (const det of sorted) {
		const dominated = kept.some((k) => computeIoU(k.bbox, det.bbox) > iouThreshold);
		if (!dominated) {
			kept.push(det);
		}
	}

	return kept;
}

/**
 * Parse YOLO output tensor into CardDetection[].
 *
 * YOLOv8 output shape: [1, 56, 8400] where:
 *   - 56 = 4 bbox coords + 52 class scores
 *   - 8400 = number of anchor predictions
 *
 * Each column is one prediction: [cx, cy, w, h, class0_score, class1_score, ...]
 */
export function parseYoloOutput(
	outputData: Float32Array,
	numPredictions: number,
	confidenceThreshold: number,
	inputWidth: number,
	inputHeight: number,
): CardDetection[] {
	const detections: CardDetection[] = [];

	for (let i = 0; i < numPredictions; i++) {
		// Find max class score for this prediction
		let maxScore = 0;
		let maxClassIdx = 0;
		for (let c = 0; c < NUM_CLASSES; c++) {
			const score = outputData[(4 + c) * numPredictions + i];
			if (score > maxScore) {
				maxScore = score;
				maxClassIdx = c;
			}
		}

		if (maxScore < confidenceThreshold) continue;

		const card = classIndexToCard(maxClassIdx);
		if (!card) continue;

		// Extract bbox (center format, pixel coords relative to model input)
		const cx = outputData[0 * numPredictions + i] / inputWidth;
		const cy = outputData[1 * numPredictions + i] / inputHeight;
		const w = outputData[2 * numPredictions + i] / inputWidth;
		const h = outputData[3 * numPredictions + i] / inputHeight;

		detections.push({
			card,
			label: cardToLabel(card),
			bbox: { x: cx, y: cy, width: w, height: h },
			confidence: maxScore,
		});
	}

	return nms(detections);
}

class CardDetectorServiceImpl {
	private session: ort.InferenceSession | null = null;
	private loadingState: LoadingState = { phase: "idle", progress: 0 };
	private loadPromise: Promise<ort.InferenceSession | null> | null = null;
	private listeners: Set<LoadingListener> = new Set();

	// Reusable canvas for preprocessing
	private preprocessCanvas: HTMLCanvasElement | null = null;
	private preprocessCtx: CanvasRenderingContext2D | null = null;

	getState(): LoadingState {
		return this.loadingState;
	}

	getSession(): ort.InferenceSession | null {
		return this.session;
	}

	subscribe(listener: LoadingListener): () => void {
		this.listeners.add(listener);
		listener(this.loadingState);
		return () => {
			this.listeners.delete(listener);
		};
	}

	private notifyListeners() {
		for (const listener of this.listeners) {
			listener(this.loadingState);
		}
	}

	private updateState(state: Partial<LoadingState>) {
		this.loadingState = { ...this.loadingState, ...state };
		this.notifyListeners();
	}

	async load(): Promise<ort.InferenceSession | null> {
		if (this.session) return this.session;
		if (this.loadPromise) return this.loadPromise;

		this.loadPromise = this.loadModel();
		return this.loadPromise;
	}

	private async loadModel(): Promise<ort.InferenceSession | null> {
		try {
			this.updateState({ phase: "downloading", progress: 0 });

			// Fetch model with progress tracking
			const response = await fetch(MODEL_PATH);

			if (!response.ok) {
				throw new Error(`Failed to fetch model: ${response.status} ${response.statusText}`);
			}

			const contentLength = response.headers.get("Content-Length");
			const total = contentLength ? parseInt(contentLength, 10) : 0;

			if (!response.body) {
				throw new Error("Response body is null");
			}

			const reader = response.body.getReader();
			let receivedLength = 0;
			const chunks: Uint8Array[] = [];

			while (true) {
				const { done, value } = await reader.read();
				if (done) break;

				chunks.push(value);
				receivedLength += value.length;

				if (total > 0) {
					this.updateState({ progress: Math.round((receivedLength / total) * 100) });
				}
			}

			const modelBuffer = new Uint8Array(receivedLength);
			let position = 0;
			for (const chunk of chunks) {
				modelBuffer.set(chunk, position);
				position += chunk.length;
			}

			this.updateState({ phase: "initializing", progress: 100 });

			console.log("[CardDetectorService] Creating ONNX inference session...");
			this.session = await ort.InferenceSession.create(modelBuffer.buffer, {
				executionProviders: ["webgl"],
				graphOptimizationLevel: "all",
			});

			console.log("[CardDetectorService] ONNX session created successfully");
			console.log("[CardDetectorService] Input names:", this.session.inputNames);
			console.log("[CardDetectorService] Output names:", this.session.outputNames);

			this.updateState({ phase: "ready" });
			return this.session;
		} catch (error) {
			console.error("[CardDetectorService] Error loading model:", error);
			this.updateState({ phase: "error", error: error as Error });
			this.loadPromise = null; // Allow retry
			return null;
		}
	}

	/**
	 * Run card detection on a video frame.
	 * Returns detections above the confidence threshold.
	 */
	async detect(
		source: HTMLVideoElement | HTMLCanvasElement,
		confidenceThreshold = 0.5,
	): Promise<CardDetection[]> {
		if (!this.session) return [];

		// Preprocess: resize to MODEL_INPUT_SIZE x MODEL_INPUT_SIZE
		if (!this.preprocessCanvas) {
			this.preprocessCanvas = document.createElement("canvas");
			this.preprocessCanvas.width = MODEL_INPUT_SIZE;
			this.preprocessCanvas.height = MODEL_INPUT_SIZE;
			this.preprocessCtx = this.preprocessCanvas.getContext("2d", { willReadFrequently: true });
		}

		const ctx = this.preprocessCtx;
		if (!ctx) return [];

		ctx.drawImage(source, 0, 0, MODEL_INPUT_SIZE, MODEL_INPUT_SIZE);
		const imageData = ctx.getImageData(0, 0, MODEL_INPUT_SIZE, MODEL_INPUT_SIZE);

		// Convert RGBA to RGB float32 tensor [1, 3, H, W] normalized to [0, 1]
		const { data } = imageData;
		const numPixels = MODEL_INPUT_SIZE * MODEL_INPUT_SIZE;
		const float32Data = new Float32Array(3 * numPixels);

		for (let i = 0; i < numPixels; i++) {
			float32Data[i] = data[i * 4] / 255; // R
			float32Data[numPixels + i] = data[i * 4 + 1] / 255; // G
			float32Data[2 * numPixels + i] = data[i * 4 + 2] / 255; // B
		}

		const inputTensor = new ort.Tensor("float32", float32Data, [1, 3, MODEL_INPUT_SIZE, MODEL_INPUT_SIZE]);

		const inputName = this.session.inputNames[0];
		const results = await this.session.run({ [inputName]: inputTensor });

		const outputName = this.session.outputNames[0];
		const output = results[outputName];
		const outputData = output.data as Float32Array;

		// YOLOv8 output: [1, 56, N] where N is number of predictions
		const numPredictions = output.dims[2];

		return parseYoloOutput(outputData, numPredictions, confidenceThreshold, MODEL_INPUT_SIZE, MODEL_INPUT_SIZE);
	}

	isReady(): boolean {
		return this.loadingState.phase === "ready" && this.session !== null;
	}

	isLoading(): boolean {
		return this.loadingState.phase === "downloading" || this.loadingState.phase === "initializing";
	}

	_reset(): void {
		this.session?.release();
		this.session = null;
		this.loadingState = { phase: "idle", progress: 0 };
		this.loadPromise = null;
		this.listeners.clear();
		this.preprocessCanvas = null;
		this.preprocessCtx = null;
	}
}

export const CardDetectorService = new CardDetectorServiceImpl();

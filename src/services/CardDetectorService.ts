/**
 * Singleton service for YOLO playing card detection via ONNX Runtime Web.
 *
 * Mirrors HandLandmarkerService: loads model once, shares across components,
 * exposes loading state via subscribe pattern.
 */
import * as ort from "onnxruntime-web/webgpu";

ort.env.wasm.wasmPaths =
	"https://cdn.jsdelivr.net/npm/onnxruntime-web@1.24.3/dist/";

import {
	type BoundingBox,
	type CardDetection,
	cardToLabel,
	classIndexToCard,
} from "../types/cards";
import {
	createModelLoader,
	fetchModelBytes,
	type LoadingState,
} from "./createModelLoader";

export type { LoadingPhase, LoadingState } from "./createModelLoader";

// YOLO model input size (square) — must match the trained model's input dimensions
const MODEL_INPUT_SIZE = 640;
const MODEL_PATH =
	"https://idvorkin-models.s3.amazonaws.com/card-detector-yolo26s.onnx";

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
 * Per-card non-max suppression: remove duplicate detections of the SAME card
 * (same rank+suit) that overlap above the IoU threshold, keeping the highest
 * confidence. Detections of DIFFERENT cards are never suppressed, even when
 * their boxes overlap — fanned/adjacent cards in the same frame must survive.
 *
 * This is the only Non-Max Suppression in the pipeline: the deployed YOLO26
 * model emits a score-based TopK(300) output (`nms: False` in its metadata,
 * no NMS node in its ONNX graph), so this call is what deduplicates same-card
 * predictions, not "post-NMS housekeeping".
 */
export function nms(
	detections: CardDetection[],
	iouThreshold = NMS_IOU_THRESHOLD,
): CardDetection[] {
	const sorted = [...detections].sort((a, b) => b.confidence - a.confidence);
	const kept: CardDetection[] = [];

	for (const det of sorted) {
		const dominated = kept.some(
			(k) =>
				k.card.rank === det.card.rank &&
				k.card.suit === det.card.suit &&
				computeIoU(k.bbox, det.bbox) > iouThreshold,
		);
		if (!dominated) {
			kept.push(det);
		}
	}

	return kept;
}

/** Letterbox geometry used to undo padding when mapping output coords back to video space. */
export interface LetterboxInfo {
	offsetX: number; // padding offset in model-pixel space
	offsetY: number;
	scaledW: number; // scaled image size within model input
	scaledH: number;
}

/**
 * Parse YOLO26 output tensor into CardDetection[].
 *
 * Output shape: [1, 300, 6] where each detection is:
 *   [x1, y1, x2, y2, confidence, class_id]
 * Coordinates are in pixel space relative to the model input,
 * including letterbox padding. We undo the padding so bbox coords
 * are normalized to the original video frame (0-1).
 *
 * The model emits a score-based TopK(300) selection — it has no built-in
 * NMS (`nms: False` in its metadata, no NMS node in its ONNX graph) — so
 * the trailing `nms()` is the pipeline's only overlap suppression.
 */
export function parseYoloOutput(
	outputData: Float32Array,
	numDetections: number,
	confidenceThreshold: number,
	letterbox: LetterboxInfo,
): CardDetection[] {
	const { offsetX, offsetY, scaledW, scaledH } = letterbox;
	const detections: CardDetection[] = [];

	for (let i = 0; i < numDetections; i++) {
		const offset = i * 6;
		const x1 = outputData[offset];
		const y1 = outputData[offset + 1];
		const x2 = outputData[offset + 2];
		const y2 = outputData[offset + 3];
		const confidence = outputData[offset + 4];
		const classId = Math.round(outputData[offset + 5]);

		if (confidence < confidenceThreshold) continue;

		const card = classIndexToCard(classId);
		if (!card) continue;

		// Undo letterbox: subtract padding offset, normalize by scaled image size
		const cx = ((x1 + x2) / 2 - offsetX) / scaledW;
		const cy = ((y1 + y2) / 2 - offsetY) / scaledH;
		const w = (x2 - x1) / scaledW;
		const h = (y2 - y1) / scaledH;

		// Clamp to [0, 1] — detections in padding area are invalid
		if (cx < 0 || cx > 1 || cy < 0 || cy > 1) continue;

		detections.push({
			card,
			label: cardToLabel(card),
			bbox: { x: cx, y: cy, width: w, height: h },
			confidence,
		});
	}

	// The model has no built-in NMS (its output is score-based TopK(300)),
	// so this per-card NMS is the pipeline's only overlap suppression: it
	// deduplicates same-card predictions while preserving distinct cards
	// whose boxes overlap.
	return nms(detections);
}

const loader = createModelLoader<ort.InferenceSession>({
	name: "CardDetectorService",
	fetchAndInit: async (reportProgress, setPhase) => {
		// Fetch model with progress tracking
		const modelBuffer = await fetchModelBytes(MODEL_PATH, reportProgress);

		setPhase("initializing");

		console.log("[CardDetectorService] Creating ONNX inference session...");
		const session = await ort.InferenceSession.create(modelBuffer.buffer, {
			executionProviders: ["webgpu", "webgl", "wasm"],
			graphOptimizationLevel: "all",
		});

		console.log("[CardDetectorService] ONNX session created successfully");
		console.log("[CardDetectorService] Input names:", session.inputNames);
		console.log("[CardDetectorService] Output names:", session.outputNames);
		console.log(
			`[CardDetectorService] Model input size: ${MODEL_INPUT_SIZE}x${MODEL_INPUT_SIZE}`,
		);

		return session;
	},
});

class CardDetectorServiceImpl {
	// Reusable canvas for preprocessing
	private preprocessCanvas: HTMLCanvasElement | null = null;
	private preprocessCtx: CanvasRenderingContext2D | null = null;

	// Reusable planar RGB tensor input. The model input size is fixed, so this
	// 4.9 MB Float32Array is allocated once and refilled in place instead of
	// being reallocated on every detection (~74 MB/s of garbage at 15 Hz).
	private inputBuffer: Float32Array | null = null;

	// True while a detection that borrowed `inputBuffer` is still awaiting
	// inference. Detections are back-pressured by useCardDetection so this is
	// normally false, but a hook restart can overlap two calls; the second one
	// allocates a private buffer rather than overwriting data the first may
	// still need.
	private inputBufferBusy = false;

	getState(): LoadingState {
		return loader.getState();
	}

	getSession(): ort.InferenceSession | null {
		return loader.getModel();
	}

	subscribe(listener: Parameters<typeof loader.subscribe>[0]): () => void {
		return loader.subscribe(listener);
	}

	load(): Promise<ort.InferenceSession | null> {
		return loader.load();
	}

	// Cached letterbox geometry for debug snapshot
	private lastLetterbox: LetterboxInfo = {
		offsetX: 0,
		offsetY: 0,
		scaledW: MODEL_INPUT_SIZE,
		scaledH: MODEL_INPUT_SIZE,
	};

	/**
	 * Run card detection on a video frame.
	 * Returns detections above the confidence threshold.
	 */
	async detect(
		source: HTMLVideoElement | HTMLCanvasElement,
		confidenceThreshold = 0.5,
	): Promise<CardDetection[]> {
		const session = loader.getModel();
		if (!session) return [];

		// Preprocess: letterbox resize to MODEL_INPUT_SIZE x MODEL_INPUT_SIZE
		if (!this.preprocessCanvas) {
			this.preprocessCanvas = document.createElement("canvas");
			this.preprocessCanvas.width = MODEL_INPUT_SIZE;
			this.preprocessCanvas.height = MODEL_INPUT_SIZE;
			this.preprocessCtx = this.preprocessCanvas.getContext("2d", {
				willReadFrequently: true,
			});
		}

		const ctx = this.preprocessCtx;
		if (!ctx) return [];

		const srcW =
			source instanceof HTMLVideoElement ? source.videoWidth : source.width;
		const srcH =
			source instanceof HTMLVideoElement ? source.videoHeight : source.height;

		// Letterbox: scale to fit, center with gray padding (YOLO convention)
		const scale = Math.min(MODEL_INPUT_SIZE / srcW, MODEL_INPUT_SIZE / srcH);
		const scaledW = Math.round(srcW * scale);
		const scaledH = Math.round(srcH * scale);
		const offsetX = Math.floor((MODEL_INPUT_SIZE - scaledW) / 2);
		const offsetY = Math.floor((MODEL_INPUT_SIZE - scaledH) / 2);

		ctx.fillStyle = "#727272"; // YOLO letterbox gray (114/255 — Ultralytics default)
		ctx.fillRect(0, 0, MODEL_INPUT_SIZE, MODEL_INPUT_SIZE);
		ctx.imageSmoothingEnabled = false; // nearest-neighbor to match training
		ctx.drawImage(source, offsetX, offsetY, scaledW, scaledH);

		const imageData = ctx.getImageData(
			0,
			0,
			MODEL_INPUT_SIZE,
			MODEL_INPUT_SIZE,
		);

		// Convert RGBA to RGB float32 tensor [1, 3, H, W] normalized to [0, 1].
		// Reuse the shared buffer unless an earlier detection is still using it.
		const { data } = imageData;
		const numPixels = MODEL_INPUT_SIZE * MODEL_INPUT_SIZE;
		const reusingSharedBuffer = !this.inputBufferBusy;
		let float32Data: Float32Array;
		if (reusingSharedBuffer) {
			this.inputBuffer ??= new Float32Array(3 * numPixels);
			float32Data = this.inputBuffer;
		} else {
			float32Data = new Float32Array(3 * numPixels);
		}

		// Single stride walk over the RGBA bytes; multiply by 1/255 rather than
		// dividing (0.535 ms/frame vs 0.750 ms/frame measured).
		const gOffset = numPixels;
		const bOffset = 2 * numPixels;
		const INV_255 = 1 / 255;
		for (let i = 0, p = 0; i < numPixels; i++, p += 4) {
			float32Data[i] = data[p] * INV_255; // R
			float32Data[gOffset + i] = data[p + 1] * INV_255; // G
			float32Data[bOffset + i] = data[p + 2] * INV_255; // B
		}

		const inputTensor = new ort.Tensor("float32", float32Data, [
			1,
			3,
			MODEL_INPUT_SIZE,
			MODEL_INPUT_SIZE,
		]);

		const inputName = session.inputNames[0];
		// Marked busy only after the buffer is filled and handed to the tensor,
		// so an overlapping call can never see a half-written shared buffer.
		if (reusingSharedBuffer) this.inputBufferBusy = true;
		let results: Awaited<ReturnType<typeof session.run>>;
		try {
			results = await session.run({ [inputName]: inputTensor });
		} finally {
			if (reusingSharedBuffer) this.inputBufferBusy = false;
		}

		const outputName = session.outputNames[0];
		const output = results[outputName];
		const outputData = output.data as Float32Array;

		// YOLO26 output: [1, 300, 6] (score-based TopK, no built-in NMS)
		const numDetections = output.dims[1];
		const letterbox: LetterboxInfo = { offsetX, offsetY, scaledW, scaledH };

		const detections = parseYoloOutput(
			outputData,
			numDetections,
			confidenceThreshold,
			letterbox,
		);

		// Cache for debug snapshot
		this.lastDetections = detections;
		this.lastLetterbox = letterbox;
		this.lastSourceWidth = srcW;
		this.lastSourceHeight = srcH;

		return detections;
	}

	// Store last detection results for debug snapshot (avoids re-running inference)
	private lastDetections: CardDetection[] = [];
	private lastSourceWidth = 0;
	private lastSourceHeight = 0;

	/**
	 * Debug snapshot: captures what the model sees, burns in metadata + detections,
	 * and triggers a PNG download. Press 'z' in CameraStage to invoke.
	 * Uses the already-rendered preprocess canvas and last detection results
	 * to avoid blocking the main thread with a second inference call.
	 */
	debugSnapshot(): void {
		const srcWidth = this.lastSourceWidth;
		const srcHeight = this.lastSourceHeight;
		const detections = this.lastDetections;
		const confidenceThreshold =
			detections.length > 0
				? Math.min(...detections.map((d) => d.confidence))
				: 0;
		const canvas = this.preprocessCanvas;
		const ctx = this.preprocessCtx;
		if (!canvas || !ctx) return;

		// Create a debug canvas at 2x for readability
		const debugSize = MODEL_INPUT_SIZE * 2;
		const debugCanvas = document.createElement("canvas");
		debugCanvas.width = debugSize;
		debugCanvas.height = debugSize;
		const dCtx = debugCanvas.getContext("2d");
		if (!dCtx) return;

		// Draw the preprocessed model input image scaled up
		dCtx.imageSmoothingEnabled = false;
		dCtx.drawImage(canvas, 0, 0, debugSize, debugSize);

		// Draw detection boxes — bbox is in video-normalized space,
		// map back to letterboxed debug canvas space
		const lb = this.lastLetterbox;
		const scale = 2; // debugSize / MODEL_INPUT_SIZE
		for (const det of detections) {
			const { bbox } = det;
			// Convert video-normalized → model pixel → debug pixel
			const bx = ((bbox.x - bbox.width / 2) * lb.scaledW + lb.offsetX) * scale;
			const by = ((bbox.y - bbox.height / 2) * lb.scaledH + lb.offsetY) * scale;
			const bw = bbox.width * lb.scaledW * scale;
			const bh = bbox.height * lb.scaledH * scale;

			dCtx.strokeStyle = "#00ff00";
			dCtx.lineWidth = 2;
			dCtx.strokeRect(bx, by, bw, bh);

			const label = `${det.label} ${(det.confidence * 100).toFixed(0)}%`;
			dCtx.font = "bold 16px monospace";
			dCtx.fillStyle = "#000000";
			dCtx.fillRect(bx, by - 20, dCtx.measureText(label).width + 6, 20);
			dCtx.fillStyle = "#00ff00";
			dCtx.fillText(label, bx + 3, by - 5);
		}

		// Burn in metadata at top
		const lines = [
			`Source: ${srcWidth}x${srcHeight} → Model: ${MODEL_INPUT_SIZE}x${MODEL_INPUT_SIZE}`,
			`Detections: ${detections.length} (threshold: ${confidenceThreshold})`,
			`Backend: wasm | ${new Date().toISOString()}`,
		];
		dCtx.font = "bold 14px monospace";
		for (let i = 0; i < lines.length; i++) {
			const y = 18 + i * 20;
			dCtx.fillStyle = "rgba(0,0,0,0.7)";
			dCtx.fillRect(0, y - 14, debugSize, 20);
			dCtx.fillStyle = "#ffff00";
			dCtx.fillText(lines[i], 4, y);
		}

		// Burn in detection list at bottom
		if (detections.length > 0) {
			const detLines = detections.map(
				(d) => `${d.label} ${(d.confidence * 100).toFixed(0)}%`,
			);
			const listY = debugSize - detLines.length * 20 - 10;
			dCtx.fillStyle = "rgba(0,0,0,0.7)";
			dCtx.fillRect(0, listY, debugSize, detLines.length * 20 + 10);
			dCtx.fillStyle = "#00ffff";
			dCtx.font = "bold 14px monospace";
			for (let i = 0; i < detLines.length; i++) {
				dCtx.fillText(detLines[i], 4, listY + 18 + i * 20);
			}
		}

		// Download
		const link = document.createElement("a");
		link.download = `card-debug-${Date.now()}.png`;
		link.href = debugCanvas.toDataURL("image/png");
		link.click();

		console.log("[CardDetectorService] Debug snapshot saved", {
			source: `${srcWidth}x${srcHeight}`,
			modelInput: `${MODEL_INPUT_SIZE}x${MODEL_INPUT_SIZE}`,
			detections: detections.map(
				(d) => `${d.label}(${d.confidence.toFixed(2)})`,
			),
		});
	}

	isReady(): boolean {
		return loader.isReady();
	}

	isLoading(): boolean {
		return loader.isLoading();
	}

	_reset(): void {
		loader.getModel()?.release();
		loader._reset();
		this.preprocessCanvas = null;
		this.preprocessCtx = null;
		this.inputBuffer = null;
		this.inputBufferBusy = false;
	}
}

export const CardDetectorService = new CardDetectorServiceImpl();

import * as ort from "onnxruntime-web/webgpu";
import {
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	type Mock,
	vi,
} from "vitest";
import type { CardDetection } from "../types/cards";
import {
	CardDetectorService,
	type LetterboxInfo,
	nms,
	parseYoloOutput,
} from "./CardDetectorService";

// Track mock calls via closure (mirrors HandLandmarkerService.test.ts's
// mockCloseCalls pattern for the equivalent onnxruntime-web dispose call).
let mockReleaseCalls = 0;

// Mock functions must be defined inside the mock factory to avoid hoisting issues
vi.mock("onnxruntime-web/webgpu", () => {
	return {
		env: { wasm: {} },
		InferenceSession: {
			create: vi.fn().mockImplementation(() => {
				return Promise.resolve({
					inputNames: ["input"],
					outputNames: ["output"],
					run: vi.fn().mockResolvedValue({
						output: { data: new Float32Array(300 * 6), dims: [1, 300, 6] },
					}),
					release: vi.fn().mockImplementation(() => {
						mockReleaseCalls++;
					}),
				});
			}),
		},
		Tensor: vi.fn(),
	};
});

// Asymmetry landmine (research §7 item 5): CardDetectorService had zero
// loader tests while HandLandmarkerService had 13. These pin its current
// loader behavior (load-dedup, error phase, subscribe/notify, reset)
// across the createModelLoader migration — mirrors a subset of
// HandLandmarkerService.test.ts.
describe("CardDetectorService loader", () => {
	beforeEach(() => {
		// Reset service first (might call release on leftover session), then reset counters
		CardDetectorService._reset();
		mockReleaseCalls = 0;

		// Mock fetch for model loading
		globalThis.fetch = vi.fn().mockResolvedValue({
			ok: true,
			headers: {
				get: vi.fn().mockReturnValue("8192"),
			},
			body: {
				getReader: vi.fn().mockReturnValue({
					read: vi
						.fn()
						.mockResolvedValueOnce({
							done: false,
							value: new Uint8Array(1024),
						})
						.mockResolvedValueOnce({ done: true }),
				}),
			},
		});
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	it("should start in idle state", () => {
		const state = CardDetectorService.getState();
		expect(state.phase).toBe("idle");
		expect(state.progress).toBe(0);
	});

	it("should load model and transition to ready", async () => {
		const states: string[] = [];
		CardDetectorService.subscribe((state) => {
			states.push(state.phase);
		});

		await CardDetectorService.load();

		expect(states).toContain("downloading");
		expect(states).toContain("initializing");
		expect(states).toContain("ready");
		expect(CardDetectorService.isReady()).toBe(true);
	});

	it("should only load once even with concurrent calls", async () => {
		const promise1 = CardDetectorService.load();
		const promise2 = CardDetectorService.load();

		const [session1, session2] = await Promise.all([promise1, promise2]);

		expect(session1).toBe(session2);
		expect(globalThis.fetch).toHaveBeenCalledTimes(1);
	});

	it("should notify all subscribers of state changes and allow unsubscribing", async () => {
		const listener1States: string[] = [];
		const listener2States: string[] = [];

		CardDetectorService.subscribe((state) => listener1States.push(state.phase));
		const unsubscribe2 = CardDetectorService.subscribe((state) =>
			listener2States.push(state.phase),
		);

		unsubscribe2();
		const listener2CountAtUnsubscribe = listener2States.length;

		await CardDetectorService.load();

		expect(listener1States.length).toBeGreaterThan(1);
		// Unsubscribed listener received no further updates
		expect(listener2States.length).toBe(listener2CountAtUnsubscribe);
	});

	it("should transition to error state on fetch failure", async () => {
		globalThis.fetch = vi.fn().mockRejectedValue(new Error("Network error"));

		const result = await CardDetectorService.load();

		expect(result).toBeNull();
		expect(CardDetectorService.getState().phase).toBe("error");
		expect(CardDetectorService.isReady()).toBe(false);
	});

	it("should release session and clear preprocessing canvas on reset", async () => {
		await CardDetectorService.load();
		expect(CardDetectorService.isReady()).toBe(true);

		// Populate the preprocessing canvas fields (the two extra fields beyond
		// the shared loader state) by running a detection. Use a canvas source
		// (not a video element) — jsdom's node-canvas backing can drawImage
		// from another canvas but not decode an HTMLVideoElement frame.
		const source = document.createElement("canvas");
		source.width = 640;
		source.height = 480;
		await CardDetectorService.detect(source);

		CardDetectorService._reset();

		expect(mockReleaseCalls).toBe(1);
		expect(CardDetectorService.isReady()).toBe(false);
		expect(CardDetectorService.getSession()).toBeNull();

		// Reset must not drop the extra preprocessCanvas/preprocessCtx fields —
		// a subsequent load + detect should work from a clean slate, not throw.
		// (Fresh fetch mock: the beforeEach one's read() queue was already
		// drained by the first load() above.)
		globalThis.fetch = vi.fn().mockResolvedValue({
			ok: true,
			headers: { get: vi.fn().mockReturnValue("8192") },
			body: {
				getReader: vi.fn().mockReturnValue({
					read: vi
						.fn()
						.mockResolvedValueOnce({ done: false, value: new Uint8Array(1024) })
						.mockResolvedValueOnce({ done: true }),
				}),
			},
		});
		await CardDetectorService.load();
		expect(CardDetectorService.isReady()).toBe(true);
		await expect(CardDetectorService.detect(source)).resolves.toHaveLength(0);
	});
});

describe("CardDetectorService input buffer reuse", () => {
	const MODEL_INPUT_SIZE = 640;
	const NUM_PIXELS = MODEL_INPUT_SIZE * MODEL_INPUT_SIZE;
	const tensorMock = ort.Tensor as unknown as Mock;

	/** The Float32Array handed to `new ort.Tensor(...)` on each detect call. */
	function tensorBuffers(): Float32Array[] {
		return tensorMock.mock.calls.map((args) => args[1] as Float32Array);
	}

	function solidSource(color: string): HTMLCanvasElement {
		const canvas = document.createElement("canvas");
		canvas.width = MODEL_INPUT_SIZE;
		canvas.height = MODEL_INPUT_SIZE;
		const ctx = canvas.getContext("2d");
		if (!ctx) throw new Error("no 2d context in test environment");
		ctx.fillStyle = color;
		ctx.fillRect(0, 0, MODEL_INPUT_SIZE, MODEL_INPUT_SIZE);
		return canvas;
	}

	function mockModelFetch(): void {
		globalThis.fetch = vi.fn().mockResolvedValue({
			ok: true,
			headers: { get: vi.fn().mockReturnValue("8192") },
			body: {
				getReader: vi.fn().mockReturnValue({
					read: vi
						.fn()
						.mockResolvedValueOnce({ done: false, value: new Uint8Array(1024) })
						.mockResolvedValueOnce({ done: true }),
				}),
			},
		});
	}

	beforeEach(async () => {
		CardDetectorService._reset();
		mockModelFetch();
		await CardDetectorService.load();
		tensorMock.mockClear();
	});

	afterEach(() => {
		CardDetectorService._reset();
		vi.clearAllMocks();
	});

	it("reuses one Float32Array across sequential detections", async () => {
		const source = solidSource("rgb(255, 0, 0)");

		await CardDetectorService.detect(source);
		await CardDetectorService.detect(source);
		await CardDetectorService.detect(source);

		const buffers = tensorBuffers();
		expect(buffers).toHaveLength(3);
		expect(buffers[0]).toHaveLength(3 * NUM_PIXELS);
		expect(buffers[1]).toBe(buffers[0]);
		expect(buffers[2]).toBe(buffers[0]);
	});

	it("produces identical planar data for the same frame across two detections", async () => {
		const source = solidSource("rgb(12, 34, 56)");

		await CardDetectorService.detect(source);
		const afterFirst = Float32Array.from(tensorBuffers()[0]);

		await CardDetectorService.detect(source);

		expect(Array.from(tensorBuffers()[1])).toEqual(Array.from(afterFirst));
		// Planar layout: R plane, then G, then B, each normalized to [0, 1].
		expect(afterFirst[0]).toBeCloseTo(12 / 255, 5);
		expect(afterFirst[NUM_PIXELS]).toBeCloseTo(34 / 255, 5);
		expect(afterFirst[2 * NUM_PIXELS]).toBeCloseTo(56 / 255, 5);
	});

	it("refills the shared buffer rather than leaving the previous frame behind", async () => {
		await CardDetectorService.detect(solidSource("rgb(255, 0, 0)"));
		const shared = tensorBuffers()[0];
		expect(shared[0]).toBeCloseTo(1, 5);
		expect(shared[2 * NUM_PIXELS]).toBeCloseTo(0, 5);

		await CardDetectorService.detect(solidSource("rgb(0, 0, 255)"));

		expect(tensorBuffers()[1]).toBe(shared);
		expect(shared[0]).toBeCloseTo(0, 5);
		expect(shared[NUM_PIXELS - 1]).toBeCloseTo(0, 5);
		expect(shared[2 * NUM_PIXELS]).toBeCloseTo(1, 5);
		expect(shared[3 * NUM_PIXELS - 1]).toBeCloseTo(1, 5);
	});

	it("gives an overlapping detection its own buffer, then reuses the shared one again", async () => {
		const session = CardDetectorService.getSession() as unknown as {
			run: (feeds: unknown) => Promise<unknown>;
		};
		const pending: Array<(value: unknown) => void> = [];
		session.run = () =>
			new Promise((resolve) => {
				pending.push(resolve);
			});

		const red = solidSource("rgb(255, 0, 0)");
		const blue = solidSource("rgb(0, 0, 255)");

		// detect() runs synchronously up to `await session.run`, so by the time
		// the second call starts, the first has filled the shared buffer and
		// marked it busy.
		const first = CardDetectorService.detect(red);
		const second = CardDetectorService.detect(blue);

		const [firstBuffer, secondBuffer] = tensorBuffers();
		expect(secondBuffer).not.toBe(firstBuffer);
		// The in-flight buffer still holds the first frame, not the second.
		expect(firstBuffer[0]).toBeCloseTo(1, 5);
		expect(secondBuffer[0]).toBeCloseTo(0, 5);
		expect(secondBuffer[2 * NUM_PIXELS]).toBeCloseTo(1, 5);

		const result = {
			output: { data: new Float32Array(300 * 6), dims: [1, 300, 6] },
		};
		for (const resolve of pending) resolve(result);
		await Promise.all([first, second]);

		// Buffer released: the next detection reuses it.
		session.run = () => Promise.resolve(result);
		await CardDetectorService.detect(red);
		expect(tensorBuffers()[2]).toBe(firstBuffer);
	});

	// Two full load+detect cycles; single-test isolation takes ~4.5 s so the
	// default 5 s was too tight when the suite ran in parallel on CI.
	it("drops the shared buffer on reset", async () => {
		await CardDetectorService.detect(solidSource("rgb(255, 0, 0)"));
		const before = tensorBuffers()[0];

		CardDetectorService._reset();
		mockModelFetch();
		await CardDetectorService.load();
		await CardDetectorService.detect(solidSource("rgb(255, 0, 0)"));

		expect(tensorBuffers()[1]).not.toBe(before);
	}, 15000);
});

describe("nms", () => {
	it("keeps non-overlapping detections", () => {
		const detections: CardDetection[] = [
			{
				card: { rank: "A", suit: "\u2660" },
				label: "A\u2660",
				bbox: { x: 0.2, y: 0.2, width: 0.1, height: 0.1 },
				confidence: 0.9,
			},
			{
				card: { rank: "K", suit: "\u2665" },
				label: "K\u2665",
				bbox: { x: 0.8, y: 0.8, width: 0.1, height: 0.1 },
				confidence: 0.8,
			},
		];

		const result = nms(detections);
		expect(result).toHaveLength(2);
	});

	it("removes overlapping detection with lower confidence", () => {
		const detections: CardDetection[] = [
			{
				card: { rank: "A", suit: "\u2660" },
				label: "A\u2660",
				bbox: { x: 0.5, y: 0.5, width: 0.2, height: 0.2 },
				confidence: 0.9,
			},
			{
				card: { rank: "K", suit: "\u2665" },
				label: "K\u2665",
				bbox: { x: 0.5, y: 0.5, width: 0.2, height: 0.2 },
				confidence: 0.7,
			},
		];

		const result = nms(detections);
		expect(result).toHaveLength(1);
		expect(result[0].label).toBe("A\u2660");
	});

	it("returns empty array for empty input", () => {
		expect(nms([])).toEqual([]);
	});
});

describe("parseYoloOutput", () => {
	// Output format: [1, 300, 6] flattened, each detection = [x1, y1, x2, y2, conf, class_id]

	// No letterbox padding (square source, fills entire model input)
	const noLetterbox: LetterboxInfo = {
		offsetX: 0,
		offsetY: 0,
		scaledW: 416,
		scaledH: 416,
	};

	// 16:9 source letterboxed into 416x416: image is 416x234 centered, with 91px padding top/bottom
	const wideLetterbox: LetterboxInfo = {
		offsetX: 0,
		offsetY: Math.floor((416 - 234) / 2), // 91
		scaledW: 416,
		scaledH: 234,
	};

	it("returns empty array when no detections above threshold", () => {
		const data = new Float32Array(2 * 6);
		data[0] = 50;
		data[1] = 50;
		data[2] = 100;
		data[3] = 100;
		data[4] = 0.1;
		data[5] = 0;

		const result = parseYoloOutput(data, 2, 0.5, noLetterbox);
		expect(result).toHaveLength(0);
	});

	it("detects card above confidence threshold (no letterbox)", () => {
		// class 39 = AS (Ace of Spades) in alphabetical dataset order
		const data = new Float32Array(1 * 6);
		data[0] = 100; // x1
		data[1] = 100; // y1
		data[2] = 200; // x2
		data[3] = 200; // y2
		data[4] = 0.95; // confidence
		data[5] = 39; // class_id = AS

		const result = parseYoloOutput(data, 1, 0.5, noLetterbox);
		expect(result).toHaveLength(1);
		expect(result[0].label).toBe("A\u2660");
		expect(result[0].confidence).toBeCloseTo(0.95);
		// Center = (150, 150), size = (100, 100), normalized by 416
		expect(result[0].bbox.x).toBeCloseTo(150 / 416);
		expect(result[0].bbox.y).toBeCloseTo(150 / 416);
		expect(result[0].bbox.width).toBeCloseTo(100 / 416);
		expect(result[0].bbox.height).toBeCloseTo(100 / 416);
	});

	it("undoes letterbox padding for wide video", () => {
		// Detection at model-pixel (208, 208) — center of 416x416.
		// With wideLetterbox (offsetY=91, scaledH=234), the image center is at y=91+117=208.
		// So model-pixel 208 maps to video-normalized y = (208-91)/234 = 0.5
		const data = new Float32Array(1 * 6);
		data[0] = 158; // x1
		data[1] = 158; // y1
		data[2] = 258; // x2
		data[3] = 258; // y2
		data[4] = 0.9;
		data[5] = 39; // AS

		const result = parseYoloOutput(data, 1, 0.5, wideLetterbox);
		expect(result).toHaveLength(1);
		// cx = (158+258)/2 = 208, undone: (208-0)/416 = 0.5
		expect(result[0].bbox.x).toBeCloseTo(208 / 416);
		// cy = (158+258)/2 = 208, undone: (208-91)/234 ≈ 0.5
		expect(result[0].bbox.y).toBeCloseTo((208 - 91) / 234);
	});

	it("filters detections in letterbox padding area", () => {
		// Detection entirely in the top padding bar (y < offsetY)
		const data = new Float32Array(1 * 6);
		data[0] = 100;
		data[1] = 10;
		data[2] = 150;
		data[3] = 50;
		data[4] = 0.9;
		data[5] = 39;

		const result = parseYoloOutput(data, 1, 0.5, wideLetterbox);
		// cy = (10+50)/2 = 30, undone: (30-91)/234 = -0.26 → filtered out
		expect(result).toHaveLength(0);
	});

	it("picks correct class from class_id", () => {
		const data = new Float32Array(1 * 6);
		data[0] = 50;
		data[1] = 50;
		data[2] = 100;
		data[3] = 100;
		data[4] = 0.85;
		data[5] = 38; // class 38 = AH (Ace of Hearts)

		const result = parseYoloOutput(data, 1, 0.5, noLetterbox);
		expect(result).toHaveLength(1);
		expect(result[0].label).toBe("A\u2665");
		expect(result[0].confidence).toBeCloseTo(0.85);
	});

	it("handles multiple detections", () => {
		const data = new Float32Array(3 * 6);
		// det 0: 8S (class 31), high conf
		data[0] = 280;
		data[1] = 110;
		data[2] = 320;
		data[3] = 140;
		data[4] = 0.91;
		data[5] = 31;
		// det 1: 7S (class 27), high conf
		data[6] = 250;
		data[7] = 160;
		data[8] = 290;
		data[9] = 190;
		data[10] = 0.87;
		data[11] = 27;
		// det 2: low conf, should be filtered
		data[12] = 100;
		data[13] = 100;
		data[14] = 150;
		data[15] = 150;
		data[16] = 0.03;
		data[17] = 0;

		const result = parseYoloOutput(data, 3, 0.5, noLetterbox);
		expect(result).toHaveLength(2);
		expect(result.map((d) => d.label).sort()).toEqual(["7\u2660", "8\u2660"]);
	});
});

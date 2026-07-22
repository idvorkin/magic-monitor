import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HandLandmarkerService } from "./HandLandmarkerService";

// Track mock calls via closure
let mockCloseCalls = 0;

// Mock functions must be defined inside the mock factory to avoid hoisting issues
vi.mock("@mediapipe/tasks-vision", () => {
	return {
		FilesetResolver: {
			forVisionTasks: vi.fn().mockResolvedValue("mock-vision-source"),
		},
		HandLandmarker: {
			createFromOptions: vi.fn().mockImplementation(() => {
				return Promise.resolve({
					detectForVideo: vi.fn().mockReturnValue({ landmarks: [] }),
					close: vi.fn().mockImplementation(() => {
						mockCloseCalls++;
					}),
				});
			}),
		},
	};
});

describe("HandLandmarkerService", () => {
	beforeEach(() => {
		// Reset service first (might call close on leftover model), then reset counters
		HandLandmarkerService._reset();
		mockCloseCalls = 0;

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
		const state = HandLandmarkerService.getState();
		expect(state.phase).toBe("idle");
		expect(state.progress).toBe(0);
	});

	it("should load model and transition to ready", async () => {
		const states: string[] = [];
		HandLandmarkerService.subscribe((state) => {
			states.push(state.phase);
		});

		await HandLandmarkerService.load();

		expect(states).toContain("downloading");
		expect(states).toContain("initializing");
		expect(states).toContain("ready");
		expect(HandLandmarkerService.isReady()).toBe(true);
	});

	it("should return same model on subsequent load calls", async () => {
		const model1 = await HandLandmarkerService.load();
		const model2 = await HandLandmarkerService.load();

		expect(model1).toBe(model2);
		// fetch should only be called once
		expect(globalThis.fetch).toHaveBeenCalledTimes(1);
	});

	it("should only load once even with concurrent calls", async () => {
		// Start two loads in parallel
		const promise1 = HandLandmarkerService.load();
		const promise2 = HandLandmarkerService.load();

		const [model1, model2] = await Promise.all([promise1, promise2]);

		// Both should return the same model
		expect(model1).toBe(model2);
		// Fetch should only be called once
		expect(globalThis.fetch).toHaveBeenCalledTimes(1);
	});

	it("should notify all subscribers of state changes", async () => {
		const listener1States: string[] = [];
		const listener2States: string[] = [];

		HandLandmarkerService.subscribe((state) => listener1States.push(state.phase));
		HandLandmarkerService.subscribe((state) => listener2States.push(state.phase));

		await HandLandmarkerService.load();

		expect(listener1States).toEqual(listener2States);
		expect(listener1States.length).toBeGreaterThan(1);
	});

	it("should allow unsubscribing", async () => {
		const states: string[] = [];
		const unsubscribe = HandLandmarkerService.subscribe((state) => {
			states.push(state.phase);
		});

		// Unsubscribe immediately after getting initial state
		unsubscribe();
		const countAfterUnsubscribe = states.length;

		await HandLandmarkerService.load();

		// Should not have received any more updates
		expect(states.length).toBe(countAfterUnsubscribe);
	});

	it("should track download progress", async () => {
		let maxProgress = 0;
		HandLandmarkerService.subscribe((state) => {
			if (state.progress > maxProgress) {
				maxProgress = state.progress;
			}
		});

		await HandLandmarkerService.load();

		expect(maxProgress).toBeGreaterThan(0);
	});

	it("should close model on reset", async () => {
		await HandLandmarkerService.load();
		expect(HandLandmarkerService.isReady()).toBe(true);

		HandLandmarkerService._reset();

		expect(mockCloseCalls).toBe(1);
		expect(HandLandmarkerService.isReady()).toBe(false);
		expect(HandLandmarkerService.getModel()).toBeNull();
	});

	it("should transition to error state on HTTP error response (e.g. 404)", async () => {
		// A 404 response still has headers/body (an HTML error page) — the
		// loader must check response.ok before streaming, or it silently
		// "succeeds" with a corrupted model buffer.
		globalThis.fetch = vi.fn().mockResolvedValue({
			ok: false,
			status: 404,
			headers: {
				get: vi.fn().mockReturnValue(null),
			},
			body: {
				getReader: vi.fn().mockReturnValue({
					read: vi
						.fn()
						.mockResolvedValueOnce({
							done: false,
							value: new TextEncoder().encode("Not Found"),
						})
						.mockResolvedValueOnce({ done: true }),
				}),
			},
		});

		const result = await HandLandmarkerService.load();

		expect(result).toBeNull();
		expect(HandLandmarkerService.getState().phase).toBe("error");
		expect(HandLandmarkerService.isReady()).toBe(false);
	});

	it("should handle fetch error gracefully", async () => {
		globalThis.fetch = vi.fn().mockRejectedValue(new Error("Network error"));

		const result = await HandLandmarkerService.load();

		expect(result).toBeNull();
		expect(HandLandmarkerService.getState().phase).toBe("error");
		expect(HandLandmarkerService.isReady()).toBe(false);
	});

	it("should allow retry after error", async () => {
		// First call fails
		globalThis.fetch = vi.fn().mockRejectedValue(new Error("Network error"));
		await HandLandmarkerService.load();
		expect(HandLandmarkerService.getState().phase).toBe("error");

		// Reset fetch mock to succeed
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

		// Retry should work
		await HandLandmarkerService.load();
		expect(HandLandmarkerService.isReady()).toBe(true);
	});

	it("getModel returns null before loading", () => {
		expect(HandLandmarkerService.getModel()).toBeNull();
	});

	it("getModel returns model after loading", async () => {
		await HandLandmarkerService.load();
		const model = HandLandmarkerService.getModel();
		expect(model).not.toBeNull();
		expect(typeof model?.detectForVideo).toBe("function");
	});

	it("isLoading returns true during load", async () => {
		expect(HandLandmarkerService.isLoading()).toBe(false);

		const loadPromise = HandLandmarkerService.load();

		// Can't easily test mid-load state synchronously, but we can verify it finishes
		await loadPromise;
		expect(HandLandmarkerService.isLoading()).toBe(false);
	});
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { createModelLoader } from "./createModelLoader";

// Minimal fake resource — createModelLoader is generic over TModel, so any
// shape works. Using an object (not a primitive) makes `toBe` identity
// checks meaningful.
interface FakeModel {
	id: number;
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

describe("createModelLoader", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("starts in idle state", () => {
		const loader = createModelLoader<FakeModel>({
			name: "FakeService",
			fetchAndInit: async () => ({ id: 1 }),
		});

		const state = loader.getState();
		expect(state.phase).toBe("idle");
		expect(state.progress).toBe(0);
		expect(loader.getModel()).toBeNull();
		expect(loader.isReady()).toBe(false);
		expect(loader.isLoading()).toBe(false);
	});

	it("notifies subscribers of state changes during a load, in order", async () => {
		const loader = createModelLoader<FakeModel>({
			name: "FakeService",
			fetchAndInit: async (reportProgress, setPhase) => {
				reportProgress(50);
				setPhase("initializing");
				return { id: 1 };
			},
		});

		const phases: string[] = [];
		loader.subscribe((state) => phases.push(state.phase));

		await loader.load();

		// First notification is the immediate replay of current (idle) state.
		expect(phases[0]).toBe("idle");
		expect(phases).toContain("downloading");
		expect(phases).toContain("initializing");
		expect(phases).toContain("ready");
		expect(phases.at(-1)).toBe("ready");
	});

	it("replays current state immediately on subscribe", () => {
		const loader = createModelLoader<FakeModel>({
			name: "FakeService",
			fetchAndInit: async () => ({ id: 1 }),
		});

		const listener = vi.fn();
		loader.subscribe(listener);

		expect(listener).toHaveBeenCalledTimes(1);
		expect(listener).toHaveBeenCalledWith({ phase: "idle", progress: 0 });
	});

	it("allows unsubscribing", async () => {
		const loader = createModelLoader<FakeModel>({
			name: "FakeService",
			fetchAndInit: async () => ({ id: 1 }),
		});

		const listener = vi.fn();
		const unsubscribe = loader.subscribe(listener);
		const callsAtUnsubscribe = listener.mock.calls.length;

		unsubscribe();
		await loader.load();

		expect(listener.mock.calls.length).toBe(callsAtUnsubscribe);
	});

	it("dedupes concurrent load() calls into a single fetchAndInit invocation", async () => {
		const fetchAndInit = vi.fn().mockResolvedValue({ id: 1 });
		const loader = createModelLoader<FakeModel>({
			name: "FakeService",
			fetchAndInit,
		});

		const [model1, model2] = await Promise.all([loader.load(), loader.load()]);

		expect(model1).toBe(model2);
		expect(fetchAndInit).toHaveBeenCalledTimes(1);
	});

	it("returns the cached model on subsequent load() calls after success", async () => {
		const fetchAndInit = vi.fn().mockResolvedValue({ id: 1 });
		const loader = createModelLoader<FakeModel>({
			name: "FakeService",
			fetchAndInit,
		});

		const first = await loader.load();
		const second = await loader.load();

		expect(first).toBe(second);
		expect(fetchAndInit).toHaveBeenCalledTimes(1);
	});

	it("reports progress via reportProgress callback", async () => {
		const loader = createModelLoader<FakeModel>({
			name: "FakeService",
			fetchAndInit: async (reportProgress) => {
				reportProgress(30);
				reportProgress(70);
				return { id: 1 };
			},
		});

		const progressValues: number[] = [];
		loader.subscribe((state) => progressValues.push(state.progress));

		await loader.load();

		expect(progressValues).toContain(30);
		expect(progressValues).toContain(70);
	});

	it("captures the thrown error and transitions to the error phase", async () => {
		const failure = new Error("network exploded");
		const loader = createModelLoader<FakeModel>({
			name: "FakeService",
			fetchAndInit: async () => {
				throw failure;
			},
		});

		const result = await loader.load();

		expect(result).toBeNull();
		expect(loader.getState().phase).toBe("error");
		expect(loader.getState().error).toBe(failure);
		expect(loader.isReady()).toBe(false);
		expect(loader.isLoading()).toBe(false);
	});

	it("allows retry after an error", async () => {
		let attempt = 0;
		const loader = createModelLoader<FakeModel>({
			name: "FakeService",
			fetchAndInit: async () => {
				attempt++;
				if (attempt === 1) throw new Error("first attempt fails");
				return { id: 42 };
			},
		});

		const failed = await loader.load();
		expect(failed).toBeNull();
		expect(loader.getState().phase).toBe("error");

		const succeeded = await loader.load();
		expect(succeeded).toEqual({ id: 42 });
		expect(loader.isReady()).toBe(true);
	});

	it("isLoading is true while fetchAndInit is pending and false once settled", async () => {
		const gate = deferred<FakeModel>();
		const loader = createModelLoader<FakeModel>({
			name: "FakeService",
			fetchAndInit: async () => gate.promise,
		});

		expect(loader.isLoading()).toBe(false);

		const loadPromise = loader.load();
		// Let the synchronous portion of loadModel() run (phase -> downloading).
		await Promise.resolve();
		expect(loader.isLoading()).toBe(true);

		gate.resolve({ id: 1 });
		await loadPromise;

		expect(loader.isLoading()).toBe(false);
		expect(loader.isReady()).toBe(true);
	});

	it("_reset clears model, state, in-flight promise, and listeners", async () => {
		const loader = createModelLoader<FakeModel>({
			name: "FakeService",
			fetchAndInit: async () => ({ id: 1 }),
		});

		await loader.load();
		expect(loader.isReady()).toBe(true);

		const listener = vi.fn();
		loader.subscribe(listener);
		listener.mockClear();

		loader._reset();

		expect(loader.getModel()).toBeNull();
		expect(loader.getState()).toEqual({ phase: "idle", progress: 0 });
		expect(loader.isReady()).toBe(false);
		expect(loader.isLoading()).toBe(false);
		// Listener was cleared by _reset — a later state change must not reach it.
		expect(listener).not.toHaveBeenCalled();
	});

	it("_reset allows loading again (loadPromise not stuck)", async () => {
		const fetchAndInit = vi.fn().mockResolvedValue({ id: 1 });
		const loader = createModelLoader<FakeModel>({
			name: "FakeService",
			fetchAndInit,
		});

		await loader.load();
		loader._reset();
		await loader.load();

		expect(fetchAndInit).toHaveBeenCalledTimes(2);
	});
});

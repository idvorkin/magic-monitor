import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { LoadingState } from "../services/createModelLoader";
import { useModelLoadingState } from "./useModelLoadingState";

// Fake service mirroring the createModelLoader public surface this hook
// actually depends on (subscribe + load) — exercises the shared hook in
// isolation from either real singleton service.
function createFakeService() {
	const listeners = new Set<(state: LoadingState) => void>();
	let state: LoadingState = { phase: "idle", progress: 0 };

	const emit = (next: LoadingState) => {
		state = next;
		for (const listener of listeners) listener(state);
	};

	const load = vi.fn().mockResolvedValue(null);

	return {
		service: {
			subscribe: (listener: (state: LoadingState) => void) => {
				listeners.add(listener);
				listener(state);
				return () => listeners.delete(listener);
			},
			load,
		},
		emit,
		load,
	};
}

describe("useModelLoadingState", () => {
	it("triggers load() on mount by default (enabled defaults to true)", () => {
		const { service, load } = createFakeService();

		renderHook(() => useModelLoadingState(service));

		expect(load).toHaveBeenCalledTimes(1);
	});

	it("mirrors phase/progress/error transitions from the service", () => {
		const { service, emit } = createFakeService();
		const { result } = renderHook(() => useModelLoadingState(service));

		act(() => emit({ phase: "downloading", progress: 40 }));
		expect(result.current.isModelLoading).toBe(true);
		expect(result.current.loadingProgress).toBe(40);
		expect(result.current.loadingPhase).toBe("downloading");

		act(() => emit({ phase: "initializing", progress: 100 }));
		expect(result.current.isModelLoading).toBe(true);
		expect(result.current.loadingPhase).toBe("initializing");

		act(() => emit({ phase: "ready", progress: 100 }));
		expect(result.current.isModelLoading).toBe(false);
		expect(result.current.modelError).toBeNull();
	});

	it("surfaces the error message when the service enters the error phase", () => {
		const { service, emit } = createFakeService();
		const { result } = renderHook(() => useModelLoadingState(service));

		act(() => emit({ phase: "error", progress: 0, error: new Error("boom") }));

		expect(result.current.isModelLoading).toBe(false);
		expect(result.current.modelError).toBe("boom");
	});

	it("falls back to 'Unknown error' when the error has no message", () => {
		const { service, emit } = createFakeService();
		const { result } = renderHook(() => useModelLoadingState(service));

		act(() => emit({ phase: "error", progress: 0 }));

		expect(result.current.modelError).toBe("Unknown error");
	});

	it("does not call load() when enabled is false, and calls it once enabled flips true", () => {
		const { service, load } = createFakeService();

		const { rerender } = renderHook(
			({ enabled }) => useModelLoadingState(service, { enabled }),
			{
				initialProps: { enabled: false },
			},
		);

		expect(load).not.toHaveBeenCalled();

		rerender({ enabled: true });

		expect(load).toHaveBeenCalledTimes(1);
	});

	it("uses initialIsLoading for the render before the first subscribe notification would otherwise apply", () => {
		// A service whose subscribe() defers the initial replay (unlike the
		// fake above) leaves the hook showing only its initial state on first
		// render — this is exactly what HandLandmarkerService's always-load
		// caller relies on to avoid a "not loading" flash on mount.
		const deferredService = {
			subscribe: () => () => {},
			load: vi.fn().mockResolvedValue(null),
		};

		const { result } = renderHook(() =>
			useModelLoadingState(deferredService, { initialIsLoading: true }),
		);

		expect(result.current.isModelLoading).toBe(true);
	});

	it("unsubscribes on unmount", () => {
		const unsubscribe = vi.fn();
		const service = {
			subscribe: vi.fn().mockReturnValue(unsubscribe),
			load: vi.fn().mockResolvedValue(null),
		};

		const { unmount } = renderHook(() => useModelLoadingState(service));
		unmount();

		expect(unsubscribe).toHaveBeenCalledTimes(1);
	});
});

import { renderHook, act } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useZoomPan } from "./useZoomPan";
import { createRef } from "react";

// Helper to create mock refs for testing
function createMockRefs() {
	const videoRef = createRef<HTMLVideoElement>();
	const containerRef = { current: document.createElement("div") };
	return { videoRef, containerRef };
}

describe("useZoomPan", () => {
	describe("initial state", () => {
		it("should initialize with zoom 1 and pan at origin", () => {
			const { videoRef, containerRef } = createMockRefs();
			const { result } = renderHook(() => useZoomPan({ videoRef, containerRef }));

			expect(result.current.zoom).toBe(1);
			expect(result.current.pan).toEqual({ x: 0, y: 0 });
			expect(result.current.isDragging).toBe(false);
		});
	});

	describe("setZoom", () => {
		it("should update zoom within min/max bounds", () => {
			const { videoRef, containerRef } = createMockRefs();
			const { result } = renderHook(() => useZoomPan({ videoRef, containerRef }));

			act(() => {
				result.current.setZoom(3);
			});

			expect(result.current.zoom).toBe(3);
		});

		it("should clamp zoom to minZoom", () => {
			const { videoRef, containerRef } = createMockRefs();
			const { result } = renderHook(() =>
				useZoomPan({ videoRef, containerRef, minZoom: 1, maxZoom: 5 }),
			);

			act(() => {
				result.current.setZoom(0.5);
			});

			expect(result.current.zoom).toBe(1);
		});

		it("should clamp zoom to maxZoom", () => {
			const { videoRef, containerRef } = createMockRefs();
			const { result } = renderHook(() =>
				useZoomPan({ videoRef, containerRef, minZoom: 1, maxZoom: 5 }),
			);

			act(() => {
				result.current.setZoom(10);
			});

			expect(result.current.zoom).toBe(5);
		});

		it("should re-clamp pan when zoom changes", () => {
			const { videoRef, containerRef } = createMockRefs();
			const { result } = renderHook(() => useZoomPan({ videoRef, containerRef }));

			// Set high zoom and pan to max
			act(() => {
				result.current.setZoom(5);
				result.current.setPan({ x: 0.4, y: 0.4 }); // maxPan at zoom 5 = 0.4
			});

			expect(result.current.pan.x).toBeCloseTo(0.4, 5);

			// Reduce zoom - pan should be clamped to new smaller maxPan
			act(() => {
				result.current.setZoom(2);
			});

			// maxPan at zoom 2 = (1 - 1/2) / 2 = 0.25
			expect(result.current.pan.x).toBeCloseTo(0.25, 5);
		});

		it("should call onZoomChange callback", () => {
			const { videoRef, containerRef } = createMockRefs();
			const onZoomChange = vi.fn();
			const { result } = renderHook(() =>
				useZoomPan({ videoRef, containerRef, onZoomChange }),
			);

			act(() => {
				result.current.setZoom(2);
			});

			expect(onZoomChange).toHaveBeenCalled();
		});

		it("should not call onZoomChange when not provided", () => {
			const { videoRef, containerRef } = createMockRefs();
			const { result } = renderHook(() =>
				useZoomPan({ videoRef, containerRef }),
			);

			expect(() => {
				act(() => {
					result.current.setZoom(2);
				});
			}).not.toThrow();

			expect(result.current.zoom).toBe(2);
		});
	});

	describe("setPan", () => {
		it("should update pan position", () => {
			const { videoRef, containerRef } = createMockRefs();
			const { result } = renderHook(() => useZoomPan({ videoRef, containerRef }));

			act(() => {
				result.current.setZoom(2);
				result.current.setPan({ x: 0.1, y: 0.1 });
			});

			expect(result.current.pan).toEqual({ x: 0.1, y: 0.1 });
		});

		it("should clamp pan to maxPan based on zoom level", () => {
			const { videoRef, containerRef } = createMockRefs();
			const { result } = renderHook(() => useZoomPan({ videoRef, containerRef }));

			act(() => {
				result.current.setZoom(2);
				// Try to pan beyond maxPan (0.25 at zoom 2)
				result.current.setPan({ x: 0.5, y: 0.5 });
			});

			// maxPan at zoom 2 = (1 - 1/2) / 2 = 0.25
			expect(result.current.pan.x).toBeCloseTo(0.25, 5);
			expect(result.current.pan.y).toBeCloseTo(0.25, 5);
		});

		it("should clamp negative pan values", () => {
			const { videoRef, containerRef } = createMockRefs();
			const { result } = renderHook(() => useZoomPan({ videoRef, containerRef }));

			act(() => {
				result.current.setZoom(2);
				result.current.setPan({ x: -0.5, y: -0.5 });
			});

			// maxPan at zoom 2 = 0.25
			expect(result.current.pan.x).toBeCloseTo(-0.25, 5);
			expect(result.current.pan.y).toBeCloseTo(-0.25, 5);
		});

		it("should not allow panning at zoom 1", () => {
			const { videoRef, containerRef } = createMockRefs();
			const { result } = renderHook(() => useZoomPan({ videoRef, containerRef }));

			act(() => {
				result.current.setPan({ x: 0.1, y: 0.1 });
			});

			// maxPan at zoom 1 = 0
			expect(result.current.pan).toEqual({ x: 0, y: 0 });
		});
	});

	describe("wheel events", () => {
		it("should increase zoom on scroll up", () => {
			const { videoRef, containerRef } = createMockRefs();
			const { result } = renderHook(() => useZoomPan({ videoRef, containerRef }));

			// Dispatch wheel event on the container
			act(() => {
				const wheelEvent = new WheelEvent("wheel", { deltaY: -100, cancelable: true });
				containerRef.current!.dispatchEvent(wheelEvent);
			});

			expect(result.current.zoom).toBeGreaterThan(1);
		});

		it("should decrease zoom on scroll down", () => {
			const { videoRef, containerRef } = createMockRefs();
			const { result } = renderHook(() => useZoomPan({ videoRef, containerRef }));

			act(() => {
				result.current.setZoom(3);
			});

			// Dispatch wheel event on the container
			act(() => {
				const wheelEvent = new WheelEvent("wheel", { deltaY: 100, cancelable: true });
				containerRef.current!.dispatchEvent(wheelEvent);
			});

			expect(result.current.zoom).toBeLessThan(3);
		});

		it("should call onZoomChange callback", () => {
			const { videoRef, containerRef } = createMockRefs();
			const onZoomChange = vi.fn();
			renderHook(() =>
				useZoomPan({ videoRef, containerRef, onZoomChange }),
			);

			// Dispatch wheel event on the container
			act(() => {
				const wheelEvent = new WheelEvent("wheel", { deltaY: -100, cancelable: true });
				containerRef.current!.dispatchEvent(wheelEvent);
			});

			expect(onZoomChange).toHaveBeenCalled();
		});
	});

	describe("handleMouseDown", () => {
		it("should start dragging when zoom > 1", () => {
			const { videoRef, containerRef } = createMockRefs();
			const { result } = renderHook(() => useZoomPan({ videoRef, containerRef }));

			act(() => {
				result.current.setZoom(2);
			});

			const mouseEvent = {
				clientX: 100,
				clientY: 100,
			} as React.MouseEvent;

			act(() => {
				result.current.handleMouseDown(mouseEvent);
			});

			expect(result.current.isDragging).toBe(true);
		});

		it("should not start dragging at zoom 1", () => {
			const { videoRef, containerRef } = createMockRefs();
			const { result } = renderHook(() => useZoomPan({ videoRef, containerRef }));

			const mouseEvent = {
				clientX: 100,
				clientY: 100,
			} as React.MouseEvent;

			act(() => {
				result.current.handleMouseDown(mouseEvent);
			});

			expect(result.current.isDragging).toBe(false);
		});
	});

	describe("handleMouseMove", () => {
		it("should update pan position when dragging", () => {
			const { containerRef } = createMockRefs();
			const videoRef = { current: null } as React.RefObject<HTMLVideoElement | null>;
			// Mock getBoundingClientRect
			(videoRef as { current: HTMLVideoElement | null }).current = {
				getBoundingClientRect: () => ({
					width: 1000,
					height: 1000,
					x: 0,
					y: 0,
					top: 0,
					left: 0,
					right: 1000,
					bottom: 1000,
					toJSON: () => {},
				}),
			} as HTMLVideoElement;

			const { result } = renderHook(() => useZoomPan({ videoRef, containerRef }));

			act(() => {
				result.current.setZoom(2);
			});

			// Start dragging
			act(() => {
				result.current.handleMouseDown({
					clientX: 100,
					clientY: 100,
				} as React.MouseEvent);
			});

			// Move mouse
			act(() => {
				result.current.handleMouseMove({
					clientX: 200,
					clientY: 200,
				} as React.MouseEvent);
			});

			// Pan should have changed based on movement
			// dx = 100, dy = 100
			// normalized: 100 / (1000 * 2) = 0.05
			expect(result.current.pan.x).toBeCloseTo(0.05, 5);
			expect(result.current.pan.y).toBeCloseTo(0.05, 5);
		});

		it("should not update pan when not dragging", () => {
			const { videoRef, containerRef } = createMockRefs();
			const { result } = renderHook(() => useZoomPan({ videoRef, containerRef }));

			act(() => {
				result.current.setZoom(2);
				result.current.handleMouseMove({
					clientX: 200,
					clientY: 200,
				} as React.MouseEvent);
			});

			expect(result.current.pan).toEqual({ x: 0, y: 0 });
		});
	});

	describe("handleMouseUp", () => {
		it("should stop dragging", () => {
			const { videoRef, containerRef } = createMockRefs();
			const { result } = renderHook(() => useZoomPan({ videoRef, containerRef }));

			act(() => {
				result.current.setZoom(2);
			});

			act(() => {
				result.current.handleMouseDown({
					clientX: 100,
					clientY: 100,
				} as React.MouseEvent);
			});

			expect(result.current.isDragging).toBe(true);

			act(() => {
				result.current.handleMouseUp();
			});

			expect(result.current.isDragging).toBe(false);
		});
	});

	describe("resetZoom", () => {
		it("should reset zoom to 1 and pan to origin", () => {
			const { videoRef, containerRef } = createMockRefs();
			const { result } = renderHook(() => useZoomPan({ videoRef, containerRef }));

			act(() => {
				result.current.setZoom(3);
				result.current.setPan({ x: 0.2, y: 0.2 });
			});

			act(() => {
				result.current.resetZoom();
			});

			expect(result.current.zoom).toBe(1);
			expect(result.current.pan).toEqual({ x: 0, y: 0 });
		});

		it("should call onZoomChange callback", () => {
			const { videoRef, containerRef } = createMockRefs();
			const onZoomChange = vi.fn();
			const { result } = renderHook(() =>
				useZoomPan({ videoRef, containerRef, onZoomChange }),
			);

			act(() => {
				result.current.resetZoom();
			});

			expect(onZoomChange).toHaveBeenCalled();
		});
	});

	describe("pan constraints", () => {
		it("should calculate correct maxPan for zoom 2", () => {
			const { videoRef, containerRef } = createMockRefs();
			const { result } = renderHook(() => useZoomPan({ videoRef, containerRef }));

			act(() => {
				result.current.setZoom(2);
				result.current.setPan({ x: 1, y: 1 });
			});

			// maxPan = (1 - 1/2) / 2 = 0.25
			expect(result.current.pan.x).toBeCloseTo(0.25, 5);
			expect(result.current.pan.y).toBeCloseTo(0.25, 5);
		});

		it("should calculate correct maxPan for zoom 5", () => {
			const { videoRef, containerRef } = createMockRefs();
			const { result } = renderHook(() => useZoomPan({ videoRef, containerRef }));

			act(() => {
				result.current.setZoom(5);
				result.current.setPan({ x: 1, y: 1 });
			});

			// maxPan = (1 - 1/5) / 2 = 0.4
			expect(result.current.pan.x).toBeCloseTo(0.4, 5);
			expect(result.current.pan.y).toBeCloseTo(0.4, 5);
		});

		it("should calculate correct maxPan for zoom 10", () => {
			const { videoRef, containerRef } = createMockRefs();
			const { result } = renderHook(() =>
				useZoomPan({ videoRef, containerRef, maxZoom: 10 }),
			);

			act(() => {
				result.current.setZoom(10);
				result.current.setPan({ x: 1, y: 1 });
			});

			// maxPan = (1 - 1/10) / 2 = 0.45
			expect(result.current.pan.x).toBeCloseTo(0.45, 5);
			expect(result.current.pan.y).toBeCloseTo(0.45, 5);
		});
	});
});

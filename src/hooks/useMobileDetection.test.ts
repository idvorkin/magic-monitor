import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { DeviceServiceType } from "../services/DeviceService";
import { useMobileDetection } from "./useMobileDetection";

function createMockService(
	overrides: Partial<DeviceServiceType> = {},
): DeviceServiceType {
	return {
		getScreenWidth: () => 1920,
		getDeviceMemoryGB: () => null,
		isTouchDevice: () => false,
		addResizeListener: () => () => {},
		getStorageItem: () => null,
		setStorageItem: () => {},
		hasDeviceMotion: () => false,
		requestDeviceMotionPermission: async () => "denied",
		addDeviceMotionListener: () => () => {},
		copyToClipboard: async () => {},
		openInNewTab: () => {},
		getUserAgent: () => "test-agent",
		getCurrentRoute: () => "/",
		captureScreenshot: async () => null,
		copyImageToClipboard: async () => false,
		fetchLatestCommit: async () => null,
		...overrides,
	};
}

describe("useMobileDetection", () => {
	it("detects desktop with large screen as non-mobile", () => {
		const service = createMockService({ getScreenWidth: () => 1920 });

		const { result } = renderHook(() => useMobileDetection(service));

		expect(result.current.isMobile).toBe(false);
		expect(result.current.screenWidth).toBe(1920);
	});

	it("detects small screen as mobile", () => {
		const service = createMockService({ getScreenWidth: () => 375 });

		const { result } = renderHook(() => useMobileDetection(service));

		expect(result.current.isMobile).toBe(true);
		expect(result.current.isLowMemory).toBe(true); // Falls back to mobile when no deviceMemory
	});

	it("detects touch device with medium screen as mobile", () => {
		const service = createMockService({
			getScreenWidth: () => 900,
			isTouchDevice: () => true,
		});

		const { result } = renderHook(() => useMobileDetection(service));

		expect(result.current.isMobile).toBe(true);
	});

	it("detects low memory when deviceMemory API reports < 4GB", () => {
		const service = createMockService({
			getScreenWidth: () => 1920,
			getDeviceMemoryGB: () => 2,
		});

		const { result } = renderHook(() => useMobileDetection(service));

		expect(result.current.isMobile).toBe(false);
		expect(result.current.isLowMemory).toBe(true);
		expect(result.current.deviceMemoryGB).toBe(2);
	});

	it("detects high memory desktop as non-low-memory", () => {
		const service = createMockService({
			getScreenWidth: () => 1920,
			getDeviceMemoryGB: () => 8,
		});

		const { result } = renderHook(() => useMobileDetection(service));

		expect(result.current.isMobile).toBe(false);
		expect(result.current.isLowMemory).toBe(false);
		expect(result.current.deviceMemoryGB).toBe(8);
	});

	it("falls back to mobile detection when deviceMemory unavailable", () => {
		const service = createMockService({
			getScreenWidth: () => 500,
			getDeviceMemoryGB: () => null,
		});

		const { result } = renderHook(() => useMobileDetection(service));

		expect(result.current.isMobile).toBe(true);
		expect(result.current.isLowMemory).toBe(true);
		expect(result.current.deviceMemoryGB).toBe(null);
	});

	it("uses deviceMemory over mobile detection when available", () => {
		// Mobile screen but high memory - should NOT be low memory
		const service = createMockService({
			getScreenWidth: () => 375,
			getDeviceMemoryGB: () => 8,
		});

		const { result } = renderHook(() => useMobileDetection(service));

		expect(result.current.isMobile).toBe(true);
		expect(result.current.isLowMemory).toBe(false); // deviceMemory takes precedence
	});

	it("calls resize listener on mount and cleanup", () => {
		const removeListener = vi.fn();
		const service = createMockService({
			addResizeListener: vi.fn(() => removeListener),
		});

		const { unmount } = renderHook(() => useMobileDetection(service));

		expect(service.addResizeListener).toHaveBeenCalledOnce();

		unmount();
		expect(removeListener).toHaveBeenCalledOnce();
	});
});

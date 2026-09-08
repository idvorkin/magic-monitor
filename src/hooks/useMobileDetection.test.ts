import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { DeviceServiceType } from "../services/DeviceService";
import { useMobileDetection } from "./useMobileDetection";

function createMockService(
	overrides: Partial<DeviceServiceType> = {},
): DeviceServiceType {
	return {
		getScreenWidth: () => 1920,
		getScreenHeight: () => 1080,
		getDevicePixelRatio: () => 2,
		getDeviceMemoryGB: () => null,
		getHardwareConcurrency: () => 8,
		isOnline: () => true,
		getConnectionType: () => "4g",
		getDisplayMode: () => "browser",
		isTouchDevice: () => false,
		addResizeListener: () => () => {},
		getStorageItem: () => null,
		setStorageItem: () => {},
		hasDeviceMotion: () => false,
		requestDeviceMotionPermission: async () => "denied",
		addDeviceMotionListener: () => () => {},
		copyToClipboard: async () => true,
		openInNewTab: () => {},
		getUserAgent: () => "test-agent",
		getCurrentRoute: () => "/",
		captureScreenshot: async () => null,
		copyImageToClipboard: async () => false,
		downloadDataUrl: () => {},
		isMobileDevice: () => false,
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
	});

	it("detects touch device with medium screen as mobile", () => {
		const service = createMockService({
			getScreenWidth: () => 900,
			isTouchDevice: () => true,
		});

		const { result } = renderHook(() => useMobileDetection(service));

		expect(result.current.isMobile).toBe(true);
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

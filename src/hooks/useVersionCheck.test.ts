import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DeviceServiceType } from "../services/DeviceService";

// Mock the virtual PWA module with a configurable needRefresh flag so the
// needRefresh -> updateAvailable -> reload -> updateServiceWorker(true)
// contract (the one that `registerType: "autoUpdate"` silently disabled) can
// be asserted. Tests flip `pwaMock.needRefresh` to simulate an available update.
const { pwaMock } = vi.hoisted(() => ({
	pwaMock: {
		needRefresh: false,
		updateServiceWorker: vi.fn(),
	},
}));

vi.mock("virtual:pwa-register/react", () => ({
	useRegisterSW: () => ({
		needRefresh: [pwaMock.needRefresh],
		updateServiceWorker: pwaMock.updateServiceWorker,
	}),
}));

// Import after mocking
import { useVersionCheck } from "./useVersionCheck";

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
		getStorageItem: vi.fn(() => null),
		setStorageItem: vi.fn(),
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

describe("useVersionCheck", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		pwaMock.needRefresh = false;
	});

	it("initializes lastCheckTime from storage", () => {
		const storedDate = "2024-01-15T10:30:00.000Z";
		const service = createMockService({
			getStorageItem: vi.fn(() => storedDate),
		});

		const { result } = renderHook(() => useVersionCheck(service));

		expect(result.current.lastCheckTime).toEqual(new Date(storedDate));
	});

	it("returns null lastCheckTime when storage empty", () => {
		const service = createMockService({
			getStorageItem: vi.fn(() => null),
		});

		const { result } = renderHook(() => useVersionCheck(service));

		expect(result.current.lastCheckTime).toBeNull();
	});

	it("checkForUpdate updates lastCheckTime", async () => {
		const service = createMockService();

		const { result } = renderHook(() => useVersionCheck(service));

		expect(result.current.lastCheckTime).toBeNull();

		await act(async () => {
			await result.current.checkForUpdate();
		});

		expect(result.current.lastCheckTime).toBeInstanceOf(Date);
	});

	it("checkForUpdate persists to storage", async () => {
		const setStorageItem = vi.fn();
		const service = createMockService({ setStorageItem });

		const { result } = renderHook(() => useVersionCheck(service));

		await act(async () => {
			await result.current.checkForUpdate();
		});

		expect(setStorageItem).toHaveBeenCalledWith(
			"magic-monitor-last-update-check",
			expect.any(String),
		);
	});

	it("checkForUpdate resets isChecking after completion", async () => {
		const service = createMockService();

		const { result } = renderHook(() => useVersionCheck(service));

		await act(async () => {
			await result.current.checkForUpdate();
		});

		expect(result.current.isChecking).toBe(false);
	});

	it("starts with isChecking false", () => {
		const service = createMockService();

		const { result } = renderHook(() => useVersionCheck(service));

		expect(result.current.isChecking).toBe(false);
	});

	describe("update notification contract (prompt mode)", () => {
		it("exposes needRefresh as updateAvailable when an update is available", () => {
			pwaMock.needRefresh = true;
			const service = createMockService();

			const { result } = renderHook(() => useVersionCheck(service));

			expect(result.current.updateAvailable).toBe(true);
		});

		it("exposes updateAvailable as false when no update is available", () => {
			pwaMock.needRefresh = false;
			const service = createMockService();

			const { result } = renderHook(() => useVersionCheck(service));

			expect(result.current.updateAvailable).toBe(false);
		});

		it("reload calls updateServiceWorker(true) to send skipWaiting", () => {
			pwaMock.needRefresh = true;
			const service = createMockService();

			const { result } = renderHook(() => useVersionCheck(service));

			result.current.reload();

			expect(pwaMock.updateServiceWorker).toHaveBeenCalledWith(true);
		});
	});
});

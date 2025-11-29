import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DeviceServiceType } from "../services/DeviceService";

// Mock the virtual PWA module
vi.mock("virtual:pwa-register/react", () => ({
	useRegisterSW: () => ({
		needRefresh: [false],
		updateServiceWorker: vi.fn(),
	}),
}));

// Import after mocking
import { useVersionCheck } from "./useVersionCheck";

function createMockService(
	overrides: Partial<DeviceServiceType> = {},
): DeviceServiceType {
	return {
		getScreenWidth: () => 1920,
		getDeviceMemoryGB: () => null,
		isTouchDevice: () => false,
		addResizeListener: () => () => {},
		getStorageItem: vi.fn(() => null),
		setStorageItem: vi.fn(),
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

describe("useVersionCheck", () => {
	beforeEach(() => {
		vi.clearAllMocks();
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
});

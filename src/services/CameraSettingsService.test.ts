import { beforeEach, describe, expect, it, vi } from "vitest";
import { DeviceService } from "./DeviceService";
import { CameraSettingsService, updateSettingForDevice } from "./CameraSettingsService";

vi.mock("./DeviceService", () => ({
	DeviceService: {
		getStorageItem: vi.fn(),
		setStorageItem: vi.fn(),
	},
}));

const KEY = "magic-monitor-camera-device-settings";

describe("CameraSettingsService", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(DeviceService.getStorageItem).mockReturnValue(null);
	});

	describe("getSettingsForDevice", () => {
		it("returns defaults when nothing is stored", () => {
			expect(CameraSettingsService.getSettingsForDevice("cam-1")).toEqual({
				resolution: "4k",
				orientation: "landscape",
			});
		});

		it("returns defaults for an empty deviceId", () => {
			expect(CameraSettingsService.getSettingsForDevice("")).toEqual({
				resolution: "4k",
				orientation: "landscape",
			});
			expect(DeviceService.getStorageItem).not.toHaveBeenCalled();
		});

		it("recovers to defaults on corrupt JSON", () => {
			vi.mocked(DeviceService.getStorageItem).mockReturnValue("{not json");
			expect(CameraSettingsService.getSettingsForDevice("cam-1")).toEqual({
				resolution: "4k",
				orientation: "landscape",
			});
		});

		it("merges partial stored settings over defaults", () => {
			vi.mocked(DeviceService.getStorageItem).mockReturnValue(
				JSON.stringify({ "cam-1": { resolution: "720p" } }),
			);
			expect(CameraSettingsService.getSettingsForDevice("cam-1")).toEqual({
				resolution: "720p",
				orientation: "landscape",
			});
		});
	});

	describe("updateSettingForDevice", () => {
		it("updates one key and preserves the other, per device", () => {
			vi.mocked(DeviceService.getStorageItem).mockReturnValue(
				JSON.stringify({
					"cam-1": { resolution: "1080p", orientation: "portrait" },
					"cam-2": { resolution: "4k", orientation: "landscape" },
				}),
			);
			updateSettingForDevice("cam-1", "resolution", "720p");
			expect(DeviceService.setStorageItem).toHaveBeenCalledWith(
				KEY,
				JSON.stringify({
					"cam-1": { resolution: "720p", orientation: "portrait" },
					"cam-2": { resolution: "4k", orientation: "landscape" },
				}),
			);
		});

		it("no-ops on an empty deviceId", () => {
			updateSettingForDevice("", "resolution", "720p");
			expect(DeviceService.setStorageItem).not.toHaveBeenCalled();
		});
	});

	describe("saveSettingsForDevice", () => {
		it("starts fresh when stored JSON is corrupt instead of throwing", () => {
			vi.mocked(DeviceService.getStorageItem).mockReturnValue("{not json");
			CameraSettingsService.saveSettingsForDevice("cam-1", {
				resolution: "1080p",
				orientation: "portrait",
			});
			expect(DeviceService.setStorageItem).toHaveBeenCalledWith(
				KEY,
				JSON.stringify({
					"cam-1": { resolution: "1080p", orientation: "portrait" },
				}),
			);
		});
	});
});

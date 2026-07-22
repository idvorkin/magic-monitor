import type { CameraSettings, Orientation, Resolution } from "./CameraService";
import { DeviceService } from "./DeviceService";

const DEVICE_SETTINGS_STORAGE_KEY = "magic-monitor-camera-device-settings";

const DEFAULT_SETTINGS: CameraSettings = {
	resolution: "4k",
	orientation: "landscape",
};

/**
 * Humble Object for per-device camera settings persistence.
 * Isolates localStorage access (via DeviceService) for testability.
 */
export const CameraSettingsService = {
	/**
	 * Get settings for a specific camera device from localStorage.
	 * Returns default settings if none are stored for this device.
	 */
	getSettingsForDevice(deviceId: string): CameraSettings {
		if (!deviceId) return DEFAULT_SETTINGS;

		const stored = DeviceService.getStorageItem(DEVICE_SETTINGS_STORAGE_KEY);
		if (stored) {
			try {
				const allSettings = JSON.parse(stored) as Record<
					string,
					CameraSettings
				>;
				if (allSettings[deviceId]) {
					return { ...DEFAULT_SETTINGS, ...allSettings[deviceId] };
				}
			} catch {
				// Invalid JSON, return defaults
			}
		}
		return DEFAULT_SETTINGS;
	},

	/**
	 * Save settings for a specific camera device to localStorage.
	 */
	saveSettingsForDevice(deviceId: string, settings: CameraSettings): void {
		if (!deviceId) return;

		const stored = DeviceService.getStorageItem(DEVICE_SETTINGS_STORAGE_KEY);
		let allSettings: Record<string, CameraSettings> = {};
		if (stored) {
			try {
				allSettings = JSON.parse(stored);
			} catch {
				// Invalid JSON, start fresh
			}
		}
		allSettings[deviceId] = settings;
		DeviceService.setStorageItem(
			DEVICE_SETTINGS_STORAGE_KEY,
			JSON.stringify(allSettings),
		);
	},

	/**
	 * Get all stored device settings (for debugging/export).
	 */
	getAllDeviceSettings(): Record<string, CameraSettings> {
		const stored = DeviceService.getStorageItem(DEVICE_SETTINGS_STORAGE_KEY);
		if (stored) {
			try {
				return JSON.parse(stored);
			} catch {
				return {};
			}
		}
		return {};
	},
};

export type CameraSettingsServiceType = typeof CameraSettingsService;

/**
 * Update a single setting for a device (resolution or orientation).
 *
 * Kept as a top-level function (not a CameraSettingsService method): TS
 * overload signatures aren't supported on object-literal shorthand methods,
 * only on classes/functions. Delegates to the object's get/save methods.
 */
export function updateSettingForDevice(
	deviceId: string,
	key: "resolution",
	value: Resolution,
): void;
export function updateSettingForDevice(
	deviceId: string,
	key: "orientation",
	value: Orientation,
): void;
export function updateSettingForDevice(
	deviceId: string,
	key: keyof CameraSettings,
	value: Resolution | Orientation,
): void {
	const current = CameraSettingsService.getSettingsForDevice(deviceId);
	CameraSettingsService.saveSettingsForDevice(deviceId, {
		...current,
		[key]: value,
	});
}

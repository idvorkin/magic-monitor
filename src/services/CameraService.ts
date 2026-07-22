export type Resolution = "720p" | "1080p" | "4k";
export type Orientation = "landscape" | "portrait";

export const RESOLUTION_PRESETS: Record<
	Resolution,
	{ width: number; height: number; label: string }
> = {
	"720p": { width: 1280, height: 720, label: "720p (HD)" },
	"1080p": { width: 1920, height: 1080, label: "1080p (Full HD)" },
	"4k": { width: 3840, height: 2160, label: "4K (Ultra HD)" },
};

/**
 * Decide which device to request BEFORE opening a stream.
 * Pure policy: a persisted id wins when it is (or cannot be proven not to be)
 * a real device; otherwise the OS default. Never "first in the list" — that
 * silently overrides the camera the browser/OS actually chose.
 * Pre-permission enumeration yields empty deviceIds, making validation
 * impossible — then the persisted id is trusted and the
 * OverconstrainedError fallback in useCamera is the real validator.
 */
export function resolveCameraSelection({
	persistedId,
	devices,
}: {
	persistedId: string;
	devices: MediaDeviceInfo[];
}): { deviceId: string | null } {
	const validIds = devices.map((d) => d.deviceId).filter(Boolean);
	const canValidate = validIds.length > 0;
	if (persistedId && (!canValidate || validIds.includes(persistedId))) {
		return { deviceId: persistedId };
	}
	return { deviceId: null };
}

export interface CameraSettings {
	resolution: Resolution;
	orientation: Orientation;
}

export class InsecureContextError extends Error {
	constructor() {
		super(
			"Camera requires HTTPS. Access this page via localhost or a secure connection.",
		);
		this.name = "InsecureContextError";
	}
}

/**
 * Humble Object for browser camera APIs.
 * Isolates navigator.mediaDevices calls for testability.
 */
export const CameraService = {
	isSecureContext(): boolean {
		return typeof navigator !== "undefined" && !!navigator.mediaDevices;
	},

	async getVideoDevices(): Promise<MediaDeviceInfo[]> {
		if (!this.isSecureContext()) {
			return [];
		}
		try {
			const devices = await navigator.mediaDevices.enumerateDevices();
			return devices.filter((device) => device.kind === "videoinput");
		} catch (error) {
			console.error("Error enumerating devices:", error);
			return [];
		}
	},

	async start(
		deviceId?: string,
		resolution: Resolution = "4k",
		orientation: Orientation = "landscape",
	): Promise<MediaStream> {
		if (!this.isSecureContext()) {
			throw new InsecureContextError();
		}

		const preset = RESOLUTION_PRESETS[resolution];
		// Only request width - let camera use its native aspect ratio
		const targetWidth =
			orientation === "portrait" ? preset.height : preset.width;

		const constraints: MediaStreamConstraints = {
			video: {
				width: { ideal: targetWidth },
				// No height constraint - camera picks based on native aspect ratio
				frameRate: { ideal: 30 },
				deviceId: deviceId ? { exact: deviceId } : undefined,
			},
		};

		console.log(
			`[Camera] Requesting width: ${targetWidth} (camera picks height)`,
		);
		return navigator.mediaDevices.getUserMedia(constraints);
	},

	stop(stream: MediaStream | null): void {
		if (!stream) return;
		stream.getTracks().forEach((track) => {
			track.stop();
		});
	},

	/**
	 * Add a listener for device changes (cameras connected/disconnected).
	 * Returns a cleanup function to remove the listener.
	 */
	addDeviceChangeListener(callback: () => void): () => void {
		if (!this.isSecureContext()) {
			// Return no-op cleanup if not in secure context
			return () => {};
		}
		navigator.mediaDevices.addEventListener("devicechange", callback);
		return () => {
			navigator.mediaDevices.removeEventListener("devicechange", callback);
		};
	},
};

export type CameraServiceType = typeof CameraService;

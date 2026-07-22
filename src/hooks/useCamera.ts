import { useCallback, useEffect, useRef, useState } from "react";
import {
	CameraService,
	InsecureContextError,
	type Orientation,
	type Resolution,
	resolveCameraSelection,
} from "../services/CameraService";
import {
	CameraSettingsService,
	updateSettingForDevice,
} from "../services/CameraSettingsService";
import { DeviceService } from "../services/DeviceService";

const DEVICE_ID_STORAGE_KEY = "magic-monitor-camera-device-id";

export function useCamera(initialDeviceId?: string) {
	const [stream, setStream] = useState<MediaStream | null>(null);
	const streamRef = useRef<MediaStream | null>(null);
	// What the live stream was opened for — lets an adoption-driven state
	// update skip a needless (visible) stream restart.
	const activeConfigRef = useRef<{
		deviceId: string;
		resolution: Resolution;
		orientation: Orientation;
		retryCount: number;
	} | null>(null);
	// Handler currently registered on the live track's "ended" event, so the
	// unmount teardown effect (a separate effect scope) can remove it.
	const onTrackEndedRef = useRef<(() => void) | undefined>(undefined);
	const [error, setError] = useState<string | null>(null);
	const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
	const [selectedDeviceId, setSelectedDeviceId] = useState<string>(
		initialDeviceId ||
			DeviceService.getStorageItem(DEVICE_ID_STORAGE_KEY) ||
			"",
	);

	// Load settings for currently selected device
	const [resolution, setResolution] = useState<Resolution>(() => {
		const deviceId =
			initialDeviceId ||
			DeviceService.getStorageItem(DEVICE_ID_STORAGE_KEY) ||
			"";
		return CameraSettingsService.getSettingsForDevice(deviceId).resolution;
	});
	const [orientation, setOrientation] = useState<Orientation>(() => {
		const deviceId =
			initialDeviceId ||
			DeviceService.getStorageItem(DEVICE_ID_STORAGE_KEY) ||
			"";
		return CameraSettingsService.getSettingsForDevice(deviceId).orientation;
	});

	const [retryCount, setRetryCount] = useState(0);

	const getDevices = useCallback(async () => {
		const videoDevices = await CameraService.getVideoDevices();
		setDevices(videoDevices);
	}, []);

	// Handle device changes - syncs with external device enumeration
	useEffect(() => {
		getDevices();

		// Use CameraService for device change listener (handles insecure context internally)
		const cleanup = CameraService.addDeviceChangeListener(() => {
			getDevices();
		});

		return cleanup;
	}, [getDevices]);

	// Handle stream lifecycle
	useEffect(() => {
		let isActive = true;

		async function setupCamera() {
			// Skip if the live stream already satisfies this exact request
			// (happens when adoption below writes selectedDeviceId for the
			// stream we just opened).
			const active = activeConfigRef.current;
			if (
				active &&
				streamRef.current &&
				active.deviceId === selectedDeviceId &&
				active.resolution === resolution &&
				active.orientation === orientation &&
				active.retryCount === retryCount
			) {
				return;
			}

			// What the stream actually ends up serving, once resolved. Starts as
			// selectedDeviceId but the OverconstrainedError fallback below clears
			// it (the persisted id was stale) so the adoption step re-derives it
			// from whatever device actually opened.
			let effectiveSelectedId = selectedDeviceId;

			try {
				if (streamRef.current) {
					const oldTrack = streamRef.current.getVideoTracks()[0];
					if (onTrackEndedRef.current) {
						oldTrack?.removeEventListener?.("ended", onTrackEndedRef.current);
					}
					CameraService.stop(streamRef.current);
					streamRef.current = null;
				}

				// Sequenced: enumerate -> resolve -> open. No fire-and-forget
				// racing the selection (H1).
				const preDevices = await CameraService.getVideoDevices();
				if (!isActive) return;
				setDevices(preDevices);

				const resolved = resolveCameraSelection({
					persistedId: selectedDeviceId,
					devices: preDevices,
				});

				let newStream: MediaStream;
				try {
					newStream = await CameraService.start(
						resolved.deviceId ?? undefined,
						resolution,
						orientation,
					);
				} catch (err) {
					// A cancelled run must not run recovery side effects: clearing
					// storage here would clobber the choice the user just made
					// (their setSelectedDeviceId is what cancelled this run), and
					// opening a fallback camera would light a device for a dead run.
					if (!isActive) return;
					const isOverconstrained =
						err instanceof Error && err.name === "OverconstrainedError";
					if (!isOverconstrained || !resolved.deviceId) throw err;
					// Stale persisted id (M3): drop it and fall back to the OS
					// default. The adoption step below persists what actually opens.
					DeviceService.setStorageItem(DEVICE_ID_STORAGE_KEY, "");
					effectiveSelectedId = "";
					newStream = await CameraService.start(
						undefined,
						resolution,
						orientation,
					);
					// Cancellation during the fallback await is handled by the
					// isActive check just below the try/catch.
				}

				if (!isActive) {
					CameraService.stop(newStream);
					return;
				}

				streamRef.current = newStream;
				setStream(newStream);
				setError(null);

				// Unplug detection (M3): a dead track re-runs selection instead of
				// leaving a frozen frame. Guard on stream identity (not the
				// per-run `isActive` flag) - the idempotence guard above can keep
				// this exact stream alive across effect re-runs (e.g. the
				// adoption-driven selectedDeviceId update), and `isActive` for
				// THIS run goes false as soon as that re-run's cleanup fires even
				// though the track is still live.
				const liveTrack = newStream.getVideoTracks()[0];
				const onTrackEnded = () => {
					if (streamRef.current === newStream) {
						setRetryCount((c) => c + 1);
					}
				};
				onTrackEndedRef.current = onTrackEnded;
				liveTrack?.addEventListener?.("ended", onTrackEnded);

				// Refresh device list to get labels after permission grant
				const postDevices = await CameraService.getVideoDevices();
				if (!isActive) return;
				setDevices(postDevices);

				// Adopt the device the stream actually serves. If the track is
				// anonymous (no deviceId — virtual/canvas sources), fall back to
				// the first enumerated device for DISPLAY ONLY: persisting an
				// unchosen device was H1's root cause.
				const track = newStream.getVideoTracks()[0];
				const trackDeviceId = track?.getSettings().deviceId ?? null;
				const displayId =
					effectiveSelectedId ||
					trackDeviceId ||
					postDevices.find((d) => d.deviceId)?.deviceId ||
					"";

				activeConfigRef.current = {
					deviceId: displayId,
					resolution,
					orientation,
					retryCount,
				};

				if (!effectiveSelectedId && displayId && isActive) {
					setSelectedDeviceId(displayId);
					if (trackDeviceId) {
						// Only a device the browser actually opened gets persisted
						DeviceService.setStorageItem(DEVICE_ID_STORAGE_KEY, trackDeviceId);
					}
				}
			} catch (err) {
				if (isActive) {
					console.error("Error accessing camera:", err);
					if (err instanceof InsecureContextError) {
						setError(err.message);
					} else if (
						err instanceof Error &&
						err.name === "OverconstrainedError"
					) {
						setError("Selected camera is unavailable. It may be unplugged.");
					} else if (err instanceof Error && err.name === "NotAllowedError") {
						setError("Could not access camera. Please allow permissions.");
					} else {
						setError("Could not access camera. Please allow permissions.");
					}
					setStream(null);
				}
			}
		}

		setupCamera();

		// Cancellation ONLY. This cleanup runs before every re-run of the
		// effect - stopping the stream here would defeat the idempotence
		// guard above (adoption re-run would always find a torn-down stream).
		return () => {
			isActive = false;
		};
	}, [selectedDeviceId, resolution, orientation, retryCount]); // Re-run when device/resolution/orientation changes

	// Final teardown - the deps-effect cleanup must not stop the stream
	// (it runs before every re-run and would defeat the idempotence guard).
	useEffect(() => {
		return () => {
			activeConfigRef.current = null;
			if (streamRef.current) {
				const cleanupTrack = streamRef.current.getVideoTracks()[0];
				if (onTrackEndedRef.current) {
					cleanupTrack?.removeEventListener?.("ended", onTrackEndedRef.current);
				}
				CameraService.stop(streamRef.current);
				streamRef.current = null;
			}
		};
	}, []);

	// Wrap setter to persist selection and load device-specific settings
	const handleSetSelectedDeviceId = useCallback((deviceId: string) => {
		setSelectedDeviceId(deviceId);
		DeviceService.setStorageItem(DEVICE_ID_STORAGE_KEY, deviceId);

		// Load settings for the new device
		const settings = CameraSettingsService.getSettingsForDevice(deviceId);
		setResolution(settings.resolution);
		setOrientation(settings.orientation);
	}, []);

	// Wrap resolution setter to persist per-device
	const handleSetResolution = useCallback(
		(res: Resolution) => {
			setResolution(res);
			updateSettingForDevice(selectedDeviceId, "resolution", res);
		},
		[selectedDeviceId],
	);

	// Wrap orientation setter to persist per-device
	const handleSetOrientation = useCallback(
		(orient: Orientation) => {
			setOrientation(orient);
			updateSettingForDevice(selectedDeviceId, "orientation", orient);
		},
		[selectedDeviceId],
	);

	// Retry camera access - triggers re-run of the setup effect
	const retry = useCallback(() => {
		setError(null);
		setRetryCount((c) => c + 1);
	}, []);

	return {
		stream,
		error,
		devices,
		selectedDeviceId,
		setSelectedDeviceId: handleSetSelectedDeviceId,
		resolution,
		setResolution: handleSetResolution,
		orientation,
		setOrientation: handleSetOrientation,
		retry,
	};
}

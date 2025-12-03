import { useCallback, useEffect, useRef, useState } from "react";
import * as CameraService from "../services/CameraService";
import { InsecureContextError } from "../services/CameraService";
import { DeviceService } from "../services/DeviceService";

const STORAGE_KEY = "magic-monitor-camera-device-id";

export function useCamera(initialDeviceId?: string) {
	const [stream, setStream] = useState<MediaStream | null>(null);
	const streamRef = useRef<MediaStream | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
	const [selectedDeviceId, setSelectedDeviceId] = useState<string>(
		initialDeviceId || DeviceService.getStorageItem(STORAGE_KEY) || "",
	);
	const [retryCount, setRetryCount] = useState(0);

	const getDevices = useCallback(async () => {
		const videoDevices = await CameraService.getVideoDevices();
		setDevices(videoDevices);

		// If we have devices but none selected, pick the first one
		if (videoDevices.length > 0 && !selectedDeviceId) {
			setSelectedDeviceId(videoDevices[0].deviceId);
		}
	}, [selectedDeviceId]);

	// Handle device changes - syncs with external device enumeration
	useEffect(() => {
		// eslint-disable-next-line react-hooks/set-state-in-effect -- Syncing with external device list
		getDevices();

		// Skip event listener if mediaDevices unavailable (insecure context)
		if (!navigator.mediaDevices) {
			return;
		}

		const handleDeviceChange = () => {
			getDevices();
		};

		navigator.mediaDevices.addEventListener("devicechange", handleDeviceChange);
		return () => {
			navigator.mediaDevices.removeEventListener(
				"devicechange",
				handleDeviceChange,
			);
		};
	}, [getDevices]);

	// Handle stream lifecycle
	useEffect(() => {
		let isActive = true;

		async function setupCamera() {
			try {
				// Stop previous stream if any (use ref to avoid dependency)
				if (streamRef.current) {
					CameraService.stop(streamRef.current);
				}

				const newStream = await CameraService.start(
					selectedDeviceId || undefined,
				);

				if (!isActive) {
					CameraService.stop(newStream);
					return;
				}

				streamRef.current = newStream;
				setStream(newStream);
				setError(null);

				// Refresh device list to get labels after permission grant
				getDevices();

				// Update selected device ID if not set
				if (!selectedDeviceId) {
					const videoTrack = newStream.getVideoTracks()[0];
					if (videoTrack) {
						const settings = videoTrack.getSettings();
						if (settings.deviceId) {
							setSelectedDeviceId(settings.deviceId);
							DeviceService.setStorageItem(STORAGE_KEY, settings.deviceId);
						}
					}
				}
			} catch (err) {
				if (isActive) {
					console.error("Error accessing camera:", err);
					if (err instanceof InsecureContextError) {
						setError(err.message);
					} else if (
						err instanceof Error &&
						(err.name === "NotAllowedError" || err.name === "PermissionDeniedError")
					) {
						setError(
							"Camera access denied. Please allow camera permissions in your browser settings, then reload this page.",
						);
					} else if (err instanceof Error && err.name === "NotFoundError") {
						setError("No camera found. Please connect a camera and try again.");
					} else if (
						err instanceof Error &&
						err.name === "NotReadableError"
					) {
						setError(
							"Camera is in use by another application. Please close other apps using the camera and try again.",
						);
					} else {
						setError("Could not access camera. Please check permissions and try again.");
					}
					setStream(null);
				}
			}
		}

		setupCamera();

		return () => {
			isActive = false;
			if (streamRef.current) {
				CameraService.stop(streamRef.current);
				streamRef.current = null;
			}
		};
	}, [selectedDeviceId, getDevices, retryCount]); // Re-run when selected device changes or retry is triggered

	// Wrap setter to persist selection
	const handleSetSelectedDeviceId = useCallback((deviceId: string) => {
		setSelectedDeviceId(deviceId);
		DeviceService.setStorageItem(STORAGE_KEY, deviceId);
	}, []);

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
		retry,
	};
}

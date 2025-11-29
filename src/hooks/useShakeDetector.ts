import { useCallback, useEffect, useRef } from "react";
import { DeviceService } from "../services/DeviceService";

const DEFAULT_THRESHOLD = 15; // m/s²
const DEFAULT_COOLDOWN_MS = 3000;

interface UseShakeDetectorOptions {
	enabled: boolean;
	threshold?: number;
	cooldownMs?: number;
	onShake: () => void;
}

export function useShakeDetector({
	enabled,
	threshold = DEFAULT_THRESHOLD,
	cooldownMs = DEFAULT_COOLDOWN_MS,
	onShake,
}: UseShakeDetectorOptions) {
	const lastShakeRef = useRef<number>(0);
	const permissionGrantedRef = useRef<boolean>(false);

	const handleMotion = useCallback(
		(event: DeviceMotionEvent) => {
			const { x, y, z } = event.accelerationIncludingGravity || {};
			if (x == null || y == null || z == null) return;

			const magnitude = Math.sqrt(x * x + y * y + z * z);

			// Subtract gravity (~9.8) to detect actual shake acceleration
			const shakeAcceleration = Math.abs(magnitude - 9.8);

			if (shakeAcceleration > threshold) {
				const now = Date.now();
				if (now - lastShakeRef.current > cooldownMs) {
					lastShakeRef.current = now;
					onShake();
				}
			}
		},
		[threshold, cooldownMs, onShake],
	);

	const requestPermission = useCallback(async (): Promise<boolean> => {
		if (!DeviceService.hasDeviceMotion()) {
			return false;
		}
		const result = await DeviceService.requestDeviceMotionPermission();
		permissionGrantedRef.current = result === "granted";
		return permissionGrantedRef.current;
	}, []);

	useEffect(() => {
		if (!enabled || !DeviceService.hasDeviceMotion()) {
			return;
		}

		// Request permission on iOS if not already granted
		if (!permissionGrantedRef.current) {
			DeviceService.requestDeviceMotionPermission().then((result) => {
				permissionGrantedRef.current = result === "granted";
			});
		}

		const cleanup = DeviceService.addDeviceMotionListener(handleMotion);
		return cleanup;
	}, [enabled, handleMotion]);

	return {
		isSupported: DeviceService.hasDeviceMotion(),
		requestPermission,
	};
}

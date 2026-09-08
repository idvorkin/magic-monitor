import { useEffect, useState } from "react";
import {
	DeviceService,
	type DeviceServiceType,
} from "../services/DeviceService";

interface MobileDetectionResult {
	isMobile: boolean;
	screenWidth: number;
}

/**
 * Detects mobile devices.
 * Uses screen size and touch capability.
 */
export function useMobileDetection(
	service: DeviceServiceType = DeviceService,
): MobileDetectionResult {
	const [state, setState] = useState<MobileDetectionResult>(() =>
		detectDevice(service),
	);

	useEffect(() => {
		const handleResize = () => {
			setState(detectDevice(service));
		};

		return service.addResizeListener(handleResize);
	}, [service]);

	return state;
}

function detectDevice(service: DeviceServiceType): MobileDetectionResult {
	const screenWidth = service.getScreenWidth();
	const isTouchDevice = service.isTouchDevice();

	// Consider "mobile" if:
	// 1. Small screen (<768px) OR
	// 2. Touch-primary device with medium screen (<1024px)
	const isSmallScreen = screenWidth < 768;
	const isMediumTouchScreen = isTouchDevice && screenWidth < 1024;

	const isMobile = isSmallScreen || isMediumTouchScreen;

	return {
		isMobile,
		screenWidth,
	};
}

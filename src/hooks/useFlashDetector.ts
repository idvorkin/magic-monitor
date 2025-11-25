import { useEffect, useRef, useState } from "react";

interface FlashDetectorConfig {
	videoRef: React.RefObject<HTMLVideoElement | null>;
	enabled: boolean;
	targetColor: { r: number; g: number; b: number } | null;
	threshold: number; // 0-100
}

export function useFlashDetector({
	videoRef,
	enabled,
	targetColor,
	threshold,
}: FlashDetectorConfig) {
	const [isFlashing, setIsFlashing] = useState(false);
	const canvasRef = useRef<HTMLCanvasElement | null>(null);
	const requestRef = useRef<number>(0);

	useEffect(() => {
		if (!canvasRef.current) {
			canvasRef.current = document.createElement("canvas");
		}

		const checkFrame = () => {
			if (
				!enabled ||
				!targetColor ||
				!videoRef.current ||
				videoRef.current.readyState !== 4
			) {
				requestRef.current = requestAnimationFrame(checkFrame);
				return;
			}

			const video = videoRef.current;
			const canvas = canvasRef.current!;

			// Resize canvas if needed (downsample for performance)
			if (canvas.width !== 320) {
				canvas.width = 320;
				canvas.height = 180; // 16:9 aspect ratio roughly
			}

			const ctx = canvas.getContext("2d", { willReadFrequently: true });
			if (!ctx) return;

			ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

			const frameData = ctx.getImageData(0, 0, canvas.width, canvas.height);
			const data = frameData.data;
			let matchCount = 0;
			const totalPixels = data.length / 4;

			// Simple color distance check
			// Max distance is sqrt(255^2 * 3) = 441.6
			const maxDist = (threshold / 100) * 441.6;

			for (let i = 0; i < data.length; i += 4 * 4) {
				// Sample every 4th pixel for speed
				const r = data[i];
				const g = data[i + 1];
				const b = data[i + 2];

				const dist = Math.sqrt(
					(r - targetColor.r) ** 2 +
						(g - targetColor.g) ** 2 +
						(b - targetColor.b) ** 2,
				);

				if (dist < maxDist) {
					matchCount++;
				}
			}

			// If more than 0.5% of pixels match, trigger flash
			const matchPercentage = (matchCount / (totalPixels / 4)) * 100;

			if (matchPercentage > 0.5) {
				setIsFlashing(true);
			} else {
				setIsFlashing(false);
			}

			requestRef.current = requestAnimationFrame(checkFrame);
		};

		requestRef.current = requestAnimationFrame(checkFrame);

		return () => {
			if (requestRef.current) cancelAnimationFrame(requestRef.current);
		};
	}, [enabled, targetColor, threshold, videoRef]);

	return isFlashing;
}

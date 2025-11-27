import { useEffect, useRef, useState } from "react";

interface FlashDetectorConfig {
	videoRef: React.RefObject<HTMLVideoElement | null>;
	enabled: boolean;
	targetColor: { r: number; g: number; b: number } | null;
	threshold: number; // 0-100
}

export interface RGB {
	r: number;
	g: number;
	b: number;
}

// Max possible distance in RGB space: sqrt(255^2 * 3) ≈ 441.67
export const MAX_COLOR_DISTANCE = Math.sqrt(255 ** 2 * 3);

/** Calculate Euclidean distance between two RGB colors */
export function colorDistance(color1: RGB, color2: RGB): number {
	return Math.sqrt(
		(color1.r - color2.r) ** 2 +
			(color1.g - color2.g) ** 2 +
			(color1.b - color2.b) ** 2,
	);
}

/** Convert threshold (0-100) to max allowed color distance */
export function thresholdToMaxDistance(threshold: number): number {
	return (threshold / 100) * MAX_COLOR_DISTANCE;
}

/** Check if a color matches the target within threshold */
export function isColorMatch(
	sample: RGB,
	target: RGB,
	threshold: number,
): boolean {
	const maxDist = thresholdToMaxDistance(threshold);
	return colorDistance(sample, target) < maxDist;
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

			const maxDist = thresholdToMaxDistance(threshold);

			for (let i = 0; i < data.length; i += 4 * 4) {
				// Sample every 4th pixel for speed
				const sample: RGB = {
					r: data[i],
					g: data[i + 1],
					b: data[i + 2],
				};

				if (colorDistance(sample, targetColor) < maxDist) {
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

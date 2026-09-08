import { useEffect, useRef } from "react";

// MediaPipe hand landmark connections for drawing skeleton
// See: https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker
const HAND_CONNECTIONS: [number, number][] = [
	// Thumb
	[0, 1],
	[1, 2],
	[2, 3],
	[3, 4],
	// Index finger
	[0, 5],
	[5, 6],
	[6, 7],
	[7, 8],
	// Middle finger
	[5, 9],
	[9, 10],
	[10, 11],
	[11, 12],
	// Ring finger
	[9, 13],
	[13, 14],
	[14, 15],
	[15, 16],
	// Pinky
	[13, 17],
	[17, 18],
	[18, 19],
	[19, 20],
	// Palm
	[0, 17],
];

// Colors for each hand (alternating)
const HAND_COLORS = ["#00ff00", "#ff00ff"];

interface HandSkeletonProps {
	landmarksRef: React.RefObject<Array<Array<{ x: number; y: number; z: number }>>>;
	videoRef: React.RefObject<HTMLVideoElement | null>;
	isMirror?: boolean;
}

/**
 * Canvas-based hand skeleton overlay.
 * Uses refs and rAF for 60fps rendering without React re-renders.
 *
 * Architecture: This component never triggers React re-renders during animation.
 * It reads landmarks from a ref (written by useHandLandmarks) and draws directly to canvas.
 */
export function HandSkeleton({ landmarksRef, videoRef, isMirror = false }: HandSkeletonProps) {
	const canvasRef = useRef<HTMLCanvasElement>(null);

	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas) return;

		const ctx = canvas.getContext("2d");
		if (!ctx) return;

		let rafId: number;

		const draw = () => {
			const video = videoRef.current;
			const landmarks = landmarksRef.current;

			// Clear canvas
			ctx.clearRect(0, 0, canvas.width, canvas.height);

			// Skip if no video or no landmarks
			if (!video || !landmarks || landmarks.length === 0) {
				rafId = requestAnimationFrame(draw);
				return;
			}

			// Get video rect for coordinate conversion
			const videoRect = video.getBoundingClientRect();

			// Resize canvas to match window (for crisp rendering)
			if (canvas.width !== window.innerWidth || canvas.height !== window.innerHeight) {
				canvas.width = window.innerWidth;
				canvas.height = window.innerHeight;
			}

			// Convert normalized coordinates (0-1) to screen coordinates
			const toScreenCoords = (point: { x: number; y: number }) => {
				const normalizedX = isMirror ? 1 - point.x : point.x;
				const x = videoRect.left + normalizedX * videoRect.width;
				const y = videoRect.top + point.y * videoRect.height;
				return { x, y };
			};

			// Draw each hand
			landmarks.forEach((hand, handIndex) => {
				const color = HAND_COLORS[handIndex % HAND_COLORS.length];

				// Draw connections (lines)
				ctx.strokeStyle = color;
				ctx.lineWidth = 2;
				ctx.globalAlpha = 0.8;

				for (const [startIdx, endIdx] of HAND_CONNECTIONS) {
					const start = toScreenCoords(hand[startIdx]);
					const end = toScreenCoords(hand[endIdx]);

					ctx.beginPath();
					ctx.moveTo(start.x, start.y);
					ctx.lineTo(end.x, end.y);
					ctx.stroke();
				}

				// Draw landmarks (circles)
				ctx.globalAlpha = 0.9;

				for (const point of hand) {
					const screenPos = toScreenCoords(point);

					// Filled circle
					ctx.fillStyle = color;
					ctx.beginPath();
					ctx.arc(screenPos.x, screenPos.y, 4, 0, Math.PI * 2);
					ctx.fill();

					// White border
					ctx.strokeStyle = "white";
					ctx.lineWidth = 1;
					ctx.stroke();
				}
			});

			ctx.globalAlpha = 1;
			rafId = requestAnimationFrame(draw);
		};

		draw();

		return () => cancelAnimationFrame(rafId);
	}, [landmarksRef, videoRef, isMirror]);

	return (
		<canvas
			ref={canvasRef}
			className="absolute inset-0 pointer-events-none z-30"
			style={{
				width: "100%",
				height: "100%",
			}}
		/>
	);
}

import { useEffect, useState } from "react";

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

interface HandSkeletonProps {
	landmarks: Array<Array<{ x: number; y: number; z: number }>>;
	videoRef: React.RefObject<HTMLVideoElement | null>;
	isMirror?: boolean;
}

interface VideoRect {
	left: number;
	top: number;
	width: number;
	height: number;
}

export function HandSkeleton({ landmarks, videoRef, isMirror = false }: HandSkeletonProps) {
	const [videoRect, setVideoRect] = useState<VideoRect | null>(null);

	// Update video rect via effect - syncs with DOM getBoundingClientRect
	useEffect(() => {
		const video = videoRef.current;
		if (!video) {
			// eslint-disable-next-line react-hooks/set-state-in-effect -- Syncing with DOM element availability
			setVideoRect(null);
			return;
		}

		const updateRect = () => {
			const rect = video.getBoundingClientRect();
			setVideoRect({
				left: rect.left,
				top: rect.top,
				width: rect.width,
				height: rect.height,
			});
		};

		// Update initially and on each animation frame for smooth tracking
		let rafId: number;
		const tick = () => {
			updateRect();
			rafId = requestAnimationFrame(tick);
		};
		tick();

		return () => cancelAnimationFrame(rafId);
	}, [videoRef]);

	if (!landmarks.length || !videoRect) return null;

	// Colors for each hand (alternating)
	const handColors = ["#00ff00", "#ff00ff"];

	return (
		<svg
			className="absolute inset-0 pointer-events-none z-30"
			style={{
				width: "100%",
				height: "100%",
			}}
		>
			{landmarks.map((hand, handIndex) => {
				const color = handColors[handIndex % handColors.length];

				// Convert normalized coordinates (0-1) to screen coordinates
				// When mirrored, flip the X coordinate (1 - x) to match the mirrored video display
				const toScreenCoords = (point: { x: number; y: number }) => {
					const normalizedX = isMirror ? 1 - point.x : point.x;
					const x = videoRect.left + normalizedX * videoRect.width;
					const y = videoRect.top + point.y * videoRect.height;
					return { x, y };
				};

				return (
					// biome-ignore lint/suspicious/noArrayIndexKey: hand order is stable per frame
					<g key={handIndex}>
						{/* Draw connections (lines) */}
						{HAND_CONNECTIONS.map(([startIdx, endIdx], connIndex) => {
							const start = toScreenCoords(hand[startIdx]);
							const end = toScreenCoords(hand[endIdx]);
							return (
								<line
									// biome-ignore lint/suspicious/noArrayIndexKey: connection order is fixed
									key={`conn-${connIndex}`}
									x1={start.x}
									y1={start.y}
									x2={end.x}
									y2={end.y}
									stroke={color}
									strokeWidth={2}
									strokeOpacity={0.8}
								/>
							);
						})}

						{/* Draw landmarks (circles) */}
						{hand.map((point, pointIndex) => {
							const screenPos = toScreenCoords(point);
							return (
								<circle
									// biome-ignore lint/suspicious/noArrayIndexKey: landmark order is fixed (0-20)
									key={`point-${pointIndex}`}
									cx={screenPos.x}
									cy={screenPos.y}
									r={4}
									fill={color}
									fillOpacity={0.9}
									stroke="white"
									strokeWidth={1}
								/>
							);
						})}
					</g>
				);
			})}
		</svg>
	);
}

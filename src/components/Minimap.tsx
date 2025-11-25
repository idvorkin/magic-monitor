import { useEffect, useRef } from "react";

interface MinimapProps {
	stream: MediaStream | null;
	zoom: number;
	pan: { x: number; y: number };
	frame?: ImageBitmap | null;
	onPanTo?: (targetPan: { x: number; y: number }) => void;
}

export function Minimap({ stream, zoom, pan, frame, onPanTo }: MinimapProps) {
	const miniVideoRef = useRef<HTMLVideoElement>(null);
	const miniCanvasRef = useRef<HTMLCanvasElement>(null);
	const containerRef = useRef<HTMLDivElement>(null);

	// Sync the mini video with the main video stream
	useEffect(() => {
		if (!frame && stream && miniVideoRef.current) {
			miniVideoRef.current.srcObject = stream;
		}
	}, [stream, frame]);

	// Render frame if provided
	useEffect(() => {
		if (frame && miniCanvasRef.current) {
			const ctx = miniCanvasRef.current.getContext("2d");
			if (ctx) {
				miniCanvasRef.current.width = frame.width;
				miniCanvasRef.current.height = frame.height;
				ctx.drawImage(frame, 0, 0);
			}
		}
	}, [frame]);

	// if (zoom <= 1) return null; // Always show minimap

	const videoWidth = frame
		? frame.width
		: stream?.getVideoTracks()[0]?.getSettings().width || 640;
	const videoHeight = frame
		? frame.height
		: stream?.getVideoTracks()[0]?.getSettings().height || 480;

	// Calculate overlay size
	const widthPercent = 100 / zoom;
	const heightPercent = 100 / zoom;

	// Calculate position as percentage
	const leftPercent = 50 - (pan.x / videoWidth) * 100 - widthPercent / 2;
	const topPercent = 50 - (pan.y / videoHeight) * 100 - heightPercent / 2;

	const handleClick = (e: React.MouseEvent) => {
		if (!onPanTo || !containerRef.current) return;

		const rect = containerRef.current.getBoundingClientRect();
		const x = e.clientX - rect.left;
		const y = e.clientY - rect.top;

		// Normalized position (0 to 1)
		const u = x / rect.width;
		const v = y / rect.height;

		// Calculate target pan to center on this point
		// If u = 0.5 (center), targetPan = 0
		// If u = 0 (left edge), we need to shift image RIGHT, so pan is positive?
		// Wait, let's check coordinate system again.
		// In CameraStage: transform: translate(pan.x, pan.y)
		// If pan.x is positive, image moves RIGHT.
		// If we want to see the LEFT edge (u=0), we need to move image RIGHT.
		// Center is 0.5.
		// Target shift = (0.5 - u) * videoWidth.
		// Check: if u=0, shift = 0.5 * W. Image moves right by half width. Left edge is now at center. Correct.

		const targetPanX = (0.5 - u) * videoWidth;
		const targetPanY = (0.5 - v) * videoHeight;

		onPanTo({ x: targetPanX, y: targetPanY });
	};

	return (
		<div
			ref={containerRef}
			onClick={handleClick}
			className="absolute top-16 right-4 z-50 w-48 aspect-video bg-black/80 border-2 border-white/20 rounded-lg overflow-hidden shadow-lg cursor-pointer"
		>
			{frame ? (
				<canvas
					ref={miniCanvasRef}
					className="w-full h-full object-contain opacity-50 pointer-events-none"
				/>
			) : (
				<video
					ref={miniVideoRef}
					autoPlay
					playsInline
					muted
					className="w-full h-full object-contain opacity-50 pointer-events-none"
				/>
			)}

			{/* Viewport Rectangle */}
			<div
				className="absolute border-2 border-yellow-400 bg-yellow-400/20 shadow-[0_0_10px_rgba(250,204,21,0.5)] pointer-events-none transition-all duration-75"
				style={{
					width: `${widthPercent}%`,
					height: `${heightPercent}%`,
					left: `${leftPercent}%`,
					top: `${topPercent}%`,
				}}
			/>
		</div>
	);
}

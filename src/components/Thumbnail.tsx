import { useEffect, useRef } from "react";

interface ThumbnailProps {
	frame: ImageBitmap;
	onClick?: () => void;
	label?: string;
	isActive?: boolean;
}

export function Thumbnail({ frame, onClick, label, isActive }: ThumbnailProps) {
	const canvasRef = useRef<HTMLCanvasElement>(null);

	useEffect(() => {
		if (canvasRef.current && frame) {
			const ctx = canvasRef.current.getContext("2d");
			if (ctx) {
				// Maintain aspect ratio
				const aspect = frame.width / frame.height;
				canvasRef.current.width = 100;
				canvasRef.current.height = 100 / aspect;
				ctx.drawImage(
					frame,
					0,
					0,
					canvasRef.current.width,
					canvasRef.current.height,
				);
			}
		}
	}, [frame]);

	return (
		<div
			onClick={onClick}
			className={`relative cursor-pointer transition-all hover:scale-105 ${isActive ? "ring-2 ring-blue-500" : "opacity-70 hover:opacity-100"}`}
		>
			<canvas ref={canvasRef} className="rounded-md bg-black" />
			{label && (
				<div className="absolute bottom-0 right-0 bg-black/70 text-white text-[10px] px-1 rounded-tl">
					{label}
				</div>
			)}
		</div>
	);
}

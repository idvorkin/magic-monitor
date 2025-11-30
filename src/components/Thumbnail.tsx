import clsx from "clsx";
import { useEffect, useRef } from "react";

interface ThumbnailProps {
	/** ImageBitmap frame for canvas rendering (memory mode) */
	frame?: ImageBitmap;
	/** JPEG data URL for img rendering (disk mode) */
	imageUrl?: string;
	onClick?: () => void;
	label?: string;
	isActive?: boolean;
}

export function Thumbnail({
	frame,
	imageUrl,
	onClick,
	label,
	isActive,
}: ThumbnailProps) {
	const canvasRef = useRef<HTMLCanvasElement>(null);

	// Render ImageBitmap to canvas (memory mode)
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

	const containerClass = clsx(
		"relative cursor-pointer transition-all hover:scale-105",
		isActive ? "ring-2 ring-blue-500" : "opacity-70 hover:opacity-100",
	);

	return (
		<div onClick={onClick} className={containerClass}>
			{imageUrl ? (
				// Disk mode: use img element with data URL
				<img
					src={imageUrl}
					alt={label || "Thumbnail"}
					className="rounded-md bg-black w-[100px] h-auto"
				/>
			) : (
				// Memory mode: use canvas for ImageBitmap
				<canvas ref={canvasRef} className="rounded-md bg-black" />
			)}
			{label && (
				<div className="absolute bottom-0 right-0 bg-black/70 text-white text-[10px] px-1 rounded-tl">
					{label}
				</div>
			)}
		</div>
	);
}

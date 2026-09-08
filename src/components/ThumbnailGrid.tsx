import clsx from "clsx";
import type { SessionThumbnail } from "../types/sessions";
import { formatDuration } from "../utils/formatters";

// ===== Types =====

export interface ThumbnailGridProps {
	thumbnails: SessionThumbnail[];
	onSelect: (time: number) => void;
	/** Layout mode: 'aspect' uses CSS aspect-ratio with grid columns */
	layout?: "aspect";
	/** Number of columns for grid layout */
	columns?: number;
	/** Whether to use mobile-optimized styling */
	isMobile?: boolean;
	/** Gap between thumbnails in pixels */
	gap?: number;
	/** CSS class for the container */
	className?: string;
}

// ===== Helpers =====

/**
 * Formats time for thumbnail display.
 * Uses compact format (M:SS) for brevity.
 */
function formatThumbnailTime(seconds: number): string {
	const mins = Math.floor(seconds / 60);
	const secs = Math.floor(seconds % 60);
	return `${mins}:${secs.toString().padStart(2, "0")}`;
}

// ===== Component =====

/**
 * Grid of clickable thumbnail images with time labels.
 */
export function ThumbnailGrid({
	thumbnails,
	onSelect,
	columns = 4,
	isMobile = false,
	gap = 8,
	className,
}: ThumbnailGridProps) {
	if (thumbnails.length === 0) return null;

	return (
		<div
			className={clsx("grid", className)}
			style={{
				gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
				gap: `${gap}px`,
			}}
		>
			{thumbnails.map((thumb, index) => (
				<button
					key={`${thumb.time}-${index}`}
					onClick={() => onSelect(thumb.time)}
					className={clsx(
						"relative rounded overflow-hidden bg-gray-800 transition-all",
						"hover:ring-2 hover:ring-blue-500",
						"aspect-video",
					)}
				>
					<img
						src={thumb.dataUrl}
						alt={`Frame at ${formatDuration(thumb.time)}`}
						className="w-full h-full object-contain"
					/>
					<div
						className={clsx(
							"absolute bg-black/70 text-white font-mono rounded",
							isMobile
								? "bottom-0.5 left-0.5 text-[10px] px-1"
								: "bottom-1 left-1 text-xs px-1.5 py-0.5",
						)}
					>
						{formatThumbnailTime(thumb.time)}
					</div>
					<div className="absolute inset-0 bg-blue-500/20 opacity-0 hover:opacity-100 transition-opacity" />
				</button>
			))}
		</div>
	);
}

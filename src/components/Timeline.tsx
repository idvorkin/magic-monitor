import clsx from "clsx";
import { useCallback, useEffect, useRef } from "react";
import type { SessionThumbnail } from "../types/sessions";

// ===== Helpers =====

function formatThumbTime(seconds: number): string {
	const mins = Math.floor(seconds / 60);
	const secs = Math.floor(seconds % 60);
	return mins > 0 ? `${mins}:${secs.toString().padStart(2, "0")}` : `${secs}s`;
}

// ===== Types =====

interface TimelineProps {
	currentTime: number;
	duration: number;
	inPoint: number | null;
	outPoint: number | null;
	onSeek: (time: number) => void;
	thumbnails?: SessionThumbnail[];
	isMobile?: boolean;
	disabled?: boolean;
	thumbnailSize?: number; // 0-100, controls thumbnail dimensions
}

// ===== Component =====

export function Timeline({
	currentTime,
	duration,
	inPoint,
	outPoint,
	onSeek,
	thumbnails,
	isMobile = false,
	disabled = false,
	thumbnailSize = 50,
}: TimelineProps) {
	// Calculate thumbnail dimensions based on size slider (0=small, 100=large)
	// Width ranges from 48px to 200px, height maintains 16:9 aspect
	const thumbWidth = Math.round(48 + (thumbnailSize / 100) * 152);
	const thumbHeight = Math.round(thumbWidth * (9 / 16));
	// containerRef is for the draggable scrubber surface (the track and any
	// non-strip padding). The thumbnail strip is a separate scrollable region
	// and is excluded from scrubbing (see handlePointerDown).
	// trackRef is for the visual progress bar (used for position calculations)
	const containerRef = useRef<HTMLDivElement>(null);
	const trackRef = useRef<HTMLDivElement>(null);
	const thumbStripRef = useRef<HTMLDivElement>(null);
	const activeHandlersRef = useRef<{
		move: ((e: PointerEvent) => void) | null;
		up: ((e: PointerEvent) => void) | null;
	}>({ move: null, up: null });

	// Calculate time from click position (uses trackRef for accurate positioning)
	const getTimeFromPosition = useCallback(
		(clientX: number): number => {
			// A non-finite duration (unfixed WebM header) would turn every
			// position into Infinity or NaN, which downstream clamps to the last
			// frame. Treat it as "no timeline yet".
			if (!trackRef.current || !Number.isFinite(duration) || duration <= 0) {
				return 0;
			}

			const rect = trackRef.current.getBoundingClientRect();
			const x = clientX - rect.left;
			const percent = Math.max(0, Math.min(1, x / rect.width));
			return percent * duration;
		},
		[duration],
	);

	// Handle click/drag on the scrubber track (NOT the thumbnail strip)
	const handlePointerDown = useCallback(
		(e: React.PointerEvent) => {
			// Don't call preventDefault - causes issues with passive event listeners
			const container = containerRef.current;
			if (!container || disabled) return;

			// Ignore events on the thumbnail strip (let it handle its own scrolling).
			// The strip's gap/padding/scroll region is a separate interaction surface
			// from the scrubber track; without this guard a pointerdown/drag that
			// starts in the strip bubbles here, gets pointer-captured by the
			// container, and continuously scrubs the video instead of scrolling.
			if (thumbStripRef.current?.contains(e.target as Node)) {
				return;
			}

			// Store the pointerId for use in handlers (to ensure we capture/release the same pointer)
			const pointerId = e.pointerId;

			// Capture pointer for drag tracking on the container
			try {
				container.setPointerCapture(pointerId);
			} catch {
				// Ignore pointer capture failures (can happen in some browsers)
			}

			// Seek to click position
			const time = getTimeFromPosition(e.clientX);
			onSeek(time);

			// Set up drag using pointer capture (no need for document listeners)
			const handleMove = (moveEvent: PointerEvent) => {
				const newTime = getTimeFromPosition(moveEvent.clientX);
				onSeek(newTime);
			};

			const handleUp = (upEvent: PointerEvent) => {
				try {
					container.releasePointerCapture(upEvent.pointerId);
				} catch {
					// Ignore release failures
				}
				container.removeEventListener("pointermove", handleMove);
				container.removeEventListener("pointerup", handleUp);
				container.removeEventListener("pointercancel", handleUp);
				activeHandlersRef.current = { move: null, up: null };
			};

			activeHandlersRef.current = { move: handleMove, up: handleUp };
			container.addEventListener("pointermove", handleMove);
			container.addEventListener("pointerup", handleUp);
			container.addEventListener("pointercancel", handleUp);
		},
		[getTimeFromPosition, onSeek, disabled],
	);

	// Cleanup effect to remove event listeners if component unmounts during drag
	useEffect(() => {
		const container = containerRef.current;
		return () => {
			const handlers = activeHandlersRef.current;
			if (container && handlers.move) {
				container.removeEventListener("pointermove", handlers.move);
				container.removeEventListener("pointerup", handlers.up!);
				container.removeEventListener("pointercancel", handlers.up!);
			}
		};
	}, []);

	// Handle horizontal scroll with mouse wheel/trackpad on thumbnail strip
	// Use useEffect to add listener with { passive: false } to allow preventDefault
	useEffect(() => {
		const strip = thumbStripRef.current;
		if (!strip) return;

		const handleWheel = (e: globalThis.WheelEvent) => {
			// Handle both vertical and horizontal scroll gestures
			// Trackpad horizontal swipe = deltaX, vertical swipe = deltaY
			// Mouse wheel = deltaY only
			const scrollAmount = e.deltaX !== 0 ? e.deltaX : e.deltaY;
			if (scrollAmount !== 0) {
				e.preventDefault();
				strip.scrollLeft += scrollAmount;
			}
		};

		strip.addEventListener("wheel", handleWheel, { passive: false });
		return () => strip.removeEventListener("wheel", handleWheel);
	}, [thumbnails]); // Re-attach when thumbnails change (strip might remount)

	// Calculate positions as percentages
	const currentPercent = duration > 0 ? (currentTime / duration) * 100 : 0;
	const inPercent = inPoint !== null && duration > 0 ? (inPoint / duration) * 100 : null;
	const outPercent = outPoint !== null && duration > 0 ? (outPoint / duration) * 100 : null;

	return (
		<div
			ref={containerRef}
			data-testid="timeline-container"
			className={clsx(
				"w-full",
				disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer",
			)}
			onPointerDown={handlePointerDown}
		>
			{/* Thumbnail strip (if available) */}
			{thumbnails && thumbnails.length > 0 && (
				<div
					ref={thumbStripRef}
					className="flex gap-1 mb-2 overflow-x-auto pb-1 touch-pan-x"
				>
					{thumbnails.map((thumb, index) => (
						<button
							key={index}
							type="button"
							aria-label={`Seek to ${formatThumbTime(thumb.time)}`}
							onClick={() => onSeek(thumb.time)}
							onPointerDown={(e) => e.stopPropagation()}
							style={{ width: thumbWidth, height: thumbHeight }}
							className={clsx(
								"flex-shrink-0 rounded overflow-hidden relative cursor-pointer transition-all bg-black",
								"hover:ring-2 hover:ring-white/50 focus-visible:ring-2 focus-visible:ring-blue-400 focus:outline-none",
								"active:brightness-90 active:ring-blue-400",
								currentTime >= thumb.time &&
									(index === thumbnails.length - 1 ||
										currentTime < thumbnails[index + 1]?.time) &&
									"ring-2 ring-blue-500",
							)}
						>
							<img
								src={thumb.dataUrl}
								alt={`Frame at ${thumb.time.toFixed(1)}s`}
								className="w-full h-full object-contain"
								draggable={false}
								loading="lazy"
							/>
							<span className="absolute bottom-0 right-0 bg-black/70 text-white text-[10px] px-1 rounded-tl">
								{formatThumbTime(thumb.time)}
							</span>
						</button>
					))}
				</div>
			)}

			{/* Timeline track */}
			<div
				ref={trackRef}
				data-testid="timeline-track"
				className={clsx(
					"relative w-full bg-gray-700 rounded-full touch-none",
					isMobile ? "h-2" : "h-3",
				)}
			>
				{/* Trim selection highlight */}
				{inPercent !== null && outPercent !== null && (
					<div
						className="absolute top-0 bottom-0 bg-green-600/50 rounded-full"
						style={{
							left: `${inPercent}%`,
							width: `${outPercent - inPercent}%`,
						}}
					/>
				)}

				{/* Progress fill */}
				<div
					className="absolute top-0 left-0 bottom-0 bg-blue-500 rounded-full"
					style={{ width: `${currentPercent}%` }}
				/>

				{/* In point marker */}
				{inPercent !== null && (
					<div
						className="absolute top-0 bottom-0 w-1 bg-green-500"
						style={{ left: `${inPercent}%` }}
						title="In point"
					>
						<div className="absolute -top-1 left-1/2 -translate-x-1/2 w-2 h-2 bg-green-500 rotate-45" />
					</div>
				)}

				{/* Out point marker */}
				{outPercent !== null && (
					<div
						className="absolute top-0 bottom-0 w-1 bg-green-500"
						style={{ left: `${outPercent}%` }}
						title="Out point"
					>
						<div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-2 h-2 bg-green-500 rotate-45" />
					</div>
				)}

				{/* Playhead */}
				<div
					className={clsx(
						"absolute top-1/2 -translate-y-1/2 -translate-x-1/2 bg-white rounded-full shadow-lg",
						isMobile ? "w-3 h-3" : "w-4 h-4",
					)}
					style={{ left: `${currentPercent}%` }}
				/>
			</div>
		</div>
	);
}

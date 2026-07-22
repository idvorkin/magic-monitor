import clsx from "clsx";
import { useCallback, useMemo, useRef, useState } from "react";
import { useMobileDetection } from "../hooks/useMobileDetection";
import type { ReplayPlayerControls } from "../hooks/useReplayPlayer";
import { selectThumbnailsForDisplay } from "../utils/thumbnailSelection";
import { SmartZoomToggle } from "./SmartZoomToggle";
import { Timeline } from "./Timeline";

// ===== Types =====

interface ReplayControlsProps {
	player: ReplayPlayerControls;
	onExit: () => void;
	onSaveClick: () => void;
	onSessionsClick?: () => void;
	isMobile?: boolean;
	isSmartZoom?: boolean;
	onSmartZoomChange?: (enabled: boolean) => void;
	isModelLoading?: boolean;
	loadingProgress?: number;
	loadingPhase?: "downloading" | "initializing";
	modelError?: string | null;
}

// ===== Helper =====

function formatTime(seconds: number): string {
	const mins = Math.floor(seconds / 60);
	const secs = Math.floor(seconds % 60);
	const tenths = Math.floor((seconds % 1) * 10);
	return `${mins}:${secs.toString().padStart(2, "0")}.${tenths}`;
}

// ===== Component =====

export function ReplayControls({
	player,
	onExit,
	onSaveClick,
	onSessionsClick,
	isMobile = false,
	isSmartZoom = false,
	onSmartZoomChange,
	isModelLoading = false,
	loadingProgress = 0,
	loadingPhase = "downloading",
	modelError = null,
}: ReplayControlsProps) {
	const {
		isReady,
		isPlaying,
		currentTime,
		duration,
		inPoint,
		outPoint,
		hasTrimSelection,
		isExporting,
		exportProgress,
		play,
		pause,
		seek,
		stepFrame,
		setInPoint,
		setOutPoint,
		clearTrim,
		previewTrim,
		exportVideo,
	} = player;

	// Panel display state
	const [showThumbnails, setShowThumbnails] = useState(true);
	const [thumbnailSize, setThumbnailSize] = useState(50); // 0-100 slider
	const [panelPosition, setPanelPosition] = useState({ x: 0, y: 0 });
	const dragRef = useRef<{ startX: number; startY: number; startPosX: number; startPosY: number } | null>(null);
	const dragHandleRef = useRef<HTMLDivElement>(null);

	const { isMobile: detectedMobile } = useMobileDetection();
	const effectiveMobile = isMobile || detectedMobile;

	// Handle drag start for control panel (only from drag handle)
	const handleDragStart = useCallback((e: React.PointerEvent) => {
		e.preventDefault();
		const handle = dragHandleRef.current;
		if (!handle) return;

		handle.setPointerCapture(e.pointerId);
		dragRef.current = {
			startX: e.clientX,
			startY: e.clientY,
			startPosX: panelPosition.x,
			startPosY: panelPosition.y,
		};
	}, [panelPosition]);

	const handleDragMove = useCallback((e: React.PointerEvent) => {
		if (!dragRef.current) return;
		const dx = e.clientX - dragRef.current.startX;
		const dy = e.clientY - dragRef.current.startY;
		setPanelPosition({
			x: dragRef.current.startPosX + dx,
			y: dragRef.current.startPosY + dy,
		});
	}, []);

	const handleDragEnd = useCallback((e: React.PointerEvent) => {
		if (!dragRef.current) return;
		const handle = dragHandleRef.current;
		if (handle) {
			handle.releasePointerCapture(e.pointerId);
		}
		dragRef.current = null;
	}, []);

	// Select thumbnails for display
	const displayThumbnails = useMemo(() => {
		if (!showThumbnails || !player.session?.thumbnails) return undefined;
		return selectThumbnailsForDisplay(
			player.session.thumbnails,
			player.session.duration,
			effectiveMobile,
		);
	}, [showThumbnails, player.session, effectiveMobile]);

	return (
		<div
			className={clsx(
				"z-50 w-full max-w-4xl absolute left-1/2",
				isMobile ? "bottom-3 px-2" : "bottom-12 px-4",
			)}
			style={{
				transform: `translate(calc(-50% + ${panelPosition.x}px), ${panelPosition.y}px)`,
			}}
		>
			{/* Drag handle - only element that initiates panel drag */}
			<div
				ref={dragHandleRef}
				className="flex items-center justify-center cursor-move select-none py-1 touch-none"
				title="Drag to move"
				onPointerDown={handleDragStart}
				onPointerMove={handleDragMove}
				onPointerUp={handleDragEnd}
				onPointerCancel={handleDragEnd}
			>
				{/* Grip dots pattern - 3 columns x 2 rows */}
				<div className="grid grid-cols-3 gap-0.5">
					{Array.from({ length: 6 }).map((_, i) => (
						<div key={i} className="w-1 h-1 rounded-full bg-gray-500" />
					))}
				</div>
			</div>

			{/* Main control bar */}
			<div
				className={clsx(
					"bg-gray-900/95 backdrop-blur-md flex flex-col w-full shadow-xl",
					isMobile ? "rounded-lg" : "rounded-2xl",
				)}
			>
				{/* Timeline with thumbnails */}
				<div className={clsx("px-4", isMobile ? "py-2" : "py-3")}>
					<Timeline
						currentTime={currentTime}
						duration={duration}
						inPoint={inPoint}
						outPoint={outPoint}
						onSeek={seek}
						thumbnails={displayThumbnails}
						isMobile={isMobile}
						disabled={!isReady}
						thumbnailSize={thumbnailSize}
					/>
				</div>

				{/* Transport controls - compact layout */}
				<div
					className={clsx(
						"flex items-center justify-between border-t border-gray-700",
						isMobile ? "px-2 py-1" : "px-3 py-1",
					)}
				>
					{/* Left: Exit, Sessions, and navigation */}
					<div className="flex items-center gap-1.5">
						<button
							onClick={onExit}
							className={clsx(
								"rounded font-medium bg-white/20 text-white hover:bg-white/30",
								isMobile ? "px-1.5 py-0.5 text-xs" : "px-2 py-0.5 text-xs",
							)}
						>
							✕ Exit
						</button>

						{onSessionsClick && (
							<button
								onClick={onSessionsClick}
								className={clsx(
									"rounded font-medium bg-blue-600 text-white hover:bg-blue-500",
									isMobile ? "px-1.5 py-0.5 text-xs" : "px-2 py-0.5 text-xs",
								)}
								title="Sessions"
							>
								📹 Sessions
							</button>
						)}

						{/* Preview thumbnails toggle */}
						{player.session?.thumbnails && player.session.thumbnails.length > 0 && (
							<>
								<button
									onClick={() => setShowThumbnails(!showThumbnails)}
									className={clsx(
										"rounded font-medium transition-colors",
										showThumbnails
											? "bg-blue-600 text-white hover:bg-blue-500"
											: "bg-gray-700 text-gray-300 hover:bg-gray-600",
										isMobile ? "px-1.5 py-0.5 text-xs" : "px-2 py-0.5 text-xs",
									)}
									title="Toggle previews"
								>
									🖼
								</button>
								{showThumbnails && (
									<div className="flex items-center">
										<button
											onClick={() => setThumbnailSize(Math.max(0, thumbnailSize - 25))}
											className="text-xs text-gray-400 hover:text-white w-5 h-5 flex items-center justify-center"
											title="Smaller thumbnails"
										>
											−
										</button>
										<button
											onClick={() => setThumbnailSize(Math.min(100, thumbnailSize + 25))}
											className="text-xs text-gray-400 hover:text-white w-5 h-5 flex items-center justify-center"
											title="Larger thumbnails"
										>
											+
										</button>
									</div>
								)}
							</>
						)}

						<div className="h-4 w-px bg-gray-700" />

						{/* Frame step buttons */}
						<button
							onClick={() => stepFrame(-1)}
							disabled={!isReady}
							className={clsx(
								"rounded transition-colors",
								isMobile ? "p-0.5 text-xs" : "p-1 text-sm",
								isReady ? "hover:bg-white/10" : "opacity-50 cursor-not-allowed",
							)}
							aria-label="Previous frame"
							title="Previous frame"
						>
							◀◀
						</button>

						{/* Play/Pause */}
						<button
							onClick={isPlaying ? pause : play}
							disabled={!isReady}
							className={clsx(
								"flex items-center justify-center rounded-full text-white transition-colors",
								isMobile ? "w-6 h-6 text-sm" : "w-7 h-7 text-base",
								isReady
									? "bg-blue-600 hover:bg-blue-500"
									: "bg-blue-600/50 cursor-not-allowed",
							)}
						>
							{isPlaying ? "⏸" : "▶"}
						</button>

						<button
							onClick={() => stepFrame(1)}
							disabled={!isReady}
							className={clsx(
								"rounded transition-colors",
								isMobile ? "p-0.5 text-xs" : "p-1 text-sm",
								isReady ? "hover:bg-white/10" : "opacity-50 cursor-not-allowed",
							)}
							aria-label="Next frame"
							title="Next frame"
						>
							▶▶
						</button>

						{/* Smart Zoom Toggle */}
						{onSmartZoomChange && !isMobile && (
							<>
								<div className="h-4 w-px bg-gray-700" />
								<SmartZoomToggle
									isSmartZoom={isSmartZoom}
									onSmartZoomChange={onSmartZoomChange}
									isModelLoading={isModelLoading}
									loadingProgress={loadingProgress}
									loadingPhase={loadingPhase}
									modelError={modelError}
								/>
							</>
						)}
					</div>

					{/* Center: Time display */}
					<div
						className={clsx(
							"font-mono text-white",
							isMobile ? "text-[10px]" : "text-xs",
						)}
					>
						{formatTime(currentTime)} / {formatTime(duration)}
					</div>

					{/* Right: Trim and export */}
					<div className="flex items-center gap-1">
						{/* Trim controls */}
						<button
							onClick={setInPoint}
							disabled={!isReady}
							className={clsx(
								"rounded font-medium transition-colors",
								isMobile ? "px-1.5 py-0.5 text-xs" : "px-2 py-0.5 text-xs",
								!isReady && "bg-gray-700/50 text-gray-500 cursor-not-allowed",
								isReady && inPoint !== null && "bg-green-600 text-white",
								isReady && inPoint === null && "bg-gray-700 text-gray-300 hover:bg-gray-600",
							)}
							title="Set start point"
						>
							In
						</button>

						<button
							onClick={setOutPoint}
							disabled={!isReady}
							className={clsx(
								"rounded font-medium transition-colors",
								isMobile ? "px-1.5 py-0.5 text-xs" : "px-2 py-0.5 text-xs",
								!isReady && "bg-gray-700/50 text-gray-500 cursor-not-allowed",
								isReady && outPoint !== null && "bg-green-600 text-white",
								isReady && outPoint === null && "bg-gray-700 text-gray-300 hover:bg-gray-600",
							)}
							title="Set end point"
						>
							Out
						</button>

						{hasTrimSelection && (
							<>
								<button
									onClick={previewTrim}
									className={clsx(
										"rounded font-medium bg-blue-600 text-white hover:bg-blue-500",
										isMobile ? "px-1.5 py-0.5 text-xs" : "px-2 py-0.5 text-xs",
									)}
									title="Preview trimmed clip"
								>
									▶ Preview
								</button>

								<button
									onClick={clearTrim}
									className={clsx(
										"rounded text-gray-400 hover:text-white hover:bg-gray-700",
										isMobile ? "px-1 py-0.5 text-xs" : "px-1.5 py-0.5 text-xs",
									)}
									title="Clear selection"
								>
									Clear
								</button>
							</>
						)}

						{!isMobile && <div className="h-4 w-px bg-gray-700" />}

						{/* Save and export */}
						{!isMobile && (
							<>
								<button
									onClick={onSaveClick}
									className="px-2 py-0.5 rounded font-medium bg-green-600 text-white hover:bg-green-500 text-xs"
									title="Save to library"
								>
									⭐ Save
								</button>

								<button
									onClick={exportVideo}
									disabled={isExporting}
									className={clsx(
										"px-2 py-0.5 rounded font-medium text-white text-xs",
										isExporting
											? "bg-yellow-600/80 cursor-wait"
											: "bg-purple-600 hover:bg-purple-500",
									)}
									title="Share or download"
								>
									{isExporting
										? `${Math.round(exportProgress * 100)}%`
										: "📤 Share"}
								</button>
							</>
						)}
					</div>
				</div>
			</div>
		</div>
	);
}

import { useCallback, useEffect, useRef, useState } from "react";
import { useSmartZoom } from "../hooks/useSmartZoom";
import { useZoomPan } from "../hooks/useZoomPan";
import type { ReplayPlayerControls } from "../hooks/useReplayPlayer";
import type { SmoothingPreset } from "../smoothing";
import { ErrorOverlay } from "./ErrorOverlay";
import { LoadingOverlay } from "./LoadingOverlay";
import { Minimap } from "./Minimap";
import { ReplayControls } from "./ReplayControls";

// ===== Types =====

interface ReplayViewProps {
	player: ReplayPlayerControls;
	onExit: () => void;
	onSessionsClick?: () => void;
	isMobile?: boolean;
	smoothingPreset?: SmoothingPreset;
}

// ===== Component =====

export function ReplayView({
	player,
	onExit,
	onSessionsClick,
	isMobile = false,
	smoothingPreset = "ema",
}: ReplayViewProps) {
	// Destructure player state to avoid eslint false positives about refs
	const {
		isLoading,
		isReady,
		error,
		videoRef: playerVideoRef,
		saveClip,
		isPlaying,
		play,
		pause,
		stepFrame,
	} = player;

	const [showSaveDialog, setShowSaveDialog] = useState(false);
	const [clipName, setClipName] = useState("");
	const [isSmartZoom, setIsSmartZoom] = useState(false);
	const [videoSrc, setVideoSrc] = useState<string | undefined>(undefined);

	// Create a ref for smart zoom (since player uses callback ref)
	const videoRef = useRef<HTMLVideoElement | null>(null);
	const containerRef = useRef<HTMLDivElement | null>(null);

	// Manual zoom/pan - disables smart zoom when user manually zooms
	const handleManualZoom = useCallback(() => {
		if (isSmartZoom) setIsSmartZoom(false);
	}, [isSmartZoom]);

	const zoomPan = useZoomPan({
		videoRef,
		containerRef,
		onZoomChange: handleManualZoom,
	});

	// Callback ref that syncs both refs
	const handleVideoRef = useCallback(
		(element: HTMLVideoElement | null) => {
			videoRef.current = element;
			playerVideoRef(element);
		},
		[playerVideoRef],
	);

	// Update videoSrc for minimap when video is ready (blob URL is set)
	// Listen to loadeddata event to catch when src is actually loaded
	useEffect(() => {
		const video = videoRef.current;
		if (!video) return;

		const handleLoadedData = () => {
			if (video.src) {
				setVideoSrc(video.src);
			}
		};

		// Check if already loaded
		if (isReady && video.src) {
			setVideoSrc(video.src);
		} else if (!isReady) {
			setVideoSrc(undefined);
		}

		video.addEventListener("loadeddata", handleLoadedData);
		return () => video.removeEventListener("loadeddata", handleLoadedData);
	}, [isReady]);

	// Smart Zoom for replay video
	const smartZoom = useSmartZoom({
		videoRef,
		enabled: isSmartZoom,
		smoothingPreset,
	});

	// Compute effective zoom/pan: use smartZoom when enabled, else manual zoom/pan
	const effectiveZoom = isSmartZoom ? smartZoom.zoom : zoomPan.zoom;
	const effectivePan = isSmartZoom ? smartZoom.pan : zoomPan.pan;

	// Build transform string
	const effectiveTransform = `scale(${effectiveZoom}) translate(${(effectivePan.x * 100).toFixed(2)}%, ${(effectivePan.y * 100).toFixed(2)}%)`;

	// Handle save clip
	const handleSaveClip = useCallback(async () => {
		if (!clipName.trim()) return;
		await saveClip(clipName.trim());
		setShowSaveDialog(false);
		setClipName("");
	}, [saveClip, clipName]);

	// Keyboard shortcuts for replay controls
	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			// Ignore if typing in input field
			if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
				return;
			}

			switch (e.key) {
				case " ": // Space = play/pause
					e.preventDefault();
					if (isReady) {
						if (isPlaying) {
							pause();
						} else {
							play();
						}
					}
					break;
				case "ArrowLeft": // Left arrow = previous frame
					e.preventDefault();
					if (isReady) {
						stepFrame(-1);
					}
					break;
				case "ArrowRight": // Right arrow = next frame
					e.preventDefault();
					if (isReady) {
						stepFrame(1);
					}
					break;
				case "s":
				case "S": // S = sessions picker
					e.preventDefault();
					if (onSessionsClick) {
						onSessionsClick();
					}
					break;
			}
		};

		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [isReady, isPlaying, play, pause, stepFrame, onSessionsClick]);

	return (
		<div
			ref={containerRef}
			className="absolute inset-0 flex flex-col"
			onMouseDown={zoomPan.handleMouseDown}
			onMouseMove={zoomPan.handleMouseMove}
			onMouseUp={zoomPan.handleMouseUp}
			onMouseLeave={zoomPan.handleMouseUp}
			style={{ cursor: effectiveZoom > 1 ? (zoomPan.isDragging ? "grabbing" : "grab") : "default" }}
		>
			{/* Replay indicator */}
			<div className="absolute top-8 right-8 z-40 bg-blue-600/80 backdrop-blur text-white px-4 py-2 rounded-lg font-mono text-xl font-bold animate-pulse border border-blue-400">
				REPLAY MODE
			</div>

			{/* Loading overlay */}
			{isLoading && <LoadingOverlay message="Loading video..." />}

			{/* Error overlay */}
			{error && (
				<ErrorOverlay
					message={error}
					onAction={onExit}
					actionLabel="Go Back"
				/>
			)}

			{/* Minimap (zoom indicator) - shows when zoomed in (smart or manual) */}
			{effectiveZoom > 1 && (
				<Minimap
					videoSrc={videoSrc}
					zoom={effectiveZoom}
					pan={effectivePan}
					mainVideoRef={videoRef}
					onPanTo={isSmartZoom ? undefined : zoomPan.setPan}
				/>
			)}

			{/* Zoom level indicator */}
			{effectiveZoom > 1 && (
				<div className="absolute top-8 left-8 z-40 bg-gray-900/80 backdrop-blur text-white px-3 py-1.5 rounded-lg font-mono text-sm">
					{effectiveZoom.toFixed(1)}x
				</div>
			)}

			{/* Video element (managed by player hook) */}
			<video
				ref={handleVideoRef}
				muted
				playsInline
				className="flex-1 w-full h-full object-contain"
				style={{
					transform: effectiveTransform,
				}}
			/>

			{/* Controls */}
			<ReplayControls
				player={player}
				onExit={onExit}
				onSaveClick={() => setShowSaveDialog(true)}
				onSessionsClick={onSessionsClick}
				isMobile={isMobile}
				isSmartZoom={isSmartZoom}
				onSmartZoomChange={setIsSmartZoom}
				isModelLoading={smartZoom.isModelLoading}
				loadingProgress={smartZoom.loadingProgress}
				loadingPhase={smartZoom.loadingPhase}
				modelError={smartZoom.modelError}
			/>

			{/* Save Dialog */}
			{showSaveDialog && (
				<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
					<div className="bg-gray-900 rounded-2xl p-6 max-w-md w-full mx-4">
						<h3 className="text-lg font-semibold text-white mb-4">
							Save Clip
						</h3>
						<input
							type="text"
							value={clipName}
							onChange={(e) => setClipName(e.target.value)}
							placeholder="Name your clip..."
							className="w-full px-4 py-2 bg-gray-800 text-white rounded-lg border border-gray-700 focus:border-blue-500 focus:outline-none"
							autoFocus
							onKeyDown={(e) => {
								if (e.key === "Enter") handleSaveClip();
								if (e.key === "Escape") setShowSaveDialog(false);
							}}
						/>
						<div className="flex justify-end gap-3 mt-4">
							<button
								onClick={() => setShowSaveDialog(false)}
								className="px-4 py-2 text-gray-400 hover:text-white"
							>
								Cancel
							</button>
							<button
								onClick={handleSaveClip}
								disabled={!clipName.trim()}
								className="px-4 py-2 bg-green-600 hover:bg-green-500 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded-lg font-medium"
							>
								Save
							</button>
						</div>
					</div>
				</div>
			)}
		</div>
	);
}

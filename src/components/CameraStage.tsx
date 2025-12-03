import { Settings } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useBugReporter } from "../hooks/useBugReporter";
import { useCamera } from "../hooks/useCamera";
import { useDiskTimeMachine } from "../hooks/useDiskTimeMachine";
import { useEscapeKey } from "../hooks/useEscapeKey";
import { useFlashDetector } from "../hooks/useFlashDetector";
import { useMobileDetection } from "../hooks/useMobileDetection";
import { useShakeDetector } from "../hooks/useShakeDetector";
import { useSmartZoom } from "../hooks/useSmartZoom";
import { useVersionCheck } from "../hooks/useVersionCheck";
import { DeviceService } from "../services/DeviceService";
import type { SmoothingPreset } from "../smoothing";
import { AboutModal } from "./AboutModal";
import { BugReportModal } from "./BugReportModal";
import { HandSkeleton } from "./HandSkeleton";
import { Minimap } from "./Minimap";
import { SettingsModal } from "./SettingsModal";
import { StatusButton } from "./StatusButton";
import { Thumbnail } from "./Thumbnail";

// Storage keys for persisted settings
const SMOOTHING_PRESET_STORAGE_KEY = "magic-monitor-smoothing-preset";
const SMART_ZOOM_STORAGE_KEY = "magic-monitor-smart-zoom";
const SHOW_HAND_SKELETON_STORAGE_KEY = "magic-monitor-show-hand-skeleton";
const FLASH_ENABLED_STORAGE_KEY = "magic-monitor-flash-enabled";
const FLASH_THRESHOLD_STORAGE_KEY = "magic-monitor-flash-threshold";
const FLASH_TARGET_COLOR_STORAGE_KEY = "magic-monitor-flash-target-color";
const MIRROR_STORAGE_KEY = "magic-monitor-mirror";

export function CameraStage() {
	const videoRef = useRef<HTMLVideoElement>(null);
	const containerRef = useRef<HTMLDivElement>(null);

	// Zoom/Pan State
	const [zoom, setZoom] = useState(1);
	const [pan, setPan] = useState({ x: 0, y: 0 });
	const [isDragging, setIsDragging] = useState(false);
	const [lastMousePos, setLastMousePos] = useState({ x: 0, y: 0 });

	// Mobile Detection
	const { isMobile } = useMobileDetection();

	// Filmstrip expand/collapse state (collapsed by default on mobile)
	const [expandFilmstrip, setExpandFilmstrip] = useState(false);

	// Flash Detection State (persisted to localStorage)
	const [flashEnabled, setFlashEnabledInternal] = useState(() => {
		return DeviceService.getStorageItem(FLASH_ENABLED_STORAGE_KEY) === "true";
	});
	const [targetColor, setTargetColorInternal] = useState<{
		r: number;
		g: number;
		b: number;
	} | null>(() => {
		const stored = DeviceService.getStorageItem(FLASH_TARGET_COLOR_STORAGE_KEY);
		if (stored) {
			try {
				return JSON.parse(stored);
			} catch {
				return null;
			}
		}
		return null;
	});
	const [threshold, setThresholdInternal] = useState(() => {
		const stored = DeviceService.getStorageItem(FLASH_THRESHOLD_STORAGE_KEY);
		if (stored) {
			const parsed = Number.parseInt(stored, 10);
			if (!Number.isNaN(parsed)) return parsed;
		}
		return 20;
	});
	const [isPickingColor, setIsPickingColor] = useState(false);

	// Smart Zoom State (persisted to localStorage)
	const [isSmartZoom, setIsSmartZoomInternal] = useState(() => {
		const stored = DeviceService.getStorageItem(SMART_ZOOM_STORAGE_KEY);
		if (stored !== null) return stored === "true";
		return true; // Default on
	});
	const [showHandSkeleton, setShowHandSkeletonInternal] = useState(() => {
		return (
			DeviceService.getStorageItem(SHOW_HAND_SKELETON_STORAGE_KEY) === "true"
		);
	});
	const [isSettingsOpen, setIsSettingsOpen] = useState(false);
	const [isAboutOpen, setIsAboutOpen] = useState(false);

	// Mirror state (persisted to localStorage)
	const [isMirror, setIsMirrorInternal] = useState(() => {
		return DeviceService.getStorageItem(MIRROR_STORAGE_KEY) === "true";
	});

	// Smoothing preset state (persisted to localStorage)
	const [smoothingPreset, setSmoothingPresetInternal] =
		useState<SmoothingPreset>(() => {
			const stored = DeviceService.getStorageItem(SMOOTHING_PRESET_STORAGE_KEY);
			if (
				stored === "ema" ||
				stored === "kalmanFast" ||
				stored === "kalmanSmooth"
			) {
				return stored;
			}
			return "ema";
		});

	// Wrapped setters that persist to localStorage
	const setSmoothingPreset = useCallback((preset: SmoothingPreset) => {
		setSmoothingPresetInternal(preset);
		DeviceService.setStorageItem(SMOOTHING_PRESET_STORAGE_KEY, preset);
	}, []);

	const setIsSmartZoom = useCallback((value: boolean) => {
		setIsSmartZoomInternal(value);
		DeviceService.setStorageItem(SMART_ZOOM_STORAGE_KEY, String(value));
	}, []);

	const setShowHandSkeleton = useCallback((value: boolean) => {
		setShowHandSkeletonInternal(value);
		DeviceService.setStorageItem(SHOW_HAND_SKELETON_STORAGE_KEY, String(value));
	}, []);

	const setFlashEnabled = useCallback((value: boolean) => {
		setFlashEnabledInternal(value);
		DeviceService.setStorageItem(FLASH_ENABLED_STORAGE_KEY, String(value));
	}, []);

	const setThreshold = useCallback((value: number) => {
		setThresholdInternal(value);
		DeviceService.setStorageItem(FLASH_THRESHOLD_STORAGE_KEY, String(value));
	}, []);

	const setTargetColor = useCallback(
		(color: { r: number; g: number; b: number } | null) => {
			setTargetColorInternal(color);
			if (color) {
				DeviceService.setStorageItem(
					FLASH_TARGET_COLOR_STORAGE_KEY,
					JSON.stringify(color),
				);
			} else {
				DeviceService.setStorageItem(FLASH_TARGET_COLOR_STORAGE_KEY, "");
			}
		},
		[],
	);

	const setIsMirror = useCallback((value: boolean) => {
		setIsMirrorInternal(value);
		DeviceService.setStorageItem(MIRROR_STORAGE_KEY, String(value));
	}, []);

	// Helper to clamp NORMALIZED pan values (resolution-independent)
	// See docs/SMART_ZOOM_SPEC.md: maxPan = (1 - 1/zoom) / 2
	const clampPan = useCallback((p: { x: number; y: number }, z: number) => {
		const maxPan = (1 - 1 / z) / 2;
		return {
			x: Math.max(-maxPan, Math.min(maxPan, p.x)),
			y: Math.max(-maxPan, Math.min(maxPan, p.y)),
		};
	}, []);

	// Smart Zoom
	const smartZoom = useSmartZoom({
		videoRef,
		enabled: isSmartZoom,
		smoothingPreset,
	});

	// Compute effective zoom/pan: use smartZoom values when enabled, else local state
	const effectiveZoom = isSmartZoom ? smartZoom.zoom : zoom;
	const effectivePan = isSmartZoom ? smartZoom.pan : pan;

	// Helper to build video/canvas transform string
	// Combines mirror, zoom, and pan transforms
	const getVideoTransform = useCallback(() => {
		const mirrorTransform = isMirror ? "scaleX(-1) " : "";
		return `${mirrorTransform}scale(${effectiveZoom}) translate(${(effectivePan.x * 100).toFixed(2)}%, ${(effectivePan.y * 100).toFixed(2)}%)`;
	}, [isMirror, effectiveZoom, effectivePan]);

	// Time Machine State (Disk-based for mobile support and full resolution)
	// 2-second chunks, 30 chunks max = 60 seconds buffer
	const timeMachine = useDiskTimeMachine({
		videoRef,
		enabled: true,
		chunkDurationMs: 2000,
		maxChunks: 30,
	});

	// Ref for the replay video element (disk-based playback)
	const replayVideoRef = useRef<HTMLVideoElement>(null);

	const isFlashing = useFlashDetector({
		videoRef,
		enabled: flashEnabled,
		targetColor,
		threshold,
	});

	// Camera State via Humble Object Hook
	const { stream, error, devices, selectedDeviceId, setSelectedDeviceId, retry } =
		useCamera();

	// Version check for updates
	const {
		updateAvailable,
		reload: reloadForUpdate,
		checkForUpdate,
		isChecking: isCheckingUpdate,
		lastCheckTime,
	} = useVersionCheck();

	// Bug Reporter
	const bugReporter = useBugReporter();

	// Shake detector for bug reporting
	const {
		isSupported: isShakeSupported,
		requestPermission: requestShakePermission,
	} = useShakeDetector({
		enabled: bugReporter.shakeEnabled,
		onShake: bugReporter.open,
	});

	// Detect platform for keyboard shortcut display
	const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0;
	const bugReportShortcut = isMac ? "⌘I" : "Ctrl+I";

	// Keyboard shortcut for bug reporting (Ctrl/Cmd + I)
	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			if ((e.ctrlKey || e.metaKey) && e.key === "i") {
				e.preventDefault();
				bugReporter.open();
			}
		};
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [bugReporter]);

	// Sync stream to video element
	useEffect(() => {
		if (videoRef.current) {
			videoRef.current.srcObject = stream;
		}
	}, [stream]);

	// Sync replay video from disk time machine
	useEffect(() => {
		if (timeMachine.isReplaying && replayVideoRef.current) {
			// Get the playback video from the hook
			const playbackVideo = timeMachine.getPlaybackVideo();
			if (playbackVideo?.src) {
				// Copy the src to our visible replay video element
				if (replayVideoRef.current.src !== playbackVideo.src) {
					replayVideoRef.current.src = playbackVideo.src;
				}
				// Sync play/pause state
				if (timeMachine.isPlaying && replayVideoRef.current.paused) {
					replayVideoRef.current.play().catch(console.error);
				} else if (!timeMachine.isPlaying && !replayVideoRef.current.paused) {
					replayVideoRef.current.pause();
				}
			}
		}
	}, [timeMachine.isReplaying, timeMachine.isPlaying, timeMachine]);

	// Escape key handler
	useEscapeKey({
		isSettingsOpen,
		isPickingColor,
		isReplaying: timeMachine.isReplaying,
		onCloseSettings: () => setIsSettingsOpen(false),
		onCancelColorPick: () => setIsPickingColor(false),
		onExitReplay: timeMachine.exitReplay,
	});

	const handleWheel = (e: React.WheelEvent) => {
		e.preventDefault();
		// Manual zoom takes control from smart zoom
		if (isSmartZoom) setIsSmartZoom(false);
		const newZoom = Math.min(Math.max(zoom - e.deltaY * 0.001, 1), 5);
		setZoom(newZoom);

		// Re-clamp pan with new zoom level
		setPan((prev) => clampPan(prev, newZoom));
	};

	const handleMouseDown = (e: React.MouseEvent) => {
		if (isPickingColor) {
			pickColor(e.clientX, e.clientY);
			return;
		}

		if (zoom > 1) {
			setIsDragging(true);
			setLastMousePos({ x: e.clientX, y: e.clientY });
		}
	};

	const pickColor = (x: number, y: number) => {
		if (!videoRef.current || !containerRef.current) return;

		const video = videoRef.current;
		const rect = video.getBoundingClientRect();

		const scaleX = video.videoWidth / rect.width;
		const scaleY = video.videoHeight / rect.height;

		const videoX = (x - rect.left) * scaleX;
		const videoY = (y - rect.top) * scaleY;

		const canvas = document.createElement("canvas");
		canvas.width = video.videoWidth;
		canvas.height = video.videoHeight;
		const ctx = canvas.getContext("2d");
		if (!ctx) return;

		ctx.drawImage(video, 0, 0);
		const pixel = ctx.getImageData(videoX, videoY, 1, 1).data;

		setTargetColor({ r: pixel[0], g: pixel[1], b: pixel[2] });
		setIsPickingColor(false);
		setFlashEnabled(true);
	};

	const handleMouseMove = (e: React.MouseEvent) => {
		if (isDragging && zoom > 1 && !isPickingColor) {
			const dx = e.clientX - lastMousePos.x;
			const dy = e.clientY - lastMousePos.y;

			// Convert pixel delta to normalized coordinates
			// Use video element's rendered size for accurate conversion
			const videoRect = videoRef.current?.getBoundingClientRect();
			const renderedWidth = videoRect?.width || 1;
			const renderedHeight = videoRect?.height || 1;

			// Normalized delta: pixel movement / (rendered size * zoom)
			// The zoom factor accounts for scale(zoom) in CSS transform
			const normalizedDx = dx / (renderedWidth * zoom);
			const normalizedDy = dy / (renderedHeight * zoom);

			const proposedPan = {
				x: pan.x + normalizedDx,
				y: pan.y + normalizedDy,
			};

			setPan(clampPan(proposedPan, zoom));
			setLastMousePos({ x: e.clientX, y: e.clientY });
		}
	};

	const handleMouseUp = () => {
		setIsDragging(false);
	};

	const handlePanTo = (target: { x: number; y: number }) => {
		setPan(clampPan(target, zoom));
	};

	// Download SmartZoom debug trace as JSON
	const handleDownloadDebugTrace = useCallback(() => {
		const trace = smartZoom.getDebugTrace();
		const blob = new Blob([JSON.stringify(trace, null, 2)], {
			type: "application/json",
		});
		const url = URL.createObjectURL(blob);
		const a = document.createElement("a");
		a.href = url;
		a.download = `smartzoom-debug-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
		URL.revokeObjectURL(url);
	}, [smartZoom]);

	return (
		<div
			ref={containerRef}
			className={`relative w-full h-full bg-black overflow-hidden flex items-center justify-center ${isPickingColor ? "cursor-crosshair" : "cursor-move"}`}
			onWheel={handleWheel}
			onMouseDown={handleMouseDown}
			onMouseMove={handleMouseMove}
			onMouseUp={handleMouseUp}
			onMouseLeave={handleMouseUp}
		>
			{/* Flash Warning Overlay */}
			<div
				className={`absolute inset-0 border-[20px] border-red-600 z-40 pointer-events-none transition-opacity duration-100 ${isFlashing ? "opacity-100" : "opacity-0"}`}
			/>

			{/* Pan Boundary Debug Overlay (see docs/SMART_ZOOM_SPEC.md) */}
			{isSmartZoom && (
				<>
					<div
						className={`absolute left-0 top-0 bottom-0 w-2 bg-red-500 z-40 pointer-events-none transition-opacity duration-150 ${smartZoom.clampedEdges.left ? "opacity-100" : "opacity-0"}`}
					/>
					<div
						className={`absolute right-0 top-0 bottom-0 w-2 bg-red-500 z-40 pointer-events-none transition-opacity duration-150 ${smartZoom.clampedEdges.right ? "opacity-100" : "opacity-0"}`}
					/>
					<div
						className={`absolute top-0 left-0 right-0 h-2 bg-red-500 z-40 pointer-events-none transition-opacity duration-150 ${smartZoom.clampedEdges.top ? "opacity-100" : "opacity-0"}`}
					/>
					<div
						className={`absolute bottom-0 left-0 right-0 h-2 bg-red-500 z-40 pointer-events-none transition-opacity duration-150 ${smartZoom.clampedEdges.bottom ? "opacity-100" : "opacity-0"}`}
					/>
				</>
			)}

			{/* Bug Report Modal */}
			<BugReportModal
				isOpen={bugReporter.isOpen}
				onClose={bugReporter.close}
				onOpen={bugReporter.open}
				onSubmit={bugReporter.submit}
				isSubmitting={bugReporter.isSubmitting}
				defaultData={bugReporter.getDefaultData()}
				shakeEnabled={bugReporter.shakeEnabled}
				onShakeEnabledChange={bugReporter.setShakeEnabled}
				isShakeSupported={isShakeSupported}
				onRequestShakePermission={requestShakePermission}
				isFirstTime={bugReporter.isFirstTime}
				onFirstTimeShown={bugReporter.markFirstTimeShown}
				shortcut={bugReportShortcut}
			/>

			<SettingsModal
				isOpen={isSettingsOpen}
				onClose={() => setIsSettingsOpen(false)}
				devices={devices}
				selectedDeviceId={selectedDeviceId}
				onDeviceChange={setSelectedDeviceId}
				isMirror={isMirror}
				onMirrorChange={setIsMirror}
				isSmartZoom={isSmartZoom}
				isModelLoading={smartZoom.isModelLoading}
				onSmartZoomChange={setIsSmartZoom}
				smoothingPreset={smoothingPreset}
				onSmoothingPresetChange={setSmoothingPreset}
				showHandSkeleton={showHandSkeleton}
				onShowHandSkeletonChange={setShowHandSkeleton}
				flashEnabled={flashEnabled}
				onFlashEnabledChange={setFlashEnabled}
				threshold={threshold}
				onThresholdChange={setThreshold}
				isPickingColor={isPickingColor}
				onPickColorClick={() => setIsPickingColor(true)}
				targetColor={targetColor}
				updateAvailable={updateAvailable}
				isCheckingUpdate={isCheckingUpdate}
				lastCheckTime={lastCheckTime}
				onCheckForUpdate={checkForUpdate}
				onReloadForUpdate={reloadForUpdate}
				shakeEnabled={bugReporter.shakeEnabled}
				onShakeEnabledChange={bugReporter.setShakeEnabled}
				isShakeSupported={isShakeSupported}
				onOpenAbout={() => setIsAboutOpen(true)}
			/>

			<AboutModal
				isOpen={isAboutOpen}
				onClose={() => setIsAboutOpen(false)}
				githubRepoUrl={bugReporter.githubRepoUrl}
				onReportBug={bugReporter.open}
				bugReportShortcut={bugReportShortcut}
			/>

			{/* Delay Indicator Overlay */}
			{timeMachine.isReplaying && (
				<div className="absolute top-8 right-8 z-40 bg-blue-600/80 backdrop-blur text-white px-4 py-2 rounded-lg font-mono text-xl font-bold animate-pulse border border-blue-400">
					REPLAY MODE
				</div>
			)}

			{/* Minimap (Only when zoomed) */}
			<Minimap
				stream={stream}
				zoom={effectiveZoom}
				pan={effectivePan}
				frame={null}
				onPanTo={handlePanTo}
			/>

			{/* Status Bar */}
			<div className="absolute bottom-8 right-8 z-40 text-white/50 font-mono text-xs pointer-events-none flex flex-col items-end gap-1">
				{smartZoom.isModelLoading && (
					<span className="text-blue-400 animate-pulse">
						Loading AI model...
					</span>
				)}
				{timeMachine.recordingError ? (
					<span className="text-red-400">{timeMachine.recordingError}</span>
				) : (
					<span>
						{timeMachine.isRecording ? "REC" : ""} {timeMachine.chunkCount}{" "}
						chunks ({timeMachine.totalDuration.toFixed(0)}s)
					</span>
				)}
			</div>

			{error && (
				<div className="absolute inset-0 flex items-center justify-center z-50 bg-black/80">
					<div className="flex flex-col items-center gap-4 max-w-md mx-4 text-center">
						<p className="text-xl font-bold text-red-500">{error}</p>
						<div className="flex gap-3">
							<button
								onClick={retry}
								className="px-6 py-3 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-lg text-lg transition-colors"
							>
								Try Again
							</button>
							<button
								onClick={() => window.location.reload()}
								className="px-6 py-3 bg-green-600 hover:bg-green-500 text-white font-bold rounded-lg text-lg transition-colors"
							>
								Reload Page
							</button>
						</div>
						<p className="text-white/60 text-sm">
							If camera access was denied, enable it in your browser settings, then click "Reload Page":
						</p>
						<ul className="text-white/50 text-xs text-left list-disc pl-4 space-y-1">
							<li><strong>iOS Safari:</strong> Settings → Safari → Camera → Allow</li>
							<li><strong>Chrome/Edge:</strong> Click the lock icon in the address bar → Camera → Allow</li>
							<li><strong>Firefox:</strong> Click the lock icon → Connection secure → More information → Permissions</li>
						</ul>
					</div>
				</div>
			)}

			{/* Live Video */}
			<video
				data-testid="main-video"
				ref={videoRef}
				autoPlay
				playsInline
				muted
				className={`max-w-full max-h-full object-contain transition-transform duration-75 ease-out ${timeMachine.isReplaying ? "hidden" : "block"}`}
				style={{
					// See docs/SMART_ZOOM_SPEC.md for transform details
					transform: getVideoTransform(),
				}}
			/>

			{/* Hand Skeleton Debug Overlay */}
			{showHandSkeleton && isSmartZoom && !timeMachine.isReplaying && (
				<HandSkeleton
					landmarks={smartZoom.debugLandmarks}
					videoRef={videoRef}
					isMirror={isMirror}
				/>
			)}

			{/* Replay Video (disk-based playback) */}
			<video
				ref={replayVideoRef}
				muted
				playsInline
				className={`max-w-full max-h-full object-contain transition-transform duration-75 ease-out ${timeMachine.isReplaying ? "block" : "hidden"}`}
				style={{
					transform: getVideoTransform(),
				}}
			/>

			{/* Controls Overlay */}
			<div
				className={`absolute left-1/2 -translate-x-1/2 flex flex-col gap-4 items-center z-50 w-full max-w-4xl ${isMobile ? "bottom-3 px-0" : "bottom-12 px-4"}`}
			>
				{/* Replay Controls (when replaying) */}
				{timeMachine.isReplaying && (
					<div className="flex flex-col gap-2 w-full items-center">
						{/* Control bar - ultra compact on mobile */}
						<div
							className={`bg-blue-900/90 backdrop-blur-sm flex items-center justify-center ${isMobile ? "px-3 py-1 rounded-none gap-2 w-full" : "p-4 rounded-2xl gap-4"}`}
						>
							<button
								onClick={timeMachine.exitReplay}
								className={`rounded font-bold bg-white/20 text-white hover:bg-white/30 ${isMobile ? "px-2 py-0.5 text-[10px]" : "px-4 py-1 text-sm"}`}
							>
								✕
							</button>

							{/* Debug button - hidden on mobile */}
							{!isMobile && (
								<button
									onClick={handleDownloadDebugTrace}
									className="px-3 py-1 rounded font-bold bg-yellow-600/80 text-white hover:bg-yellow-500 text-xs"
									title="Download SmartZoom debug trace"
								>
									Debug Log
								</button>
							)}

							{!isMobile && <div className="h-8 w-px bg-white/20 mx-2" />}

							<button
								onClick={
									timeMachine.isPlaying ? timeMachine.pause : timeMachine.play
								}
								className={`flex items-center justify-center rounded-full hover:bg-white/10 flex-shrink-0 ${isMobile ? "text-base w-6 h-6" : "text-2xl w-10 h-10"}`}
							>
								{timeMachine.isPlaying ? "⏸️" : "▶️"}
							</button>

							{/* Prev/Next chunk buttons for coarse navigation */}
							<button
								onClick={timeMachine.prevChunk}
								className={`hover:bg-white/10 rounded ${isMobile ? "text-sm px-1" : "text-lg px-2"}`}
								title="Previous chunk"
							>
								⏮
							</button>

							<input
								type="range"
								min="0"
								max={Math.max(timeMachine.chunkCount - 1, 0)}
								step="1"
								value={timeMachine.currentChunkIndex}
								onChange={(e) =>
									timeMachine.seekToChunk(Number.parseInt(e.target.value, 10))
								}
								className={`flex-1 min-w-[50px] accent-blue-400 rounded-full bg-blue-950 ${isMobile ? "h-1.5" : "h-2"}`}
							/>

							<button
								onClick={timeMachine.nextChunk}
								className={`hover:bg-white/10 rounded ${isMobile ? "text-sm px-1" : "text-lg px-2"}`}
								title="Next chunk"
							>
								⏭
							</button>

							<span
								className={`text-right font-mono flex-shrink-0 ${isMobile ? "w-8 text-[10px]" : "w-16 text-sm"}`}
							>
								{timeMachine.currentTime.toFixed(0)}s
							</span>

							{/* Save video button */}
							{!isMobile && (
								<button
									onClick={timeMachine.saveVideo}
									disabled={timeMachine.isExporting}
									className={`px-3 py-1 rounded font-bold text-white text-xs ${
										timeMachine.isExporting
											? "bg-yellow-600/80 cursor-wait"
											: "bg-green-600/80 hover:bg-green-500"
									}`}
									title="Download replay video (may need VLC to play)"
								>
									{timeMachine.isExporting
										? `⏳ ${Math.round(timeMachine.exportProgress * 100)}%`
										: "💾 Save"}
								</button>
							)}

							{/* Filmstrip toggle button */}
							<button
								onClick={() => setExpandFilmstrip(!expandFilmstrip)}
								className={`flex-shrink-0 hover:text-blue-300 transition-colors ${isMobile ? "text-sm" : "text-xl"}`}
								title={expandFilmstrip ? "Hide timeline" : "Show timeline"}
							>
								{expandFilmstrip ? "▼" : "▲"}
							</button>
						</div>

						{/* Collapsible Filmstrip - Cinematic Timeline */}
						<div
							className={`transition-all duration-500 ease-out overflow-hidden w-full ${
								expandFilmstrip ? "opacity-100" : "max-h-0 opacity-0"
							}`}
							style={{
								maxHeight: expandFilmstrip ? (isMobile ? "28vh" : "35vh") : "0",
								paddingBottom: isMobile ? "max(env(safe-area-inset-bottom), 20px)" : "0",
							}}
						>
							<div
								className="relative flex gap-4 overflow-x-auto w-full py-4 px-4 snap-x snap-mandatory h-full"
								style={{
									background:
										"linear-gradient(180deg, rgba(0,0,0,0.95) 0%, rgba(0,0,0,0.98) 100%)",
									boxShadow: "inset 0 1px 0 rgba(255,255,255,0.05)",
								}}
							>
								{/* Film grain texture overlay */}
								<div
									className="absolute inset-0 pointer-events-none opacity-20"
									style={{
										backgroundImage:
											"url(\"data:image/svg+xml,%3Csvg viewBox='0 0 400 400' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E\")",
										backgroundSize: "200px 200px",
									}}
								/>

								{timeMachine.previews
									.filter((_, index) => index % 4 === 0)
									.slice(0, 8)
									.map((preview, displayIndex) => {
										const actualIndex = displayIndex * 4;
										const isActive =
											timeMachine.currentChunkIndex === actualIndex;
										return (
											<div
												key={preview.id}
												className="flex-shrink-0 snap-center relative group"
												style={{
													animationDelay: `${displayIndex * 50}ms`,
													animation: expandFilmstrip
														? "slideInUp 0.4s ease-out forwards"
														: "none",
													opacity: expandFilmstrip ? 1 : 0,
													minWidth: isMobile ? "100px" : "160px",
												}}
											>
												{/* Timestamp badge */}
												<div
													className="absolute -top-2 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded text-xs font-mono tracking-wider z-10 whitespace-nowrap"
													style={{
														background: isActive
															? "linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)"
															: "rgba(0,0,0,0.8)",
														color: isActive ? "#fff" : "#94a3b8",
														border: isActive
															? "1px solid rgba(59, 130, 246, 0.5)"
															: "1px solid rgba(148, 163, 184, 0.2)",
														fontSize: isMobile ? "10px" : "11px",
														fontWeight: isActive ? "600" : "400",
														textShadow: isActive
															? "0 0 8px rgba(59, 130, 246, 0.5)"
															: "none",
													}}
												>
													{`${(actualIndex * 2).toFixed(0)}s`}
												</div>

												{/* Thumbnail with cinematic treatment */}
												<div
													className={`relative cursor-pointer transition-all duration-300 ${
														isActive ? "scale-105" : "scale-100"
													} hover:scale-105`}
													onClick={() => timeMachine.seekToChunk(actualIndex)}
													style={{
														width: isMobile ? "100px" : "160px",
														height: isMobile ? "56px" : "90px",
														filter: isActive
															? "brightness(1.1) contrast(1.05)"
															: "brightness(0.85) contrast(0.95)",
														boxShadow: isActive
															? "0 0 0 2px #3b82f6, 0 0 20px rgba(59, 130, 246, 0.6), 0 8px 16px rgba(0,0,0,0.4)"
															: "0 2px 8px rgba(0,0,0,0.3)",
													}}
												>
													<Thumbnail
														imageUrl={preview.preview}
														onClick={() => {}}
														isActive={false}
													/>

													{/* Active indicator overlay */}
													{isActive && (
														<div
															className="absolute inset-0 pointer-events-none"
															style={{
																background:
																	"linear-gradient(180deg, rgba(59, 130, 246, 0.15) 0%, rgba(37, 99, 235, 0.15) 100%)",
																border: "2px solid rgba(59, 130, 246, 0.8)",
																borderRadius: "0.375rem",
															}}
														/>
													)}
												</div>

												{/* Hover state glow */}
												<div
													className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none"
													style={{
														background:
															"radial-gradient(circle at center, rgba(59, 130, 246, 0.2) 0%, transparent 70%)",
														filter: "blur(8px)",
													}}
												/>
											</div>
										);
									})}
							</div>
						</div>
					</div>
				)}

				{/* Main Controls Bar (Hidden during replay) */}
				{!timeMachine.isReplaying && (
					<div className="bg-black/50 backdrop-blur-md p-3 rounded-2xl flex items-center gap-3">
						{/* Rewind Button */}
						<button
							onClick={timeMachine.enterReplay}
							className="px-3 py-1.5 rounded-lg text-xs font-bold bg-blue-600 text-white hover:bg-blue-500 flex items-center gap-1.5"
						>
							<span>⏪</span> Rewind
						</button>
						<div className="h-6 w-px bg-white/20" />

						{/* Status Toggles */}
						<StatusButton
							onClick={() => setIsSmartZoom(!isSmartZoom)}
							disabled={smartZoom.isModelLoading}
							active={isSmartZoom && !smartZoom.isModelLoading}
							color="green"
							title="Smart Zoom - Auto-follow movement"
						>
							{smartZoom.isModelLoading
								? "Loading..."
								: isSmartZoom
									? "Smart ✓"
									: "Smart"}
						</StatusButton>

						<StatusButton
							onClick={() => setFlashEnabled(!flashEnabled)}
							active={flashEnabled}
							color="red"
							title="Flash Detection"
						>
							{flashEnabled ? "⚡ ARMED" : "⚡ Flash"}
						</StatusButton>

						{/* Zoom Controls - hidden on mobile (no mouse wheel) */}
						{!isMobile && (
							<>
								<div className="h-6 w-px bg-white/20" />
								<button
									onClick={() => {
										// Manual reset takes control from smart zoom
										if (isSmartZoom) setIsSmartZoom(false);
										setZoom(1);
										setPan({ x: 0, y: 0 });
									}}
									className="text-white font-bold px-3 py-1 rounded hover:bg-white/20 text-sm"
								>
									Reset
								</button>
								<input
									type="range"
									min="1"
									max="5"
									step="0.1"
									value={effectiveZoom}
									onChange={(e) => {
										const newZoom = Number.parseFloat(e.target.value);
										// Manual zoom takes control from smart zoom
										if (isSmartZoom) setIsSmartZoom(false);
										setZoom(newZoom);
										setPan((prev) => clampPan(prev, newZoom));
									}}
									className="w-32 accent-blue-500"
								/>
								<span className="text-white font-mono w-12 text-right">
									{effectiveZoom.toFixed(1)}x
								</span>
								<div className="h-6 w-px bg-white/20" />
							</>
						)}

						{/* Settings */}
						<button
							onClick={() => setIsSettingsOpen(true)}
							className="p-1.5 rounded-lg text-white/50 hover:text-white hover:bg-white/10 transition-colors"
							title="Settings"
						>
							<Settings size={18} />
						</button>
					</div>
				)}
			</div>
		</div>
	);
}

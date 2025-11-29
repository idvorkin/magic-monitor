import { Github, Settings } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useCamera } from "../hooks/useCamera";
import { useEscapeKey } from "../hooks/useEscapeKey";
import { useFlashDetector } from "../hooks/useFlashDetector";
import { useMobileDetection } from "../hooks/useMobileDetection";
import { useSmartZoom } from "../hooks/useSmartZoom";
import { useTimeMachine } from "../hooks/useTimeMachine";
import { useVersionCheck } from "../hooks/useVersionCheck";
import { DeviceService } from "../services/DeviceService";
import type { SmoothingPreset } from "../smoothing";
import { HandSkeleton } from "./HandSkeleton";
import { Minimap } from "./Minimap";
import { SettingsModal } from "./SettingsModal";
import { Thumbnail } from "./Thumbnail";

// Storage keys for persisted settings
const SMOOTHING_PRESET_STORAGE_KEY = "magic-monitor-smoothing-preset";
const HQ_STORAGE_KEY = "magic-monitor-hq";
const SMART_ZOOM_STORAGE_KEY = "magic-monitor-smart-zoom";
const SHOW_HAND_SKELETON_STORAGE_KEY = "magic-monitor-show-hand-skeleton";
const FLASH_ENABLED_STORAGE_KEY = "magic-monitor-flash-enabled";
const FLASH_THRESHOLD_STORAGE_KEY = "magic-monitor-flash-threshold";
const FLASH_TARGET_COLOR_STORAGE_KEY = "magic-monitor-flash-target-color";
const MIRROR_STORAGE_KEY = "magic-monitor-mirror";

export function CameraStage() {
	const videoRef = useRef<HTMLVideoElement>(null);
	const containerRef = useRef<HTMLDivElement>(null);
	const canvasRef = useRef<HTMLCanvasElement>(null);

	// Zoom/Pan State
	const [zoom, setZoom] = useState(1);
	const [pan, setPan] = useState({ x: 0, y: 0 });
	const [isDragging, setIsDragging] = useState(false);
	const [lastMousePos, setLastMousePos] = useState({ x: 0, y: 0 });

	// Mobile Detection
	const { isMobile, isLowMemory } = useMobileDetection();

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

	// HQ Mode State (persisted to localStorage)
	const [isHQ, setIsHQInternal] = useState(() => {
		const stored = DeviceService.getStorageItem(HQ_STORAGE_KEY);
		if (stored !== null) return stored === "true";
		return false; // Default off, will enable on desktop after detection if no stored preference
	});
	const [hqInitialized, setHqInitialized] = useState(() => {
		// If we have a stored preference, consider it already initialized
		return DeviceService.getStorageItem(HQ_STORAGE_KEY) !== null;
	});

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

	const setIsHQ = useCallback((value: boolean) => {
		setIsHQInternal(value);
		DeviceService.setStorageItem(HQ_STORAGE_KEY, String(value));
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

	// Initialize HQ based on device detection (once, only if no stored preference)
	useEffect(() => {
		if (!hqInitialized) {
			setIsHQ(!isLowMemory);
			setHqInitialized(true);
		}
	}, [hqInitialized, isLowMemory, setIsHQ]);

	// HQ toggle with mobile warning
	const handleHQToggle = useCallback(() => {
		if (!isHQ && isLowMemory) {
			const proceed = window.confirm(
				isMobile
					? "High Quality mode uses ~3.5GB RAM and may crash your mobile device. Continue anyway?"
					: "High Quality mode uses ~3.5GB RAM. Your device has limited memory. Continue anyway?",
			);
			if (!proceed) return;
		}
		setIsHQ(!isHQ);
	}, [isHQ, isLowMemory, isMobile, setIsHQ]);

	// Helper to clamp NORMALIZED pan values (resolution-independent)
	// See docs/SMART_ZOOM_SPEC.md: maxPan = (1 - 1/zoom) / 2
	const clampPan = useCallback((p: { x: number; y: number }, z: number) => {
		const maxPan = (1 - 1 / z) / 2;
		return {
			x: Math.max(-maxPan, Math.min(maxPan, p.x)),
			y: Math.max(-maxPan, Math.min(maxPan, p.y)),
		};
	}, []);

	// Helper to build video/canvas transform string
	// Combines mirror, zoom, and pan transforms
	const getVideoTransform = useCallback(() => {
		const mirrorTransform = isMirror ? "scaleX(-1) " : "";
		return `${mirrorTransform}scale(${zoom}) translate(${(pan.x * 100).toFixed(2)}%, ${(pan.y * 100).toFixed(2)}%)`;
	}, [isMirror, zoom, pan]);

	// Smart Zoom
	const smartZoom = useSmartZoom({
		videoRef,
		enabled: isSmartZoom,
		smoothingPreset,
	});

	// Effect to apply smart zoom values
	// Note: SmartZoom already clamps pan correctly via clampPanToViewport - don't re-clamp
	useEffect(() => {
		if (isSmartZoom) {
			setZoom(smartZoom.zoom);
			setPan(smartZoom.pan);
		}
	}, [isSmartZoom, smartZoom.zoom, smartZoom.pan]);

	// Time Machine State
	// We always enable recording in the background for "Instant Replay" capability
	const timeMachine = useTimeMachine({
		videoRef,
		enabled: true,
		bufferSeconds: 60,
		fps: isHQ ? 30 : 15,
		quality: isHQ ? 0.5 : 0.35,
	});

	const isFlashing = useFlashDetector({
		videoRef,
		enabled: flashEnabled,
		targetColor,
		threshold,
	});

	// Camera State via Humble Object Hook
	const { stream, error, devices, selectedDeviceId, setSelectedDeviceId } =
		useCamera();

	// Version check for updates
	const {
		updateAvailable,
		reload: reloadForUpdate,
		checkForUpdate,
		isChecking: isCheckingUpdate,
		lastCheckTime,
	} = useVersionCheck();

	// Sync stream to video element
	useEffect(() => {
		if (videoRef.current) {
			videoRef.current.srcObject = stream;
		}
	}, [stream]);

	// Render replay frame to canvas
	useEffect(() => {
		if (timeMachine.isReplaying && timeMachine.frame && canvasRef.current) {
			const ctx = canvasRef.current.getContext("2d");
			if (ctx) {
				canvasRef.current.width = timeMachine.frame.width;
				canvasRef.current.height = timeMachine.frame.height;
				ctx.drawImage(timeMachine.frame, 0, 0);
			}
		}
	}, [timeMachine.frame, timeMachine.isReplaying]);

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

			{/* GitHub Link */}
			<a
				href="https://github.com/idvorkin/magic-monitor"
				target="_blank"
				rel="noopener noreferrer"
				className="absolute top-4 left-4 z-50 text-white/30 hover:text-white transition-colors"
				title="View Source on GitHub"
			>
				<Github size={24} />
			</a>

			<SettingsModal
				isOpen={isSettingsOpen}
				onClose={() => setIsSettingsOpen(false)}
				devices={devices}
				selectedDeviceId={selectedDeviceId}
				onDeviceChange={setSelectedDeviceId}
				isMirror={isMirror}
				onMirrorChange={setIsMirror}
				isHQ={isHQ}
				onHQChange={setIsHQ}
				isLowMemory={isLowMemory}
				isMobile={isMobile}
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
				zoom={zoom}
				pan={pan}
				frame={timeMachine.isReplaying ? timeMachine.frame : null}
				onPanTo={handlePanTo}
			/>

			{/* Status Bar */}
			<div className="absolute bottom-8 right-8 z-40 text-white/50 font-mono text-xs pointer-events-none flex flex-col items-end gap-1">
				{smartZoom.isModelLoading && (
					<span className="text-blue-400 animate-pulse">
						Loading AI model...
					</span>
				)}
				<span>RAM: {timeMachine.memoryUsageMB} MB</span>
			</div>

			{error && (
				<div className="absolute inset-0 flex items-center justify-center z-50 bg-black/80 text-red-500">
					<p className="text-xl font-bold">{error}</p>
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

			{/* Replay Canvas */}
			<canvas
				ref={canvasRef}
				className={`max-w-full max-h-full object-contain transition-transform duration-75 ease-out ${timeMachine.isReplaying ? "block" : "hidden"}`}
				style={{
					transform: getVideoTransform(),
				}}
			/>

			{/* Controls Overlay */}
			<div
				className={`absolute left-1/2 -translate-x-1/2 flex flex-col gap-4 items-center z-50 w-full max-w-4xl ${isMobile ? "bottom-0 px-0" : "bottom-8 px-4"}`}
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

							<input
								type="range"
								min="0"
								max={timeMachine.totalTime || 1}
								step="0.1"
								value={timeMachine.currentTime}
								onChange={(e) =>
									timeMachine.seek(Number.parseFloat(e.target.value))
								}
								className={`flex-1 min-w-[50px] accent-blue-400 rounded-full bg-blue-950 ${isMobile ? "h-1.5" : "h-2"}`}
							/>
							<span
								className={`text-right font-mono flex-shrink-0 ${isMobile ? "w-8 text-[10px]" : "w-16 text-sm"}`}
							>
								{timeMachine.currentTime.toFixed(0)}s
							</span>

							{/* Filmstrip toggle button */}
							<button
								onClick={() => setExpandFilmstrip(!expandFilmstrip)}
								className={`flex-shrink-0 hover:text-blue-300 transition-colors ${isMobile ? "text-sm" : "text-xl"}`}
								title={expandFilmstrip ? "Hide timeline" : "Show timeline"}
							>
								{expandFilmstrip ? "▼" : "▲"}
							</button>
						</div>

						{/* Collapsible Filmstrip */}
						<div
							className={`transition-all duration-300 overflow-hidden w-full ${
								expandFilmstrip ? "max-h-40 opacity-100" : "max-h-0 opacity-0"
							}`}
						>
							<div className="flex gap-2 overflow-x-auto w-full pb-2 px-2 snap-x bg-black/40 backdrop-blur-sm rounded-xl p-2 border border-white/10">
								{timeMachine.getThumbnails(10).map((thumb) => (
									<Thumbnail
										key={thumb.time}
										frame={thumb.frame}
										label={`${thumb.time.toFixed(1)}s`}
										onClick={() => timeMachine.seek(thumb.time)}
										isActive={
											Math.abs(timeMachine.currentTime - thumb.time) < 1
										}
									/>
								))}
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
						<button
							onClick={() => setIsSmartZoom(!isSmartZoom)}
							disabled={smartZoom.isModelLoading}
							className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
								isSmartZoom && !smartZoom.isModelLoading
									? "bg-green-600 text-white"
									: "bg-white/10 text-white/50 hover:bg-white/20 hover:text-white"
							} ${smartZoom.isModelLoading ? "cursor-wait" : ""}`}
							title="Smart Zoom - Auto-follow movement"
						>
							{smartZoom.isModelLoading
								? "Loading..."
								: isSmartZoom
									? "Smart ✓"
									: "Smart"}
						</button>

						<button
							onClick={() => setFlashEnabled(!flashEnabled)}
							className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
								flashEnabled
									? "bg-red-600 text-white"
									: "bg-white/10 text-white/50 hover:bg-white/20 hover:text-white"
							}`}
							title="Flash Detection"
						>
							{flashEnabled ? "⚡ ARMED" : "⚡ Flash"}
						</button>

						<button
							onClick={handleHQToggle}
							className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
								isHQ
									? "bg-purple-600 text-white"
									: isLowMemory
										? "bg-orange-600/50 text-orange-200 hover:bg-orange-600/70"
										: "bg-white/10 text-white/50 hover:bg-white/20 hover:text-white"
							}`}
							title={
								isLowMemory
									? "High Quality Mode (~3.5GB RAM) - Warning: May crash on this device"
									: "High Quality Mode (~3.5GB RAM)"
							}
						>
							{isLowMemory && !isHQ ? "⚠️ HQ" : "HQ"}
						</button>

						{/* Zoom Controls - hidden on mobile (no mouse wheel) */}
						{!isMobile && (
							<>
								<div className="h-6 w-px bg-white/20" />
								<button
									onClick={() => {
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
									value={zoom}
									onChange={(e) => {
										const newZoom = Number.parseFloat(e.target.value);
										setZoom(newZoom);
										setPan((prev) => clampPan(prev, newZoom));
									}}
									className="w-32 accent-blue-500"
								/>
								<span className="text-white font-mono w-12 text-right">
									{zoom.toFixed(1)}x
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

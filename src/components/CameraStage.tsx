import clsx from "clsx";
import { Settings } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useBugReporter } from "../hooks/useBugReporter";
import { useCamera } from "../hooks/useCamera";
import { useCardDetection } from "../hooks/useCardDetection";
import { useEscapeKey } from "../hooks/useEscapeKey";
import { useFlashDetector } from "../hooks/useFlashDetector";
import { useMobileDetection } from "../hooks/useMobileDetection";
import { useRecorderDebugInfo } from "../hooks/useRecorderDebugInfo";
import { useReplayPlayer } from "../hooks/useReplayPlayer";
import { useSessionRecorder } from "../hooks/useSessionRecorder";
import { useSettings } from "../hooks/useSettings";
import { useShakeDetector } from "../hooks/useShakeDetector";
import { useSmartZoom } from "../hooks/useSmartZoom";
import { useVersionCheck } from "../hooks/useVersionCheck";
import { useZoomPan } from "../hooks/useZoomPan";
import { CardDetectorService } from "../services/CardDetectorService";
import type { AppState } from "../types/sessions";
import { AboutModal } from "./AboutModal";
import { BugReportModal } from "./BugReportModal";
import { CardList } from "./CardList";
import { CardOverlay } from "./CardOverlay";
import { DetectPerfOverlay } from "./DetectPerfOverlay";
import { EdgeIndicator } from "./EdgeIndicator";
import { ErrorOverlay } from "./ErrorOverlay";
import { HandSkeleton } from "./HandSkeleton";
import { Minimap } from "./Minimap";
import { ReplayView } from "./ReplayView";
import { SessionPicker } from "./SessionPicker";
import { SettingsModal } from "./SettingsModal";
import { SmartZoomToggle } from "./SmartZoomToggle";
import { StatusButton } from "./StatusButton";

export function CameraStage() {
	const videoRef = useRef<HTMLVideoElement>(null);
	const containerRef = useRef<HTMLDivElement>(null);

	// Video dimensions (for About dialog)
	const [videoDimensions, setVideoDimensions] = useState<{
		width: number;
		height: number;
	} | null>(null);

	// Mobile Detection
	const { isMobile } = useMobileDetection();

	// App state: live (recording), picker (viewing sessions), replay (playing back)
	const [appState, setAppState] = useState<AppState>("live");

	// Recording pause state
	const [isRecordingPaused, setIsRecordingPaused] = useState(false);

	// Settings (persisted to localStorage)
	const { settings, setters } = useSettings();
	const {
		flashEnabled,
		targetColor,
		threshold,
		isSmartZoom,
		showHandSkeleton,
		smoothingPreset,
		isMirror,
		cardDetectionEnabled,
		cardConfidenceThreshold,
		cardShowBoxes,
		cardShowList,
	} = settings;
	const {
		setFlashEnabled,
		setTargetColor,
		setThreshold,
		setIsSmartZoom,
		setShowHandSkeleton,
		setSmoothingPreset,
		setIsMirror,
		setCardDetectionEnabled,
		setCardConfidenceThreshold,
		setCardShowBoxes,
		setCardShowList,
	} = setters;

	// UI state
	const [isPickingColor, setIsPickingColor] = useState(false);
	const [isSettingsOpen, setIsSettingsOpen] = useState(false);
	const [isAboutOpen, setIsAboutOpen] = useState(false);

	// Stable callbacks for modal close handlers
	// These must be stable to prevent useFocusTrap from re-running and stealing focus
	const handleCloseSettings = useCallback(() => setIsSettingsOpen(false), []);
	const handleCloseAbout = useCallback(() => setIsAboutOpen(false), []);

	// Manual zoom/pan callback - disables smart zoom when user manually zooms
	// Wrapped in useCallback to prevent effect re-runs in useZoomPan
	const handleManualZoom = useCallback(() => {
		if (isSmartZoom) setIsSmartZoom(false);
	}, [isSmartZoom, setIsSmartZoom]);

	// Zoom/Pan State and Handlers
	const zoomPan = useZoomPan({
		videoRef,
		containerRef,
		onZoomChange: handleManualZoom,
	});
	const {
		zoom,
		pan,
		handleWheel,
		handleMouseDown,
		handleMouseMove,
		handleMouseUp,
		resetZoom,
		setZoom,
		setPan,
	} = zoomPan;

	// Smart Zoom
	const smartZoom = useSmartZoom({
		videoRef,
		enabled: isSmartZoom,
		smoothingPreset,
	});

	// Card Detection
	const cardDetection = useCardDetection({
		videoRef,
		enabled: cardDetectionEnabled,
		confidenceThreshold: cardConfidenceThreshold,
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

	// Session Recording (5-minute blocks with thumbnails)
	const sessionRecorder = useSessionRecorder({
		videoRef,
		enabled: appState === "live" && !isRecordingPaused,
	});
	// Destructure stable callbacks to avoid render loops in dependency arrays
	const { stopCurrentBlock, isRecording } = sessionRecorder;

	// Replay Player
	const replayPlayer = useReplayPlayer();
	// Destructure stable callbacks to avoid render loops in dependency arrays
	const {
		loadSession,
		seek: seekReplay,
		unloadSession,
		session: replaySession,
	} = replayPlayer;

	const isFlashing = useFlashDetector({
		videoRef,
		enabled: flashEnabled,
		targetColor,
		threshold,
	});

	// Camera State via Humble Object Hook
	const {
		stream,
		error,
		devices,
		selectedDeviceId,
		setSelectedDeviceId,
		resolution,
		setResolution,
		orientation,
		setOrientation,
		retry,
	} = useCamera();

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

	// Debug Info for MediaRecorder troubleshooting
	const recorderDebugInfo = useRecorderDebugInfo();

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

	// Keyboard shortcuts
	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			// Ctrl/Cmd+I: bug report
			if ((e.ctrlKey || e.metaKey) && e.key === "i") {
				e.preventDefault();
				bugReporter.open();
			}
			// Z: card detection debug snapshot
			if (e.key === "z" && !e.ctrlKey && !e.metaKey && !e.altKey) {
				if (CardDetectorService.isReady()) {
					CardDetectorService.debugSnapshot();
				}
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

	// Update video dimensions when metadata loads (called via onLoadedMetadata prop)
	const handleVideoMetadataLoaded = useCallback(
		(e: React.SyntheticEvent<HTMLVideoElement>) => {
			const video = e.currentTarget;
			if (video.videoWidth && video.videoHeight) {
				setVideoDimensions({
					width: video.videoWidth,
					height: video.videoHeight,
				});
			}
		},
		[],
	);

	// App state transitions
	const handleOpenPicker = useCallback(async () => {
		// Stop any active recording so it appears in the session list
		if (isRecording) {
			await stopCurrentBlock({ disable: true });
		}
		setAppState("picker");
	}, [isRecording, stopCurrentBlock]);

	const handleClosePicker = useCallback(() => {
		// If we have an active session, return to replay; otherwise go to live
		if (replaySession) {
			setAppState("replay");
		} else {
			setAppState("live");
		}
	}, [replaySession]);

	const handleSelectSession = useCallback(
		async (sessionId: string, startTime?: number) => {
			try {
				await loadSession(sessionId);
				if (startTime !== undefined) {
					seekReplay(startTime);
				}
				setAppState("replay");
			} catch (err) {
				console.error("Failed to load session:", err);
				// Stay in current state, don't transition to replay
			}
		},
		[loadSession, seekReplay],
	);

	const handleExitReplay = useCallback(() => {
		unloadSession();
		setAppState("live");
	}, [unloadSession]);

	const handleSessionsFromReplay = useCallback(() => {
		// Go to picker without unloading the session (so it shows as active)
		setAppState("picker");
	}, []);

	// Escape key handler
	useEscapeKey({
		isSettingsOpen,
		isPickingColor,
		isReplaying: appState === "replay",
		onCloseSettings: () => setIsSettingsOpen(false),
		onCancelColorPick: () => setIsPickingColor(false),
		onExitReplay: handleExitReplay,
	});

	// Color picker for flash detection
	const pickColor = useCallback(
		(x: number, y: number) => {
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
			// willReadFrequently: true for pixel sampling operations
			const ctx = canvas.getContext("2d", { willReadFrequently: true });
			if (!ctx) return;

			ctx.drawImage(video, 0, 0);
			const pixel = ctx.getImageData(videoX, videoY, 1, 1).data;

			setTargetColor({ r: pixel[0], g: pixel[1], b: pixel[2] });
			setIsPickingColor(false);
			setFlashEnabled(true);
		},
		[setTargetColor, setFlashEnabled],
	);

	// Wrap zoom/pan handleMouseDown to support color picking
	const handleMouseDownWithColorPicking = useCallback(
		(e: React.MouseEvent) => {
			if (isPickingColor) {
				pickColor(e.clientX, e.clientY);
				return;
			}
			handleMouseDown(e);
		},
		[isPickingColor, pickColor, handleMouseDown],
	);

	const handlePanTo = useCallback(
		(target: { x: number; y: number }) => {
			setPan(target);
		},
		[setPan],
	);

	return (
		<div
			ref={containerRef}
			className={clsx(
				"relative w-full h-full bg-black overflow-hidden flex items-center justify-center",
				isPickingColor ? "cursor-crosshair" : "cursor-move",
			)}
			onWheel={handleWheel}
			onMouseDown={handleMouseDownWithColorPicking}
			onMouseMove={handleMouseMove}
			onMouseUp={handleMouseUp}
			onMouseLeave={handleMouseUp}
		>
			{/* Flash Warning Overlay */}
			<div
				className={clsx(
					"absolute inset-0 border-[20px] border-red-600 z-40 pointer-events-none transition-opacity duration-100",
					isFlashing ? "opacity-100" : "opacity-0",
				)}
			/>

			{/* Pan Boundary Debug Overlay (see docs/SMART_ZOOM_SPEC.md) */}
			{isSmartZoom && (
				<>
					<EdgeIndicator edge="left" visible={smartZoom.clampedEdges.left} />
					<EdgeIndicator edge="right" visible={smartZoom.clampedEdges.right} />
					<EdgeIndicator edge="top" visible={smartZoom.clampedEdges.top} />
					<EdgeIndicator
						edge="bottom"
						visible={smartZoom.clampedEdges.bottom}
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
				onClose={handleCloseSettings}
				devices={devices}
				selectedDeviceId={selectedDeviceId}
				onDeviceChange={setSelectedDeviceId}
				resolution={resolution}
				onResolutionChange={setResolution}
				orientation={orientation}
				onOrientationChange={setOrientation}
				videoWidth={videoDimensions?.width}
				videoHeight={videoDimensions?.height}
				isMirror={isMirror}
				onMirrorChange={setIsMirror}
				isSmartZoom={isSmartZoom}
				isModelLoading={smartZoom.isModelLoading}
				smartZoomModelError={smartZoom.modelError}
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
				cardDetectionEnabled={cardDetectionEnabled}
				cardModelLoading={cardDetection.isModelLoading}
				cardModelError={cardDetection.modelError}
				onCardDetectionChange={setCardDetectionEnabled}
				cardConfidenceThreshold={cardConfidenceThreshold}
				onCardConfidenceChange={setCardConfidenceThreshold}
				cardShowBoxes={cardShowBoxes}
				onCardShowBoxesChange={setCardShowBoxes}
				cardShowList={cardShowList}
				onCardShowListChange={setCardShowList}
				shakeEnabled={bugReporter.shakeEnabled}
				onShakeEnabledChange={bugReporter.setShakeEnabled}
				isShakeSupported={isShakeSupported}
				onOpenAbout={() => setIsAboutOpen(true)}
				debugInfo={recorderDebugInfo}
				recordingError={sessionRecorder.error}
			/>

			<AboutModal
				isOpen={isAboutOpen}
				onClose={handleCloseAbout}
				githubRepoUrl={bugReporter.githubRepoUrl}
				onReportBug={bugReporter.open}
				bugReportShortcut={bugReportShortcut}
			/>

			{/* Session Picker Modal */}
			<SessionPicker
				isOpen={appState === "picker"}
				onClose={handleClosePicker}
				onSelectSession={handleSelectSession}
				recentSessions={sessionRecorder.recentSessions}
				savedSessions={sessionRecorder.savedSessions}
				onRefresh={sessionRecorder.refreshSessions}
				activeSessionId={replayPlayer.session?.id}
			/>

			{/* Minimap (Only when zoomed, hidden in replay mode since ReplayView has its own) */}
			{appState === "live" && (
				<Minimap
					stream={stream}
					zoom={effectiveZoom}
					pan={effectivePan}
					frame={null}
					onPanTo={handlePanTo}
					isMirror={isMirror}
				/>
			)}

			{/* Status Bar */}
			<div className="absolute bottom-8 right-8 z-40 text-white/50 font-mono text-xs pointer-events-none flex flex-col items-end gap-1">
				{smartZoom.isModelLoading && (
					<span className="text-blue-400 animate-pulse">
						Loading AI model...
					</span>
				)}
				{sessionRecorder.error ? (
					<span className="text-red-400">{sessionRecorder.error}</span>
				) : appState === "live" ? (
					<span>
						{isRecordingPaused ? (
							<span className="text-yellow-400 mr-2">⏸ PAUSED</span>
						) : sessionRecorder.isRecording ? (
							<span className="text-red-400 mr-2">● REC</span>
						) : sessionRecorder.notRecordingReason === "starting" ? (
							<span className="text-gray-400 mr-2">◌ starting…</span>
						) : sessionRecorder.notRecordingReason ? (
							<span className="text-amber-400 font-bold text-sm mr-2">
								⚠ NOT RECORDING (
								{sessionRecorder.notRecordingReason === "storage-error"
									? "storage failing"
									: "recorder failing"}
								)
							</span>
						) : null}
						{Math.floor(sessionRecorder.currentBlockDuration)}s |{" "}
						{sessionRecorder.recentSessions.length +
							sessionRecorder.savedSessions.length}{" "}
						sessions
					</span>
				) : null}
			</div>

			{error && (
				<ErrorOverlay
					message={error}
					onAction={retry}
					actionLabel="Try Again"
					helpText="If camera access was denied, you may need to enable it in your browser settings:"
					tips={[
						"<strong>iOS Safari:</strong> Settings → Safari → Camera → Allow",
						"<strong>Chrome/Edge:</strong> Click the lock icon in the address bar → Camera → Allow",
						"<strong>Firefox:</strong> Click the lock icon → Connection secure → More information → Permissions",
					]}
					zIndex={50}
				/>
			)}

			{/* Live Video */}
			<video
				data-testid="main-video"
				ref={videoRef}
				autoPlay
				playsInline
				muted
				onLoadedMetadata={handleVideoMetadataLoaded}
				className={clsx(
					"w-full h-full object-contain transition-transform duration-75 ease-out",
					appState === "replay" ? "hidden" : "block",
				)}
				style={{
					// See docs/SMART_ZOOM_SPEC.md for transform details
					transform: getVideoTransform(),
				}}
			/>

			{/* Hand Skeleton Debug Overlay */}
			{showHandSkeleton && isSmartZoom && appState === "live" && (
				<>
					<HandSkeleton
						landmarksRef={smartZoom.debugLandmarksRef}
						videoRef={videoRef}
						isMirror={isMirror}
					/>
					<DetectPerfOverlay
						detectTimeMsRef={smartZoom.detectTimeMsRef}
						videoRef={videoRef}
						processingResRef={smartZoom.processingResRef}
					/>
				</>
			)}

			{/* Card Detection Overlays */}
			{cardDetectionEnabled && appState === "live" && (
				<>
					{cardShowBoxes && (
						<CardOverlay
							detectionsRef={cardDetection.detectionsRef}
							videoRef={videoRef}
							isMirror={isMirror}
						/>
					)}
					{cardShowList && <CardList detections={cardDetection.detections} />}
				</>
			)}

			{/* Replay View */}
			{appState === "replay" && (
				<ReplayView
					player={replayPlayer}
					onExit={handleExitReplay}
					onSessionsClick={handleSessionsFromReplay}
					isMobile={isMobile}
					smoothingPreset={smoothingPreset}
				/>
			)}

			{/* Controls Overlay (shown only in live mode) */}
			{appState === "live" && (
				<div
					className={clsx(
						"absolute left-1/2 -translate-x-1/2 flex flex-col gap-4 items-center z-50 w-full max-w-4xl",
						isMobile ? "bottom-3 px-0" : "bottom-12 px-4",
					)}
				>
					<div className="bg-black/50 backdrop-blur-md p-3 rounded-2xl flex items-center gap-3">
						{/* Sessions Button */}
						<button
							onClick={handleOpenPicker}
							className="px-3 py-1.5 rounded-lg text-xs font-bold bg-blue-600 text-white hover:bg-blue-500 flex items-center gap-1.5"
						>
							<span>📹</span> Sessions
						</button>

						{/* Pause/Resume Recording Button */}
						<button
							onClick={() => setIsRecordingPaused(!isRecordingPaused)}
							className={clsx(
								"px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5",
								isRecordingPaused
									? "bg-yellow-600 text-white hover:bg-yellow-500"
									: "bg-gray-700 text-white hover:bg-gray-600",
							)}
							title={isRecordingPaused ? "Resume recording" : "Pause recording"}
						>
							{isRecordingPaused ? (
								<>
									<span>▶</span> Resume
								</>
							) : (
								<>
									<span>⏸</span> Pause
								</>
							)}
						</button>

						<div className="h-6 w-px bg-white/20" />

						{/* Status Toggles */}
						<SmartZoomToggle
							isSmartZoom={isSmartZoom}
							onSmartZoomChange={setIsSmartZoom}
							isModelLoading={smartZoom.isModelLoading}
							loadingProgress={smartZoom.loadingProgress}
							loadingPhase={smartZoom.loadingPhase}
							modelError={smartZoom.modelError}
						/>

						<StatusButton
							onClick={() => setCardDetectionEnabled(!cardDetectionEnabled)}
							active={cardDetectionEnabled}
							color="purple"
							title="Card Detection"
						>
							{cardDetection.isModelLoading
								? "🃏 Loading..."
								: cardDetection.modelError || cardDetection.detectError
									? "🃏 Cards ERR"
									: cardDetectionEnabled
										? "🃏 Cards ON"
										: "🃏 Cards"}
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
									onClick={resetZoom}
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
										setZoom(newZoom);
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
							aria-label="Settings"
						>
							<Settings size={18} />
						</button>
					</div>
				</div>
			)}
		</div>
	);
}

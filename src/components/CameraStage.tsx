import { Github, Settings } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useCamera } from "../hooks/useCamera";
import { useEscapeKey } from "../hooks/useEscapeKey";
import { useFlashDetector } from "../hooks/useFlashDetector";
import { useSmartZoom } from "../hooks/useSmartZoom";
import { useTimeMachine } from "../hooks/useTimeMachine";
import { Minimap } from "./Minimap";
import { SettingsModal } from "./SettingsModal";
import { Thumbnail } from "./Thumbnail";

export function CameraStage() {
	const videoRef = useRef<HTMLVideoElement>(null);
	const containerRef = useRef<HTMLDivElement>(null);
	const canvasRef = useRef<HTMLCanvasElement>(null);

	// Zoom/Pan State
	const [zoom, setZoom] = useState(1);
	const [pan, setPan] = useState({ x: 0, y: 0 });
	const [isDragging, setIsDragging] = useState(false);
	const [lastMousePos, setLastMousePos] = useState({ x: 0, y: 0 });

	// Flash Detection State
	const [flashEnabled, setFlashEnabled] = useState(false);
	const [targetColor, setTargetColor] = useState<{
		r: number;
		g: number;
		b: number;
	} | null>(null);
	const [threshold, setThreshold] = useState(20);
	const [isPickingColor, setIsPickingColor] = useState(false);
	const [isHQ, setIsHQ] = useState(true);
	const [isSmartZoom, setIsSmartZoom] = useState(true);
	const [isSettingsOpen, setIsSettingsOpen] = useState(false);

	// Helper to clamp pan values
	const clampPan = useCallback((p: { x: number; y: number }, z: number) => {
		const maxPanX = (videoRef.current?.videoWidth || 0) * 0.5 * (z - 1);
		const maxPanY = (videoRef.current?.videoHeight || 0) * 0.5 * (z - 1);
		return {
			x: Math.max(-maxPanX, Math.min(maxPanX, p.x)),
			y: Math.max(-maxPanY, Math.min(maxPanY, p.y)),
		};
	}, []);

	// Smart Zoom
	const smartZoom = useSmartZoom({
		videoRef,
		enabled: isSmartZoom,
		smoothFactor: 0.05,
	});

	// Effect to apply smart zoom values
	useEffect(() => {
		if (isSmartZoom) {
			setZoom(smartZoom.zoom);
			// Apply clamping to smart zoom output too
			setPan(clampPan(smartZoom.pan, smartZoom.zoom));
		}
	}, [isSmartZoom, smartZoom.zoom, smartZoom.pan, clampPan]);

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

			const proposedPan = {
				x: pan.x + dx / zoom,
				y: pan.y + dy / zoom,
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
				isHQ={isHQ}
				onHQChange={setIsHQ}
				isSmartZoom={isSmartZoom}
				isModelLoading={smartZoom.isModelLoading}
				onSmartZoomChange={setIsSmartZoom}
				flashEnabled={flashEnabled}
				onFlashEnabledChange={setFlashEnabled}
				threshold={threshold}
				onThresholdChange={setThreshold}
				isPickingColor={isPickingColor}
				onPickColorClick={() => setIsPickingColor(true)}
				targetColor={targetColor}
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
					transform: `scale(${zoom}) translate(${pan.x}px, ${pan.y}px)`,
				}}
			/>

			{/* Replay Canvas */}
			<canvas
				ref={canvasRef}
				className={`max-w-full max-h-full object-contain transition-transform duration-75 ease-out ${timeMachine.isReplaying ? "block" : "hidden"}`}
				style={{
					transform: `scale(${zoom}) translate(${pan.x}px, ${pan.y}px)`,
				}}
			/>

			{/* Controls Overlay */}
			<div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col gap-4 items-center z-50 w-full max-w-4xl px-4">
				{/* Replay Controls (when replaying) */}
				{timeMachine.isReplaying && (
					<div className="flex flex-col gap-2 w-full items-center">
						<div className="bg-blue-900/80 backdrop-blur-md p-4 rounded-2xl flex items-center gap-4 w-full justify-center border border-blue-400 shadow-lg shadow-blue-900/50">
							<button
								onClick={timeMachine.exitReplay}
								className="px-4 py-1 rounded font-bold bg-white/20 text-white hover:bg-white/30"
							>
								EXIT REPLAY
							</button>

							<div className="h-8 w-px bg-white/20 mx-2" />

							<button
								onClick={
									timeMachine.isPlaying ? timeMachine.pause : timeMachine.play
								}
								className="text-2xl w-10 h-10 flex items-center justify-center rounded-full hover:bg-white/10"
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
								className="flex-1 accent-blue-400 h-2 rounded-full bg-blue-950"
							/>
							<span className="w-16 text-right font-mono text-sm">
								{timeMachine.currentTime.toFixed(1)}s /{" "}
								{timeMachine.totalTime.toFixed(1)}s
							</span>
						</div>

						{/* Filmstrip */}
						<div className="flex gap-2 overflow-x-auto w-full pb-2 px-2 snap-x bg-black/40 backdrop-blur-sm rounded-xl p-2 border border-white/10">
							{timeMachine.getThumbnails(10).map((thumb) => (
								<Thumbnail
									key={thumb.time}
									frame={thumb.frame}
									label={`${thumb.time.toFixed(1)}s`}
									onClick={() => timeMachine.seek(thumb.time)}
									isActive={Math.abs(timeMachine.currentTime - thumb.time) < 1}
								/>
							))}
						</div>
					</div>
				)}

				{/* Main Controls Bar (Always Visible) */}
				<div className="bg-black/50 backdrop-blur-md p-3 rounded-2xl flex items-center gap-3">
					{/* Rewind Button (only when not replaying) */}
					{!timeMachine.isReplaying && (
						<>
							<button
								onClick={timeMachine.enterReplay}
								className="px-3 py-1.5 rounded-lg text-xs font-bold bg-blue-600 text-white hover:bg-blue-500 flex items-center gap-1.5"
							>
								<span>⏪</span> Rewind
							</button>
							<div className="h-6 w-px bg-white/20" />
						</>
					)}

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
						onClick={() => setIsHQ(!isHQ)}
						className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
							isHQ
								? "bg-purple-600 text-white"
								: "bg-white/10 text-white/50 hover:bg-white/20 hover:text-white"
						}`}
						title="High Quality Mode (~3.5GB RAM)"
					>
						HQ
					</button>

					<div className="h-6 w-px bg-white/20" />

					{/* Zoom Controls */}
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

					{/* Settings */}
					<button
						onClick={() => setIsSettingsOpen(true)}
						className="p-1.5 rounded-lg text-white/50 hover:text-white hover:bg-white/10 transition-colors"
						title="Settings"
					>
						<Settings size={18} />
					</button>
				</div>
			</div>
		</div>
	);
}

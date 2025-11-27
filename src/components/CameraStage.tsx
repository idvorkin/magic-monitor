import { useCallback, useEffect, useRef, useState } from "react";
import { useCamera } from "../hooks/useCamera";
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
	const [isHQ, setIsHQ] = useState(false);
	const [isSmartZoom, setIsSmartZoom] = useState(false);
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
				<svg
					viewBox="0 0 24 24"
					width="24"
					height="24"
					stroke="currentColor"
					strokeWidth="2"
					fill="none"
					strokeLinecap="round"
					strokeLinejoin="round"
				>
					<path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"></path>
				</svg>
			</a>

			{/* Settings Cog */}
			<button
				onClick={() => setIsSettingsOpen(true)}
				className="absolute top-4 right-4 z-50 text-white/50 hover:text-white transition-colors p-2 rounded-full hover:bg-white/10"
				title="Settings"
			>
				<svg
					className="w-8 h-8"
					fill="none"
					stroke="currentColor"
					viewBox="0 0 24 24"
				>
					<path
						strokeLinecap="round"
						strokeLinejoin="round"
						strokeWidth={2}
						d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
					/>
					<path
						strokeLinecap="round"
						strokeLinejoin="round"
						strokeWidth={2}
						d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
					/>
				</svg>
			</button>

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

			{/* RAM Monitor */}
			<div className="absolute bottom-8 right-8 z-40 text-white/50 font-mono text-xs pointer-events-none">
				RAM: {timeMachine.memoryUsageMB} MB
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
				{/* Replay Controls */}
				{timeMachine.isReplaying ? (
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
				) : (
					/* Live Controls */
					<div className="bg-black/60 backdrop-blur-md p-4 rounded-2xl flex items-center gap-4 w-full justify-center border border-white/10">
						<button
							onClick={timeMachine.enterReplay}
							className="px-4 py-2 rounded-lg font-bold bg-blue-600 text-white hover:bg-blue-500 flex items-center gap-2"
						>
							<span>⏪</span> REWIND
						</button>
					</div>
				)}

				{/* Zoom Controls (Always Visible) */}
				<div className="bg-black/50 backdrop-blur-md p-4 rounded-full flex items-center gap-4">
					<button
						onClick={() => {
							setZoom(1);
							setPan({ x: 0, y: 0 });
						}}
						className="text-white font-bold px-3 py-1 rounded hover:bg-white/20 text-sm"
					>
						Reset Zoom
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
						className="w-48 accent-blue-500"
					/>
					<span className="text-white font-mono w-12 text-right">
						{zoom.toFixed(1)}x
					</span>
				</div>
			</div>
		</div>
	);
}

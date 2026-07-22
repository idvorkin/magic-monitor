import { Bug, ChevronDown, ChevronRight, ExternalLink, Github, Smartphone } from "lucide-react";
import { useState } from "react";
import { useFocusTrap } from "../hooks/useFocusTrap";
import type { RecorderDebugInfo } from "../hooks/useRecorderDebugInfo";
import { RESOLUTION_PRESETS, type Orientation, type Resolution } from "../services/CameraService";
import {
	SMOOTHING_PRESET_DESCRIPTIONS,
	SMOOTHING_PRESET_LABELS,
	type SmoothingPreset,
} from "../smoothing";
import { ToggleSwitch } from "./ToggleSwitch";

interface SettingsModalProps {
	isOpen: boolean;
	onClose: () => void;

	// Camera
	devices: MediaDeviceInfo[];
	selectedDeviceId: string;
	onDeviceChange: (deviceId: string) => void;
	resolution: Resolution;
	onResolutionChange: (resolution: Resolution) => void;
	orientation: Orientation;
	onOrientationChange: (orientation: Orientation) => void;
	videoWidth?: number;
	videoHeight?: number;

	// Display
	isMirror: boolean;
	onMirrorChange: (isMirror: boolean) => void;

	// Smart Zoom
	isSmartZoom: boolean;
	isModelLoading: boolean;
	smartZoomModelError: string | null;
	onSmartZoomChange: (enabled: boolean) => void;
	smoothingPreset: SmoothingPreset;
	onSmoothingPresetChange: (preset: SmoothingPreset) => void;
	showHandSkeleton: boolean;
	onShowHandSkeletonChange: (enabled: boolean) => void;

	// Card Detection
	cardDetectionEnabled: boolean;
	cardModelLoading: boolean;
	cardModelError: string | null;
	onCardDetectionChange: (enabled: boolean) => void;
	cardConfidenceThreshold: number;
	onCardConfidenceChange: (value: number) => void;
	cardShowBoxes: boolean;
	onCardShowBoxesChange: (enabled: boolean) => void;
	cardShowList: boolean;
	onCardShowListChange: (enabled: boolean) => void;

	// Flash
	flashEnabled: boolean;
	onFlashEnabledChange: (enabled: boolean) => void;
	threshold: number;
	onThresholdChange: (threshold: number) => void;
	isPickingColor: boolean;
	onPickColorClick: () => void;
	targetColor: { r: number; g: number; b: number } | null;

	// Updates
	updateAvailable?: boolean;
	isCheckingUpdate?: boolean;
	lastCheckTime?: Date | null;
	onCheckForUpdate?: () => void;
	onReloadForUpdate?: () => void;

	// Shake to Report (mobile)
	shakeEnabled: boolean;
	onShakeEnabledChange: (enabled: boolean) => void;
	isShakeSupported: boolean;

	// About
	onOpenAbout: () => void;

	// Debug
	debugInfo?: RecorderDebugInfo;
	recordingError?: string | null;
}

export function SettingsModal({
	isOpen,
	onClose,
	devices,
	selectedDeviceId,
	onDeviceChange,
	resolution,
	onResolutionChange,
	orientation,
	onOrientationChange,
	videoWidth,
	videoHeight,
	isMirror,
	onMirrorChange,
	isSmartZoom,
	isModelLoading,
	smartZoomModelError,
	onSmartZoomChange,
	smoothingPreset,
	onSmoothingPresetChange,
	showHandSkeleton,
	onShowHandSkeletonChange,
	cardDetectionEnabled,
	cardModelLoading,
	cardModelError,
	onCardDetectionChange,
	cardConfidenceThreshold,
	onCardConfidenceChange,
	cardShowBoxes,
	onCardShowBoxesChange,
	cardShowList,
	onCardShowListChange,
	flashEnabled,
	onFlashEnabledChange,
	threshold,
	onThresholdChange,
	isPickingColor,
	onPickColorClick,
	targetColor,
	updateAvailable,
	isCheckingUpdate,
	lastCheckTime,
	onCheckForUpdate,
	onReloadForUpdate,
	shakeEnabled,
	onShakeEnabledChange,
	isShakeSupported,
	onOpenAbout,
	debugInfo,
	recordingError,
}: SettingsModalProps) {
	const containerRef = useFocusTrap({ isOpen, onClose });
	const [isDebugExpanded, setIsDebugExpanded] = useState(false);

	if (!isOpen) return null;

	return (
		<div
			className="absolute inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm"
			onClick={onClose}
		>
			<div
				ref={containerRef}
				className="bg-gray-900 border border-white/10 p-6 rounded-2xl w-full max-w-md shadow-2xl max-h-[90vh] overflow-y-auto"
				onClick={(e) => e.stopPropagation()}
				onMouseDown={(e) => e.stopPropagation()}
				onMouseMove={(e) => e.stopPropagation()}
				onWheel={(e) => e.stopPropagation()}
			>
				<div className="flex justify-between items-center mb-6">
					<h2 className="text-xl font-bold text-white">Settings</h2>
					<button
				onClick={onClose}
				className="text-white/50 hover:text-white"
				aria-label="Close settings"
			>
						<svg
							className="w-6 h-6"
							fill="none"
							stroke="currentColor"
							viewBox="0 0 24 24"
						>
							<path
								strokeLinecap="round"
								strokeLinejoin="round"
								strokeWidth={2}
								d="M6 18L18 6M6 6l12 12"
							/>
						</svg>
					</button>
				</div>

				<div className="space-y-6">
					{/* Camera Source */}
					<div className="space-y-2">
						<label
							htmlFor="camera-source"
							className="text-sm font-medium text-gray-400"
						>
							Camera Source
						</label>
						<select
							id="camera-source"
							value={selectedDeviceId}
							onChange={(e) => onDeviceChange(e.target.value)}
							className="w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-blue-500"
						>
							{devices.map((device) => (
								<option key={device.deviceId} value={device.deviceId}>
									{device.label || `Camera ${devices.indexOf(device) + 1}`}
								</option>
							))}
						</select>
					</div>

					{/* Resolution */}
					<div className="space-y-2">
						<label
							htmlFor="resolution"
							className="text-sm font-medium text-gray-400"
						>
							Resolution
						</label>
						<div className="flex gap-2">
							<select
								id="resolution"
								value={resolution}
								onChange={(e) => onResolutionChange(e.target.value as Resolution)}
								className="flex-1 bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-blue-500"
							>
								{(Object.keys(RESOLUTION_PRESETS) as Resolution[]).map((res) => {
								const preset = RESOLUTION_PRESETS[res];
								return (
									<option key={res} value={res}>
										{preset.width} wide ({res})
									</option>
								);
							})}
							</select>
							<div className="flex rounded-lg overflow-hidden border border-white/10">
								<button
									type="button"
									onClick={() => onOrientationChange("landscape")}
									className={`px-3 py-2 text-sm font-medium transition-colors ${
										orientation === "landscape"
											? "bg-blue-600 text-white"
											: "bg-black/30 text-gray-400 hover:text-white"
									}`}
									title="Landscape"
								>
									⬜
								</button>
								<button
									type="button"
									onClick={() => onOrientationChange("portrait")}
									className={`px-3 py-2 text-sm font-medium transition-colors ${
										orientation === "portrait"
											? "bg-blue-600 text-white"
											: "bg-black/30 text-gray-400 hover:text-white"
									}`}
									title="Portrait"
								>
									▯
								</button>
							</div>
						</div>
						{videoWidth && videoHeight && (
							<div className="text-xs text-gray-500">
								Actual: {videoWidth}×{videoHeight}
							</div>
						)}
					</div>

					{/* Mirror Video */}
					<div className="flex items-center justify-between">
						<div>
							<div className="text-white font-medium">Mirror Video</div>
							<div className="text-xs text-gray-500">
								Flip video horizontally
							</div>
						</div>
						<ToggleSwitch
							checked={isMirror}
							onChange={onMirrorChange}
							color="blue"
						/>
					</div>

					{/* Smart Zoom */}
					<div className="flex items-center justify-between">
						<div>
							<div className="text-white font-medium">Smart Zoom</div>
							<div className="text-xs text-gray-500">Auto-follow movement</div>
						</div>
						<ToggleSwitch
							checked={isSmartZoom}
							onChange={onSmartZoomChange}
							disabled={isModelLoading}
							color="green"
						/>
					</div>

					{smartZoomModelError && (
						<div className="text-xs text-red-400 bg-red-600/10 border border-red-500/20 rounded-lg p-2">
							Model error: {smartZoomModelError}
						</div>
					)}

					{/* Smoothing Algorithm (shown when Smart Zoom enabled) */}
					{isSmartZoom && (
						<div className="space-y-4 ml-4 border-l-2 border-green-600/30 pl-4">
							<div className="space-y-2">
								<label
									htmlFor="smoothing-preset"
									className="text-sm font-medium text-gray-400"
								>
									Smoothing Algorithm
								</label>
								<select
									id="smoothing-preset"
									value={smoothingPreset}
									onChange={(e) =>
										onSmoothingPresetChange(e.target.value as SmoothingPreset)
									}
									disabled={isModelLoading}
									className="w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-green-500 text-sm disabled:opacity-50"
								>
									{(["ema", "kalmanFast", "kalmanSmooth"] as const).map(
										(preset) => (
											<option key={preset} value={preset}>
												{SMOOTHING_PRESET_LABELS[preset]}
											</option>
										),
									)}
								</select>
								<div className="text-xs text-gray-500">
									{SMOOTHING_PRESET_DESCRIPTIONS[smoothingPreset]}
								</div>
							</div>

							{/* Debug: Show Hand Skeleton */}
							<div className="flex items-center justify-between">
								<div>
									<div className="text-white text-sm">Show Hand Skeleton</div>
									<div className="text-xs text-gray-500">
										Debug hand tracking
									</div>
								</div>
								<ToggleSwitch
									checked={showHandSkeleton}
									onChange={onShowHandSkeletonChange}
									disabled={isModelLoading}
									color="yellow"
									size="sm"
								/>
							</div>
						</div>
					)}

					<div className="h-px bg-white/10 my-4" />

					{/* Card Detection */}
					<div className="flex items-center justify-between">
						<div>
							<div className="text-white font-medium">Card Detection</div>
							<div className="text-xs text-gray-500">Detect playing cards via YOLO</div>
						</div>
						<ToggleSwitch
							checked={cardDetectionEnabled}
							onChange={onCardDetectionChange}
							disabled={cardModelLoading}
							color="purple"
						/>
					</div>

					{cardModelError && (
						<div className="text-xs text-red-400 bg-red-600/10 border border-red-500/20 rounded-lg p-2">
							Model error: {cardModelError}
						</div>
					)}

					{cardDetectionEnabled && (
						<div className="space-y-4 ml-4 border-l-2 border-purple-600/30 pl-4">
							<div className="space-y-2">
								<div className="flex justify-between text-sm text-gray-400">
									<span>Confidence</span>
									<span>{Math.round(cardConfidenceThreshold * 100)}%</span>
								</div>
								<input
									type="range"
									min="10"
									max="90"
									value={Math.round(cardConfidenceThreshold * 100)}
									onChange={(e) =>
										onCardConfidenceChange(parseInt(e.target.value, 10) / 100)
									}
									className="w-full accent-purple-500"
								/>
							</div>

							<div className="flex items-center justify-between">
								<div>
									<div className="text-white text-sm">Show Bounding Boxes</div>
									<div className="text-xs text-gray-500">Overlay card outlines</div>
								</div>
								<ToggleSwitch
									checked={cardShowBoxes}
									onChange={onCardShowBoxesChange}
									color="purple"
									size="sm"
								/>
							</div>

							<div className="flex items-center justify-between">
								<div>
									<div className="text-white text-sm">Show Card List</div>
									<div className="text-xs text-gray-500">Panel with detected cards</div>
								</div>
								<ToggleSwitch
									checked={cardShowList}
									onChange={onCardShowListChange}
									color="purple"
									size="sm"
								/>
							</div>
						</div>
					)}

					<div className="h-px bg-white/10 my-4" />

					{/* Flash Detection */}
					<div className="space-y-4">
						<div className="flex items-center justify-between">
							<div className="text-white font-medium">Flash Detection</div>
							<button
								onClick={() => onFlashEnabledChange(!flashEnabled)}
								className={`px-3 py-1 rounded-lg text-xs font-bold ${flashEnabled ? "bg-red-600 text-white" : "bg-gray-700 text-gray-400"}`}
							>
								{flashEnabled ? "ARMED" : "OFF"}
							</button>
						</div>

						<div className="space-y-2">
							<div className="flex justify-between text-sm text-gray-400">
								<span>Threshold</span>
								<span>{threshold}</span>
							</div>
							<input
								type="range"
								min="1"
								max="50"
								value={threshold}
								onChange={(e) =>
									onThresholdChange(parseInt(e.target.value, 10))
								}
								className="w-full accent-red-500"
							/>
						</div>

						<div className="flex items-center justify-between">
							<div className="text-sm text-gray-400">Target Color</div>
							<div className="flex items-center gap-3">
								<div
									className="w-6 h-6 rounded-full border border-white/20"
									style={{
										backgroundColor: targetColor
											? `rgb(${targetColor.r},${targetColor.g},${targetColor.b})`
											: "transparent",
									}}
								/>
								<button
									onClick={() => {
										onPickColorClick();
										onClose(); // Close modal to pick color
									}}
									className={`px-3 py-1 rounded text-xs font-bold ${isPickingColor ? "bg-blue-500 text-white" : "bg-white/10 text-white hover:bg-white/20"}`}
								>
									Pick Color
								</button>
							</div>
						</div>
					</div>

					<div className="h-px bg-white/10 my-4" />

					{/* Updates */}
					<div className="space-y-3">
						<div className="text-white font-medium">Updates</div>

						{updateAvailable && (
							<div className="flex items-center gap-2 p-2 bg-blue-600/20 border border-blue-500/30 rounded-lg">
								<span className="text-blue-400">🚀</span>
								<span className="text-blue-200 text-sm flex-1">
									New version available!
								</span>
								<button
									onClick={onReloadForUpdate}
									className="px-3 py-1 rounded text-xs font-bold bg-blue-600 text-white hover:bg-blue-500"
								>
									Update Now
								</button>
							</div>
						)}

						<div className="flex items-center justify-between">
							<div className="text-sm text-gray-400">
								{lastCheckTime ? (
									<>
										Last checked:{" "}
										{lastCheckTime.toLocaleTimeString([], {
											hour: "2-digit",
											minute: "2-digit",
										})}
									</>
								) : (
									"Never checked"
								)}
							</div>
							<button
								onClick={onCheckForUpdate}
								disabled={isCheckingUpdate}
								className={`px-3 py-1 rounded text-xs font-bold transition-colors ${
									isCheckingUpdate
										? "bg-gray-700 text-gray-400 cursor-wait"
										: "bg-white/10 text-white hover:bg-white/20"
								}`}
							>
								{isCheckingUpdate ? "Checking..." : "Check for Update"}
							</button>
						</div>
					</div>

					{/* Shake to Report (mobile only) */}
					{isShakeSupported && (
						<>
							<div className="h-px bg-white/10 my-4" />
							<div className="flex items-center justify-between">
								<div className="flex items-center gap-2">
									<Smartphone className="w-4 h-4 text-gray-400" />
									<div>
										<div className="text-white text-sm">
											Shake to Report Bug
										</div>
										<div className="text-xs text-gray-500">
											Shake device to report a bug
										</div>
									</div>
								</div>
								<ToggleSwitch
									checked={shakeEnabled}
									onChange={onShakeEnabledChange}
									color="orange"
								/>
							</div>
						</>
					)}

					<div className="h-px bg-white/10 my-4" />

					{/* About */}
					<div className="space-y-3">
						<div className="text-white font-medium">About</div>

						<button
							onClick={() => {
								onClose();
								onOpenAbout();
							}}
							className="w-full flex items-center gap-3 p-3 bg-white/5 border border-white/10 rounded-lg hover:bg-white/10 transition-colors text-left"
						>
							<Github className="w-5 h-5 text-white" />
							<div className="flex-1">
								<div className="text-white text-sm font-medium">
									About Magic Monitor
								</div>
								<div className="text-xs text-gray-500">
									Version info and links
								</div>
							</div>
							<ExternalLink className="w-4 h-4 text-gray-500" />
						</button>
					</div>

					{/* Debug Section */}
					{debugInfo && (
						<>
							<div className="h-px bg-white/10 my-4" />
							<div className="space-y-3">
								<button
									onClick={() => setIsDebugExpanded(!isDebugExpanded)}
									className="w-full flex items-center gap-2 text-left"
								>
									{isDebugExpanded ? (
										<ChevronDown className="w-4 h-4 text-gray-400" />
									) : (
										<ChevronRight className="w-4 h-4 text-gray-400" />
									)}
									<Bug className="w-4 h-4 text-gray-400" />
									<span className="text-white font-medium">Debug Info</span>
									{recordingError && (
										<span className="ml-auto text-xs text-red-400">Error</span>
									)}
								</button>

								{isDebugExpanded && (
									<div className="space-y-3 p-3 bg-black/30 border border-white/10 rounded-lg text-xs font-mono">
										{/* Recording Error */}
										{recordingError && (
											<div className="p-2 bg-red-600/20 border border-red-500/30 rounded text-red-300">
												<div className="font-bold mb-1">Recording Error:</div>
												{recordingError}
											</div>
										)}

										{/* Platform Info */}
										<div>
											<div className="text-gray-400 mb-1">Platform:</div>
											<div className="text-white">
												{debugInfo.isIOS ? `iOS ${debugInfo.iosVersion || ""} ` : ""}
												{debugInfo.isSafari ? "Safari" : "Other browser"}
											</div>
										</div>

										{/* MediaRecorder Status */}
										<div>
											<div className="text-gray-400 mb-1">MediaRecorder:</div>
											<div className={debugInfo.hasMediaRecorder ? "text-green-400" : "text-red-400"}>
												{debugInfo.hasMediaRecorder ? "Available" : "Not Available"}
											</div>
											{debugInfo.hasMediaRecorder && (
												<div className={debugInfo.hasIsTypeSupported ? "text-green-400/70" : "text-yellow-400"}>
													isTypeSupported: {debugInfo.hasIsTypeSupported ? "Yes" : "No (older Safari)"}
												</div>
											)}
										</div>

										{/* Selected Codec */}
										<div>
											<div className="text-gray-400 mb-1">Selected Codec:</div>
											<div className="text-yellow-300 break-all">
												{debugInfo.selectedCodec || "(none)"}
											</div>
										</div>

										{/* Codec Support */}
										<div>
											<div className="text-gray-400 mb-1">Codec Support:</div>
											<div className="space-y-1">
												{debugInfo.codecTests.map((test) => (
													<div key={test.mimeType} className="flex items-center gap-2">
														<span className={test.supported ? "text-green-400" : "text-red-400"}>
															{test.supported ? "✓" : "✗"}
														</span>
														<span className="text-white/70 break-all">{test.mimeType}</span>
													</div>
												))}
											</div>
										</div>

										{/* User Agent (collapsible) */}
										<div>
											<div className="text-gray-400 mb-1">User Agent:</div>
											<div className="text-white/50 break-all text-[10px]">
												{debugInfo.userAgent}
											</div>
										</div>
									</div>
								)}
							</div>
						</>
					)}
				</div>
			</div>
		</div>
	);
}

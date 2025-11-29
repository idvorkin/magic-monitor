import { Bug, ExternalLink, Github, Smartphone } from "lucide-react";
import {
	SMOOTHING_PRESET_DESCRIPTIONS,
	SMOOTHING_PRESET_LABELS,
	type SmoothingPreset,
} from "../smoothing";

interface SettingsModalProps {
	isOpen: boolean;
	onClose: () => void;

	// Camera
	devices: MediaDeviceInfo[];
	selectedDeviceId: string;
	onDeviceChange: (deviceId: string) => void;

	// Display
	isMirror: boolean;
	onMirrorChange: (isMirror: boolean) => void;

	// Performance
	isHQ: boolean;
	onHQChange: (isHQ: boolean) => void;
	isLowMemory?: boolean;
	isMobile?: boolean;

	// Smart Zoom
	isSmartZoom: boolean;
	isModelLoading: boolean;
	onSmartZoomChange: (enabled: boolean) => void;
	smoothingPreset: SmoothingPreset;
	onSmoothingPresetChange: (preset: SmoothingPreset) => void;
	showHandSkeleton: boolean;
	onShowHandSkeletonChange: (enabled: boolean) => void;

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

	// Bug Reporting
	onReportBug: () => void;
	shakeEnabled: boolean;
	onShakeEnabledChange: (enabled: boolean) => void;
	isShakeSupported: boolean;
	githubRepoUrl: string;
	bugReportShortcut: string; // e.g., "⌘I" or "Ctrl+I"
}

export function SettingsModal({
	isOpen,
	onClose,
	devices,
	selectedDeviceId,
	onDeviceChange,
	isMirror,
	onMirrorChange,
	isHQ,
	onHQChange,
	isLowMemory = false,
	isMobile = false,
	isSmartZoom,
	isModelLoading,
	onSmartZoomChange,
	smoothingPreset,
	onSmoothingPresetChange,
	showHandSkeleton,
	onShowHandSkeletonChange,
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
	onReportBug,
	shakeEnabled,
	onShakeEnabledChange,
	isShakeSupported,
	githubRepoUrl,
	bugReportShortcut,
}: SettingsModalProps) {
	const handleHQToggle = () => {
		if (!isHQ && isLowMemory) {
			const proceed = window.confirm(
				isMobile
					? "High Quality mode uses ~3.5GB RAM and may crash your mobile device. Continue anyway?"
					: "High Quality mode uses ~3.5GB RAM. Your device has limited memory. Continue anyway?",
			);
			if (!proceed) return;
		}
		onHQChange(!isHQ);
	};
	if (!isOpen) return null;

	return (
		<div
			className="absolute inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm"
			onClick={onClose}
		>
			<div
				className="bg-gray-900 border border-white/10 p-6 rounded-2xl w-full max-w-md shadow-2xl max-h-[90vh] overflow-y-auto"
				onClick={(e) => e.stopPropagation()}
			>
				<div className="flex justify-between items-center mb-6">
					<h2 className="text-xl font-bold text-white">Settings</h2>
					<button onClick={onClose} className="text-white/50 hover:text-white">
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

					{/* Mirror Video */}
					<div className="flex items-center justify-between">
						<div>
							<div className="text-white font-medium">Mirror Video</div>
							<div className="text-xs text-gray-500">
								Flip video horizontally
							</div>
						</div>
						<button
							onClick={() => onMirrorChange(!isMirror)}
							className={`w-12 h-6 rounded-full transition-colors relative ${isMirror ? "bg-blue-600" : "bg-gray-700"}`}
						>
							<div
								className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${isMirror ? "left-7" : "left-1"}`}
							/>
						</button>
					</div>

					{/* Performance */}
					<div className="flex items-center justify-between">
						<div>
							<div className="text-white font-medium">
								High Quality Mode {isLowMemory && !isHQ && "⚠️"}
							</div>
							<div className="text-xs text-gray-500">
								Uses ~3.5GB RAM
								{isLowMemory && (
									<span className="text-orange-400 ml-1">
										- May crash on this device
									</span>
								)}
							</div>
						</div>
						<button
							onClick={handleHQToggle}
							className={`w-12 h-6 rounded-full transition-colors relative ${isHQ ? "bg-purple-600" : isLowMemory ? "bg-orange-600/50" : "bg-gray-700"}`}
						>
							<div
								className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${isHQ ? "left-7" : "left-1"}`}
							/>
						</button>
					</div>

					{/* Smart Zoom */}
					<div className="flex items-center justify-between">
						<div>
							<div className="text-white font-medium">Smart Zoom</div>
							<div className="text-xs text-gray-500">Auto-follow movement</div>
						</div>
						<button
							onClick={() => onSmartZoomChange(!isSmartZoom)}
							disabled={isModelLoading}
							className={`w-12 h-6 rounded-full transition-colors relative ${isSmartZoom ? "bg-green-600" : "bg-gray-700"} ${isModelLoading ? "opacity-50" : ""}`}
						>
							<div
								className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${isSmartZoom ? "left-7" : "left-1"}`}
							/>
						</button>
					</div>

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
								<button
									onClick={() => onShowHandSkeletonChange(!showHandSkeleton)}
									disabled={isModelLoading}
									className={`w-10 h-5 rounded-full transition-colors relative ${showHandSkeleton ? "bg-yellow-600" : "bg-gray-700"} ${isModelLoading ? "opacity-50" : ""}`}
								>
									<div
										className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${showHandSkeleton ? "left-5" : "left-0.5"}`}
									/>
								</button>
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

					<div className="h-px bg-white/10 my-4" />

					{/* Bug Reporting */}
					<div className="space-y-3">
						<div className="text-white font-medium">Bug Reporting</div>

						{/* Shake to Report (mobile only) */}
						{isShakeSupported && (
							<div className="flex items-center justify-between">
								<div className="flex items-center gap-2">
									<Smartphone className="w-4 h-4 text-gray-400" />
									<div>
										<div className="text-white text-sm">Shake to Report</div>
										<div className="text-xs text-gray-500">
											Shake device to report a bug
										</div>
									</div>
								</div>
								<button
									onClick={() => onShakeEnabledChange(!shakeEnabled)}
									className={`w-12 h-6 rounded-full transition-colors relative ${shakeEnabled ? "bg-orange-600" : "bg-gray-700"}`}
								>
									<div
										className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${shakeEnabled ? "left-7" : "left-1"}`}
									/>
								</button>
							</div>
						)}

						<button
							onClick={() => {
								onReportBug();
								onClose();
							}}
							className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-red-600/20 border border-red-500/30 rounded-lg text-red-300 hover:bg-red-600/30 transition-colors"
						>
							<Bug className="w-4 h-4" />
							Report a Bug
							<kbd className="ml-2 px-1.5 py-0.5 bg-white/10 rounded text-xs text-red-400">
								{bugReportShortcut}
							</kbd>
						</button>
					</div>

					<div className="h-px bg-white/10 my-4" />

					{/* About */}
					<div className="space-y-3">
						<div className="text-white font-medium">About</div>

						<a
							href={githubRepoUrl}
							target="_blank"
							rel="noopener noreferrer"
							className="flex items-center gap-3 p-3 bg-white/5 border border-white/10 rounded-lg hover:bg-white/10 transition-colors"
						>
							<Github className="w-5 h-5 text-white" />
							<div className="flex-1">
								<div className="text-white text-sm font-medium">
									View on GitHub
								</div>
								<div className="text-xs text-gray-500">
									{githubRepoUrl.replace("https://", "")}
								</div>
							</div>
							<ExternalLink className="w-4 h-4 text-gray-500" />
						</a>
					</div>
				</div>
			</div>
		</div>
	);
}

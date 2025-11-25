interface SettingsModalProps {
	isOpen: boolean;
	onClose: () => void;

	// Camera
	devices: MediaDeviceInfo[];
	selectedDeviceId: string;
	onDeviceChange: (deviceId: string) => void;

	// Performance
	isHQ: boolean;
	onHQChange: (isHQ: boolean) => void;

	// Smart Zoom
	isSmartZoom: boolean;
	isModelLoading: boolean;
	onSmartZoomChange: (enabled: boolean) => void;

	// Flash
	flashEnabled: boolean;
	onFlashEnabledChange: (enabled: boolean) => void;
	threshold: number;
	onThresholdChange: (threshold: number) => void;
	isPickingColor: boolean;
	onPickColorClick: () => void;
	targetColor: { r: number; g: number; b: number } | null;
}

export function SettingsModal({
	isOpen,
	onClose,
	devices,
	selectedDeviceId,
	onDeviceChange,
	isHQ,
	onHQChange,
	isSmartZoom,
	isModelLoading,
	onSmartZoomChange,
	flashEnabled,
	onFlashEnabledChange,
	threshold,
	onThresholdChange,
	isPickingColor,
	onPickColorClick,
	targetColor,
}: SettingsModalProps) {
	if (!isOpen) return null;

	return (
		<div
			className="absolute inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm"
			onClick={onClose}
		>
			<div
				className="bg-gray-900 border border-white/10 p-6 rounded-2xl w-full max-w-md shadow-2xl"
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

					{/* Performance */}
					<div className="flex items-center justify-between">
						<div>
							<div className="text-white font-medium">High Quality Mode</div>
							<div className="text-xs text-gray-500">Uses ~3.5GB RAM</div>
						</div>
						<button
							onClick={() => onHQChange(!isHQ)}
							className={`w-12 h-6 rounded-full transition-colors relative ${isHQ ? "bg-purple-600" : "bg-gray-700"}`}
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
				</div>
			</div>
		</div>
	);
}

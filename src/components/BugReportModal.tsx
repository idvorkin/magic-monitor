import { Bug, Camera, Copy, ExternalLink, Smartphone, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { BugReportData } from "../hooks/useBugReporter";
import { DeviceService } from "../services/DeviceService";

interface BugReportModalProps {
	isOpen: boolean;
	onClose: () => void;
	onOpen: () => void;
	onSubmit: (data: BugReportData) => Promise<{ success: boolean }>;
	isSubmitting: boolean;
	defaultData: BugReportData;
	// Shake detection
	shakeEnabled: boolean;
	onShakeEnabledChange: (enabled: boolean) => void;
	isShakeSupported: boolean;
	onRequestShakePermission: () => Promise<boolean>;
	isFirstTime: boolean;
	onFirstTimeShown: () => void;
	shortcut: string; // e.g., "⌘I" or "Ctrl+I"
}

export function BugReportModal({
	isOpen,
	onClose,
	onOpen,
	onSubmit,
	isSubmitting,
	defaultData,
	shakeEnabled,
	onShakeEnabledChange,
	isShakeSupported,
	onRequestShakePermission,
	isFirstTime,
	onFirstTimeShown,
	shortcut,
}: BugReportModalProps) {
	const [title, setTitle] = useState(defaultData.title);
	const [description, setDescription] = useState(defaultData.description);
	const [includeMetadata, setIncludeMetadata] = useState(
		defaultData.includeMetadata,
	);
	const [screenshot, setScreenshot] = useState<string | null>(null);
	const [isCapturing, setIsCapturing] = useState(false);
	const [submitted, setSubmitted] = useState(false);
	const [hasScreenshotOnClipboard, setHasScreenshotOnClipboard] =
		useState(false);
	const [showShakePrompt, setShowShakePrompt] = useState(false);
	const isCapturingRef = useRef(false);
	const prevIsOpenRef = useRef(false);

	// Reset form when modal opens
	// Skip reset if we're just reopening after screenshot capture
	useEffect(() => {
		const wasOpen = prevIsOpenRef.current;
		prevIsOpenRef.current = isOpen;

		if (isOpen && !wasOpen) {
			if (!isCapturingRef.current) {
				// eslint-disable-next-line react-hooks/set-state-in-effect -- Resetting form when modal opens is valid
				setTitle(defaultData.title);
				setDescription(defaultData.description);
				setIncludeMetadata(defaultData.includeMetadata);
				setScreenshot(null);
				setSubmitted(false);

				// Show shake prompt on first time if supported and not enabled
				if (isFirstTime && isShakeSupported && !shakeEnabled) {
					setShowShakePrompt(true);
					onFirstTimeShown();
				} else {
					setShowShakePrompt(false);
				}
			}
			isCapturingRef.current = false;
		}
	}, [isOpen, defaultData, isFirstTime, isShakeSupported, shakeEnabled, onFirstTimeShown]);

	const handleSubmit = useCallback(async () => {
		const result = await onSubmit({
			title,
			description,
			includeMetadata,
			screenshot: screenshot ?? undefined,
		});
		if (result.success) {
			setSubmitted(true);
			setHasScreenshotOnClipboard(
				"hasScreenshotOnClipboard" in result &&
					!!result.hasScreenshotOnClipboard,
			);
		}
	}, [title, description, includeMetadata, screenshot, onSubmit]);

	const handleCaptureScreenshot = useCallback(async () => {
		setIsCapturing(true);
		isCapturingRef.current = true;
		// Hide modal temporarily so it doesn't appear in screenshot
		onClose();
		// Small delay to let modal close animation complete
		await new Promise((resolve) => setTimeout(resolve, 150));
		const dataUrl = await DeviceService.captureScreenshot();
		setScreenshot(dataUrl);
		setIsCapturing(false);
		// Reopen modal - isCapturingRef will prevent form reset
		onOpen();
	}, [onClose, onOpen]);

	const handleEnableShake = useCallback(async () => {
		const granted = await onRequestShakePermission();
		if (granted) {
			onShakeEnabledChange(true);
		}
		setShowShakePrompt(false);
	}, [onRequestShakePermission, onShakeEnabledChange]);

	if (!isOpen) return null;

	return (
		<div
			className="absolute inset-0 z-[70] flex items-center justify-center bg-black/50 backdrop-blur-sm"
			onClick={onClose}
		>
			<div
				className="bg-gray-900 border border-white/10 p-6 rounded-2xl w-full max-w-lg shadow-2xl max-h-[90vh] overflow-y-auto"
				onClick={(e) => e.stopPropagation()}
			>
				{/* Header */}
				<div className="flex justify-between items-center mb-4">
					<div className="flex items-center gap-2">
						<Bug className="w-5 h-5 text-red-400" />
						<h2 className="text-xl font-bold text-white">Report a Bug</h2>
					</div>
					<button onClick={onClose} className="text-white/50 hover:text-white">
						<X className="w-6 h-6" />
					</button>
				</div>

				{/* Shake Detection Prompt (first time) */}
				{showShakePrompt && (
					<div className="mb-4 p-4 bg-blue-600/20 border border-blue-500/30 rounded-lg">
						<div className="flex items-start gap-3">
							<Smartphone className="w-5 h-5 text-blue-400 mt-0.5 flex-shrink-0" />
							<div className="flex-1">
								<div className="text-blue-200 font-medium mb-1">
									Enable Shake to Report?
								</div>
								<div className="text-blue-300/70 text-sm mb-3">
									Shake your device anytime to quickly report a bug. This uses
									your device's motion sensors to detect when you shake it.
								</div>
								<div className="flex gap-2">
									<button
										onClick={handleEnableShake}
										className="px-3 py-1.5 bg-blue-600 text-white rounded text-sm font-medium hover:bg-blue-500"
									>
										Enable
									</button>
									<button
										onClick={() => setShowShakePrompt(false)}
										className="px-3 py-1.5 bg-white/10 text-white/70 rounded text-sm hover:bg-white/20"
									>
										Not Now
									</button>
								</div>
							</div>
						</div>
					</div>
				)}

				{submitted ? (
					/* Success State */
					<div className="text-center py-8">
						<div className="text-green-400 text-4xl mb-4">✓</div>
						<div className="text-white text-lg font-medium mb-2">
							GitHub opened!
						</div>
						{hasScreenshotOnClipboard ? (
							<div className="text-gray-400 text-sm mb-6">
								<strong className="text-yellow-400">
									Screenshot is on your clipboard!
								</strong>
								<br />
								Paste it in the GitHub issue with{" "}
								<kbd className="px-1.5 py-0.5 bg-white/10 rounded">Ctrl+V</kbd>{" "}
								/ <kbd className="px-1.5 py-0.5 bg-white/10 rounded">Cmd+V</kbd>
							</div>
						) : (
							<div className="text-gray-400 text-sm mb-6">
								Bug details copied to clipboard as backup.
							</div>
						)}
						<button
							onClick={onClose}
							className="px-4 py-2 bg-white/10 text-white rounded-lg hover:bg-white/20"
						>
							Close
						</button>
					</div>
				) : (
					/* Form */
					<>
						<div className="space-y-4">
							{/* Title */}
							<div>
								<label
									htmlFor="bug-title"
									className="block text-sm font-medium text-gray-400 mb-1"
								>
									Title
								</label>
								<input
									id="bug-title"
									type="text"
									value={title}
									onChange={(e) => setTitle(e.target.value)}
									className="w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-red-500"
									placeholder="Brief description of the bug"
								/>
							</div>

							{/* Description */}
							<div>
								<label
									htmlFor="bug-description"
									className="block text-sm font-medium text-gray-400 mb-1"
								>
									Description
								</label>
								<textarea
									id="bug-description"
									value={description}
									onChange={(e) => setDescription(e.target.value)}
									rows={8}
									className="w-full bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-red-500 font-mono text-sm"
									placeholder="What happened? What did you expect?"
								/>
							</div>

							{/* Screenshot */}
							<div className="space-y-2">
								<span className="text-sm font-medium text-gray-400">
									Screenshot
								</span>
								{DeviceService.isMobileDevice() ? (
									<p className="text-xs text-gray-500">
										Take a screenshot on your device, then attach it to the
										GitHub issue after submitting.
									</p>
								) : (
									<>
										<div className="flex items-center justify-end">
											<button
												type="button"
												onClick={handleCaptureScreenshot}
												disabled={isCapturing}
												className="flex items-center gap-2 px-3 py-1.5 bg-white/10 text-white rounded text-sm hover:bg-white/20 disabled:opacity-50"
											>
												<Camera className="w-4 h-4" />
												{isCapturing
													? "Capturing..."
													: screenshot
														? "Recapture"
														: "Capture"}
											</button>
										</div>
										{screenshot && (
											<div className="relative">
												<img
													src={screenshot}
													alt="Screenshot preview"
													className="w-full rounded-lg border border-white/10"
												/>
												<button
													type="button"
													onClick={() => setScreenshot(null)}
													className="absolute top-2 right-2 p-1 bg-black/50 rounded-full text-white/70 hover:text-white"
												>
													<X className="w-4 h-4" />
												</button>
											</div>
										)}
										<p className="text-xs text-gray-500">
											Your browser will ask which screen/tab to share. We'll
											capture a single frame.
										</p>
									</>
								)}
							</div>

							{/* Options */}
							<div className="flex items-center gap-3">
								<label className="flex items-center gap-2 cursor-pointer">
									<input
										type="checkbox"
										checked={includeMetadata}
										onChange={(e) => setIncludeMetadata(e.target.checked)}
										className="w-4 h-4 rounded border-white/20 bg-black/30 text-red-500 focus:ring-red-500"
									/>
									<span className="text-sm text-gray-300">
										Include technical details (browser, route, timestamp)
									</span>
								</label>
							</div>
						</div>

						{/* Actions */}
						<div className="flex justify-between items-center mt-6 pt-4 border-t border-white/10">
							<button
								onClick={onClose}
								className="px-4 py-2 text-gray-400 hover:text-white"
							>
								Cancel
							</button>
							<button
								onClick={handleSubmit}
								disabled={isSubmitting || !title.trim()}
								className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg font-medium hover:bg-red-500 disabled:opacity-50 disabled:cursor-not-allowed"
							>
								{isSubmitting ? (
									"Opening GitHub..."
								) : (
									<>
										<Copy className="w-4 h-4" />
										Copy & Open GitHub
										<ExternalLink className="w-4 h-4" />
									</>
								)}
							</button>
						</div>

						{/* Keyboard shortcut hint */}
						<div className="mt-4 text-center text-xs text-gray-500">
							Tip: Press{" "}
							<kbd className="px-1.5 py-0.5 bg-white/10 rounded">
								{shortcut}
							</kbd>{" "}
							anytime to report a bug
						</div>
					</>
				)}
			</div>
		</div>
	);
}

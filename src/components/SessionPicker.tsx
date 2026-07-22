import clsx from "clsx";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useFocusTrap } from "../hooks/useFocusTrap";
import { useMobileDetection } from "../hooks/useMobileDetection";
import { SessionStorageService } from "../services/SessionStorageService";
import type { PracticeSession } from "../types/sessions";
import { SESSION_CONFIG } from "../types/sessions";
import { formatDuration } from "../utils/formatters";
import { PreviewSizeSlider } from "./PreviewSizeSlider";
import { SessionThumbnail } from "./SessionThumbnail";
import { ThumbnailGrid } from "./ThumbnailGrid";

// ===== Types =====

interface SessionPickerProps {
	isOpen: boolean;
	onClose: () => void;
	onSelectSession: (sessionId: string, startTime?: number) => void;
	recentSessions: PracticeSession[];
	savedSessions: PracticeSession[];
	onRefresh: () => void;
	activeSessionId?: string;
}

type PickerView = "list" | "timeline";

function formatTimeAgo(timestamp: number): string {
	const now = Date.now();
	const diff = now - timestamp;

	if (diff < 60_000) return "just now";
	if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
	if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
	return new Date(timestamp).toLocaleDateString();
}

function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

// ===== Component =====

export function SessionPicker({
	isOpen,
	onClose,
	onSelectSession,
	recentSessions,
	savedSessions,
	onRefresh,
	activeSessionId,
}: SessionPickerProps) {
	const containerRef = useFocusTrap({ isOpen, onClose });

	const [view, setView] = useState<PickerView>("list");
	const [selectedSession, setSelectedSession] = useState<PracticeSession | null>(null);
	const [storageUsage, setStorageUsage] = useState({ used: 0, quota: 0 });
	const [previewSize, setPreviewSize] = useState(50); // 0-100 slider
	const [showPreviews, setShowPreviews] = useState(true);
	const [deleteError, setDeleteError] = useState<string | null>(null);

	const { isMobile } = useMobileDetection();

	// Reset to list view and refresh sessions when picker opens
	useEffect(() => {
		if (isOpen) {
			// eslint-disable-next-line react-hooks/set-state-in-effect -- intentional modal reset
			setView("list");
			setSelectedSession(null);
			// Refresh sessions to show latest recordings
			onRefresh();
		}
	}, [isOpen, onRefresh]);

	// Show up to 15 thumbnails, evenly distributed across the video
	const displayThumbnails = useMemo(() => {
		if (!selectedSession) return [];
		const all = selectedSession.thumbnails;
		const maxThumbnails = 15;

		if (all.length <= maxThumbnails) {
			return all;
		}

		// Evenly distribute: always include first and last
		const selected: typeof all = [];
		const step = (all.length - 1) / (maxThumbnails - 1);
		for (let i = 0; i < maxThumbnails; i++) {
			const index = Math.round(i * step);
			selected.push(all[index]);
		}
		return selected;
	}, [selectedSession]);

	// Load storage usage
	useEffect(() => {
		if (isOpen) {
			SessionStorageService.getStorageUsage().then(setStorageUsage);
		}
	}, [isOpen, recentSessions, savedSessions]);

	// Handle session click (drill down to timeline)
	const handleSessionClick = useCallback((session: PracticeSession) => {
		setSelectedSession(session);
		setView("timeline");
	}, []);

	// Handle thumbnail click in timeline (select time and go to replay)
	const handleTimelineSelect = useCallback(
		(time: number) => {
			if (selectedSession) {
				onSelectSession(selectedSession.id, time);
			}
		},
		[selectedSession, onSelectSession],
	);

	// Handle back from timeline
	const handleBack = useCallback(() => {
		setSelectedSession(null);
		setView("list");
	}, []);


	// Handle close
	const handleClose = useCallback(() => {
		setView("list");
		setSelectedSession(null);
		onClose();
	}, [onClose]);

	// Handle delete session
	const handleDelete = useCallback(
		async (sessionId: string) => {
			setDeleteError(null);
			try {
				await SessionStorageService.deleteSessionWithBlob(sessionId);
				onRefresh();
				if (selectedSession?.id === sessionId) {
					handleBack();
				}
			} catch (err) {
				console.error("Failed to delete session:", err);
				setDeleteError("Failed to delete - please try again");
			}
		},
		[selectedSession, onRefresh, handleBack],
	);

	// Stop wheel events from propagating to parent zoom handler
	const handleWheel = useCallback((e: React.WheelEvent) => {
		e.stopPropagation();
	}, []);

	if (!isOpen) return null;

	const isStorageWarning = storageUsage.used > SESSION_CONFIG.STORAGE_WARNING_BYTES;

	return (
		<div
			className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
			onWheel={handleWheel}
		>
			<div ref={containerRef} className="bg-gray-900 rounded-2xl w-full max-w-4xl max-h-[90vh] mx-4 overflow-hidden flex flex-col">
				{/* Header */}
				<div className="flex items-center justify-between p-4 border-b border-gray-700">
					{view === "timeline" && selectedSession ? (
						<>
							<button
								onClick={handleBack}
								className="px-3 py-1 text-sm text-gray-300 hover:text-white flex items-center gap-2"
							>
								<span>←</span> Back
							</button>
							<h2 className="text-lg font-semibold text-white">
								{selectedSession.name || formatDuration(selectedSession.duration)}
							</h2>
						</>
					) : (
						<h2 className="text-lg font-semibold text-white">Sessions</h2>
					)}
					<button
						onClick={handleClose}
						className="p-2 text-gray-400 hover:text-white rounded-lg hover:bg-gray-800"
					aria-label="Close"
					>
						✕
					</button>
				</div>

				{/* Content - min-h-0 is required for overflow-y-auto to work in flex containers */}
				<div className="flex-1 min-h-0 overflow-y-auto p-4">
					{/* Delete Error */}
					{deleteError && (
						<div className="mb-4 p-3 bg-red-900/50 border border-red-600 rounded-lg text-red-200 text-sm">
							{deleteError}
						</div>
					)}

					{view === "list" ? (
						<div className="space-y-6">
							{/* Recent Sessions */}
							<div>
								<h3 className="text-sm font-medium text-gray-400 mb-3">
									Recent
								</h3>
								{recentSessions.length === 0 ? (
									<p className="text-gray-500 text-sm">
										No recent recordings
									</p>
								) : (
									<div className="flex flex-wrap gap-4">
										{recentSessions.map((session) => (
											<SessionThumbnail
												key={session.id}
												session={session}
												onClick={() => handleSessionClick(session)}
												onDelete={() => handleDelete(session.id)}
												timeLabel={formatTimeAgo(session.createdAt)}
												isActive={session.id === activeSessionId}
											/>
										))}
									</div>
								)}
							</div>

							{/* Saved Sessions */}
							<div>
								<h3 className="text-sm font-medium text-gray-400 mb-3">
									Saved
								</h3>
								{savedSessions.length === 0 ? (
									<p className="text-gray-500 text-sm">
										No saved clips yet
									</p>
								) : (
									<div className="flex flex-wrap gap-4">
										{savedSessions.map((session) => (
											<SessionThumbnail
												key={session.id}
												session={session}
												onClick={() => handleSessionClick(session)}
												onDelete={() => handleDelete(session.id)}
												showStar
												isActive={session.id === activeSessionId}
											/>
										))}
									</div>
								)}
							</div>

							{/* Storage Indicator */}
							<div className="pt-4 border-t border-gray-700">
								<div className="flex items-center justify-between text-sm">
									<span
										className={clsx(
											"text-gray-400",
											isStorageWarning && "text-yellow-500",
										)}
									>
										Storage: {formatBytes(storageUsage.used)} used
										{storageUsage.quota > 0 &&
											` of ${formatBytes(storageUsage.quota)}`}
									</span>
									<button
										onClick={async () => {
											if (
												confirm(
													"Clear all recent recordings? Saved clips will not be deleted.",
												)
											) {
												for (const session of recentSessions) {
													await SessionStorageService.deleteSessionWithBlob(
														session.id,
													);
												}
												onRefresh();
											}
										}}
										className="text-xs text-gray-500 hover:text-red-400"
									>
										Clear Recent
									</button>
								</div>
							</div>
						</div>
					) : (
						/* Timeline View */
						<div className="space-y-4">
							{selectedSession && (
								<>
									{/* Preview controls and actions */}
									<div className="flex items-center justify-between gap-4">
										{/* Left: Hide/Show toggle */}
										<button
											onClick={() => setShowPreviews(!showPreviews)}
											className="flex items-center gap-2 text-sm text-gray-400 hover:text-white transition-colors"
										>
											<span
												className={clsx(
													"transition-transform duration-200",
													showPreviews ? "rotate-90" : "rotate-0",
												)}
											>
												▶
											</span>
											{displayThumbnails.length} previews
										</button>

										{/* Right: Size slider and action buttons */}
										<div className="flex items-center gap-3">
											{showPreviews && (
												<PreviewSizeSlider
													value={previewSize}
													onChange={setPreviewSize}
													width="w-24"
													title="Thumbnail size"
												/>
											)}

											{/* Save button (only for unsaved sessions) */}
											{!selectedSession.saved && (
												<button
													onClick={async () => {
														const name = prompt("Name this clip:");
														if (name) {
															await SessionStorageService.markAsSaved(
																selectedSession.id,
																name,
															);
															await onRefresh();
															handleBack();
														}
													}}
													className="px-3 py-1.5 bg-green-600 hover:bg-green-500 text-white rounded-lg text-sm font-medium flex items-center gap-1.5"
												>
													<span>⭐</span> Save
												</button>
											)}

											{/* Delete button */}
											<button
												onClick={() => {
													if (confirm("Delete this recording?")) {
														handleDelete(selectedSession.id);
													}
												}}
												className="px-3 py-1.5 bg-red-600/80 hover:bg-red-500 text-white rounded-lg text-sm font-medium flex items-center gap-1.5"
											>
												🗑 Delete
											</button>
										</div>
									</div>

									{/* Thumbnail grid - resizable via slider */}
									{showPreviews && (
										<ThumbnailGrid
											thumbnails={displayThumbnails}
											onSelect={handleTimelineSelect}
											layout="aspect"
											columns={
												isMobile
													? Math.max(1, Math.round(4 - (previewSize / 100) * 3))
													: Math.max(2, Math.round(10 - (previewSize / 100) * 8))
											}
											isMobile={isMobile}
										/>
									)}
								</>
							)}
						</div>
					)}
				</div>
			</div>
		</div>
	);
}

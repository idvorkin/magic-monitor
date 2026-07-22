import { useCallback, useEffect, useState } from "react";
import {
	SessionStorageService,
	type SessionStorageServiceType,
} from "../services/SessionStorageService";
import { ThumbnailCaptureService } from "../services/ThumbnailCaptureService";
import {
	VideoFixService,
	type VideoFixServiceType,
} from "../services/VideoFixService";
import type { PracticeSession, SessionThumbnail } from "../types/sessions";

export interface SessionListConfig {
	sessionStorageService?: SessionStorageServiceType;
	videoFixService?: VideoFixServiceType;
}

export interface SessionListControls {
	recentSessions: PracticeSession[];
	savedSessions: PracticeSession[];
	error: string | null;
	isInitialized: boolean;
	initFailed: boolean;
	saveBlock: (
		blob: Blob,
		duration: number,
		thumbnails: SessionThumbnail[],
		blockStartTime: number,
	) => Promise<PracticeSession | null>;
	refreshSessions: () => Promise<void>;
}

/**
 * Hook for managing session lists (loading, saving, refreshing).
 * Single Responsibility: Session persistence and list management.
 */
export function useSessionList({
	sessionStorageService = SessionStorageService,
	videoFixService = VideoFixService,
}: SessionListConfig = {}): SessionListControls {
	const [recentSessions, setRecentSessions] = useState<PracticeSession[]>([]);
	const [savedSessions, setSavedSessions] = useState<PracticeSession[]>([]);
	const [error, setError] = useState<string | null>(null);
	const [isInitialized, setIsInitialized] = useState(false);
	const [initFailed, setInitFailed] = useState(false);

	// Initialize storage and load sessions
	useEffect(() => {
		async function init() {
			try {
				await sessionStorageService.init();
				const recent = await sessionStorageService.getRecentSessions();
				const saved = await sessionStorageService.getSavedSessions();
				setRecentSessions(recent);
				setSavedSessions(saved);
				setIsInitialized(true);
			} catch (err) {
				console.error("Failed to initialize session storage:", err);
				setError("Storage unavailable - recording disabled");
				setInitFailed(true);
			}
		}
		init();
	}, [sessionStorageService]);

	const refreshSessions = useCallback(async () => {
		try {
			const recent = await sessionStorageService.getRecentSessions();
			const saved = await sessionStorageService.getSavedSessions();
			setRecentSessions(recent);
			setSavedSessions(saved);
			// Clear error on successful refresh
			setError(null);
		} catch (err) {
			console.error("Failed to refresh sessions:", err);
			setError("Failed to load sessions");
		}
	}, [sessionStorageService]);

	const saveBlock = useCallback(
		async (
			blob: Blob,
			duration: number,
			thumbnails: SessionThumbnail[],
			blockStartTime: number,
		): Promise<PracticeSession | null> => {
			if (blob.size === 0) return null;

			try {
				// Fix WebM metadata for seekability
				let fixedBlob = blob;
				if (videoFixService.needsFix(blob)) {
					const fixResult = await videoFixService.fixDuration(blob);
					fixedBlob = fixResult.blob;
					if (!fixResult.wasFixed) {
						console.warn(
							"Video fix failed - exported video may not be seekable",
						);
					}
				}

				// Get first frame as thumbnail
				const firstThumbnail =
					thumbnails.length > 0
						? thumbnails[0].dataUrl
						: await ThumbnailCaptureService.captureAtTime(fixedBlob, 0);

				// Create session object
				const session: Omit<PracticeSession, "id"> = {
					createdAt: blockStartTime,
					duration: duration / 1000, // Convert to seconds
					blobKey: "", // Placeholder - blob is stored using session.id
					thumbnail: firstThumbnail,
					thumbnails,
					saved: false,
				};

				// Save to storage (atomic transaction)
				const id = await sessionStorageService.saveSessionWithBlob(
					session,
					fixedBlob,
				);

				// Prune old sessions
				await sessionStorageService.pruneOldSessions();

				// Refresh session lists
				await refreshSessions();

				// Return session with correct blobKey (same as id)
				return { ...session, id, blobKey: id };
			} catch (err) {
				console.error("Failed to save block:", err);
				setError("Failed to save recording block");
				return null;
			}
		},
		[videoFixService, sessionStorageService, refreshSessions],
	);

	return {
		recentSessions,
		savedSessions,
		error,
		isInitialized,
		initFailed,
		saveBlock,
		refreshSessions,
	};
}

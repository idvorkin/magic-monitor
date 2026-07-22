import { useCallback, useEffect, useRef, useState } from "react";
import {
	SessionStorageService,
	type SessionStorageServiceType,
} from "../services/SessionStorageService";
import { ShareService, type ShareServiceType } from "../services/ShareService";
import {
	TimerService,
	type TimerServiceType,
} from "../services/TimerService";
import type { PracticeSession } from "../types/sessions";

// ===== Types =====

export interface ReplayPlayerConfig {
	// Dependency injection for testing
	sessionStorageService?: SessionStorageServiceType;
	shareService?: ShareServiceType;
	timerService?: TimerServiceType;
	loadTimeoutMs?: number;
}

export interface ReplayPlayerControls {
	// State
	session: PracticeSession | null;
	isLoading: boolean;
	isReady: boolean; // True when video can be seeked/played
	isPlaying: boolean;
	currentTime: number;
	duration: number;
	error: string | null;

	// Trim state
	inPoint: number | null;
	outPoint: number | null;
	hasTrimSelection: boolean;

	// Export state
	isExporting: boolean;
	exportProgress: number;

	// Session controls
	loadSession: (sessionId: string) => Promise<void>;
	unloadSession: () => void;

	// Playback controls
	play: () => void;
	pause: () => void;
	seek: (time: number) => void;
	stepFrame: (direction: 1 | -1) => void;

	// Trim controls
	setInPoint: () => void;
	setOutPoint: () => void;
	clearTrim: () => void;
	previewTrim: () => void;

	// Save/Export
	saveClip: (name: string) => Promise<PracticeSession | null>;
	exportVideo: () => Promise<void>;

	// Video element callback ref (for rendering)
	videoRef: (element: HTMLVideoElement | null) => void;
}

// Frame duration at 30fps
const FRAME_DURATION = 1 / 30;
const MIN_CLIP_DURATION = 0.5; // seconds
const DEFAULT_LOAD_TIMEOUT_MS = 10000; // 10 seconds

// ===== Hook implementation =====

export function useReplayPlayer({
	sessionStorageService = SessionStorageService,
	shareService = ShareService,
	timerService = TimerService,
	loadTimeoutMs = DEFAULT_LOAD_TIMEOUT_MS,
}: ReplayPlayerConfig = {}): ReplayPlayerControls {
	// Session state
	const [session, setSession] = useState<PracticeSession | null>(null);
	const [isLoading, setIsLoading] = useState(false);
	const [isReady, setIsReady] = useState(false);
	const [isPlaying, setIsPlaying] = useState(false);
	const [currentTime, setCurrentTime] = useState(0);
	const [duration, setDuration] = useState(0);

	// Trim state
	const [inPoint, setInPointState] = useState<number | null>(null);
	const [outPoint, setOutPointState] = useState<number | null>(null);

	// Export state
	const [isExporting, setIsExporting] = useState(false);
	const [exportProgress, setExportProgress] = useState(0);

	// Error state
	const [error, setError] = useState<string | null>(null);

	// Video element state (callback ref pattern)
	const [videoElement, setVideoElement] = useState<HTMLVideoElement | null>(null);

	// Refs for values that shouldn't trigger re-renders
	const blobUrlRef = useRef<string | null>(null);
	const currentVideoElementRef = useRef<HTMLVideoElement | null>(null);
	const isTrimPreviewRef = useRef(false);
	const trimPreviewRafRef = useRef<number | null>(null); // For precise trim preview stopping
	const pendingSeekRef = useRef<{ time: number; requestId: number } | null>(null);
	const loadTimeoutRef = useRef<number | null>(null);
	const loadRequestIdRef = useRef(0); // For ignoring stale load completions

	// Computed
	const hasTrimSelection = inPoint !== null && outPoint !== null;

	// Cleanup blob URL
	const cleanupBlobUrl = useCallback(() => {
		// Clear video element src if it exists
		if (currentVideoElementRef.current) {
			currentVideoElementRef.current.src = "";
		}
		// Revoke blob URL
		if (blobUrlRef.current) {
			URL.revokeObjectURL(blobUrlRef.current);
			blobUrlRef.current = null;
		}
	}, []);

	// Clear load timeout
	const clearLoadTimeout = useCallback(() => {
		if (loadTimeoutRef.current !== null) {
			timerService.clearTimeout(loadTimeoutRef.current);
			loadTimeoutRef.current = null;
		}
	}, [timerService]);

	// Callback ref for video element - triggers initialization when element mounts
	const videoRef = useCallback(
		(element: HTMLVideoElement | null) => {
			// Handle unmount - clear src to prevent stale blob URL usage
			if (element === null && currentVideoElementRef.current) {
				currentVideoElementRef.current.src = "";
				currentVideoElementRef.current = null;
			}

			// Handle mount - set up new element
			if (element) {
				currentVideoElementRef.current = element;

				// Only set src if element doesn't already have it set to our blob URL
				// This prevents double-setting in strict mode mount/unmount/remount cycles
				if (blobUrlRef.current && session && element.src !== blobUrlRef.current) {
					element.src = blobUrlRef.current;
					element.load();
				}
			}

			setVideoElement(element);
		},
		[session],
	);

	// Load a session for playback
	const loadSession = useCallback(
		async (sessionId: string) => {
			// Increment request ID to track this specific load request
			// If another loadSession is called before this completes, we'll ignore this result
			const requestId = ++loadRequestIdRef.current;

			clearLoadTimeout();
			setIsLoading(true);
			setIsReady(false);
			setIsPlaying(false);
			setError(null);
			isTrimPreviewRef.current = false;

			try {
				// Load session metadata and blob BEFORE cleaning up old session
				// This way if load fails, we still have the old session intact
				const sessionData = await sessionStorageService.getSession(sessionId);
				if (!sessionData) {
					throw new Error("Session not found");
				}

				const blob = await sessionStorageService.getBlob(sessionId);
				if (!blob) {
					throw new Error("Video not found");
				}

				// Check if this request is still current (another load may have started)
				if (requestId !== loadRequestIdRef.current) {
					// Another load started - ignore this result and cleanup the blob we created
					return;
				}

				// NOW cleanup old session - new one loaded successfully
				cleanupBlobUrl();

				// Create blob URL for new session
				const blobUrl = URL.createObjectURL(blob);
				blobUrlRef.current = blobUrl;

				// Reset playback state for new session
				setCurrentTime(0);
				setDuration(0);
				setInPointState(null);
				setOutPointState(null);
				pendingSeekRef.current = null;

				// If video element already exists, initialize it
				// Use ref instead of state to avoid stale closure and dependency issues
				if (currentVideoElementRef.current) {
					currentVideoElementRef.current.src = blobUrl;
					currentVideoElementRef.current.load();
				}
				// Otherwise, callback ref will handle it when element mounts

				setSession(sessionData);

				// Restore trim points if they exist
				if (sessionData.trimIn !== undefined) {
					setInPointState(sessionData.trimIn);
				}
				if (sessionData.trimOut !== undefined) {
					setOutPointState(sessionData.trimOut);
				}

				// Set timeout for loading
				loadTimeoutRef.current = timerService.setTimeout(() => {
					// Check actual video state using ref, not stale closure
					if (currentVideoElementRef.current && currentVideoElementRef.current.readyState < 1) {
						setError("Video loading timed out - please try again");
						setIsLoading(false);
					}
				}, loadTimeoutMs);
			} catch (err) {
				// Only set error if this is still the current request
				if (requestId === loadRequestIdRef.current) {
					console.error("Failed to load session:", err);
					setError(err instanceof Error ? err.message : "Failed to load session");
					// Don't clear session - keep old one if load failed
					setIsLoading(false);
				}
			}
		},
		[sessionStorageService, timerService, cleanupBlobUrl, clearLoadTimeout, loadTimeoutMs],
	);

	// Unload session
	const unloadSession = useCallback(() => {
		// Use ref instead of state to avoid stale closure and dependency issues
		if (currentVideoElementRef.current) {
			currentVideoElementRef.current.pause();
			currentVideoElementRef.current.src = "";
		}
		cleanupBlobUrl();
		clearLoadTimeout();
		setSession(null);
		setIsLoading(false);
		setIsReady(false);
		setIsPlaying(false);
		setCurrentTime(0);
		setDuration(0);
		setInPointState(null);
		setOutPointState(null);
		setError(null);
		isTrimPreviewRef.current = false;
		pendingSeekRef.current = null;
	}, [cleanupBlobUrl, clearLoadTimeout]);

	// Playback controls
	const play = useCallback(() => {
		if (videoElement && isReady) {
			videoElement.play().catch((err) => {
				console.error("Play failed:", err);
				if (err.name === "NotAllowedError") {
					setError("Playback blocked - tap the video to enable audio");
				} else {
					setError("Playback failed - please try again");
				}
			});
		}
	}, [videoElement, isReady]);

	const pause = useCallback(() => {
		if (videoElement) {
			videoElement.pause();
		}
	}, [videoElement]);

	const seek = useCallback(
		(time: number) => {
			if (videoElement && isReady && Number.isFinite(videoElement.duration)) {
				const clampedTime = Math.max(0, Math.min(time, videoElement.duration));
				videoElement.currentTime = clampedTime;
				setCurrentTime(clampedTime);
			} else if (session) {
				// Video not ready yet, store pending seek with request ID (not session ID)
				// This avoids stale closure issues since we check against the ref
				pendingSeekRef.current = { time, requestId: loadRequestIdRef.current };
			}
		},
		[videoElement, isReady, session],
	);

	const stepFrame = useCallback(
		(direction: 1 | -1) => {
			if (!videoElement || !isReady) return;

			const newTime = videoElement.currentTime + direction * FRAME_DURATION;
			const clampedTime = Math.max(0, Math.min(newTime, videoElement.duration || 0));
			videoElement.currentTime = clampedTime;
			setCurrentTime(clampedTime);
		},
		[videoElement, isReady],
	);

	// Trim controls
	const setInPoint = useCallback(() => {
		if (!videoElement || !isReady) return;

		const newIn = videoElement.currentTime;

		// If out point exists and is before new in point, adjust
		if (outPoint !== null && newIn >= outPoint) {
			setOutPointState(videoElement.duration);
		}

		setInPointState(newIn);
	}, [videoElement, isReady, outPoint]);

	const setOutPoint = useCallback(() => {
		if (!videoElement || !isReady) return;

		const newOut = videoElement.currentTime;

		// If in point exists and is after new out point, adjust
		if (inPoint !== null && newOut <= inPoint) {
			setInPointState(0);
		}

		// Ensure minimum duration
		if (inPoint !== null && newOut - inPoint < MIN_CLIP_DURATION) {
			setOutPointState(inPoint + MIN_CLIP_DURATION);
		} else {
			setOutPointState(newOut);
		}
	}, [videoElement, isReady, inPoint]);

	const clearTrim = useCallback(() => {
		setInPointState(null);
		setOutPointState(null);
		isTrimPreviewRef.current = false;
	}, []);

	// Stop the trim preview rAF loop
	const stopTrimPreviewLoop = useCallback(() => {
		if (trimPreviewRafRef.current !== null) {
			cancelAnimationFrame(trimPreviewRafRef.current);
			trimPreviewRafRef.current = null;
		}
		isTrimPreviewRef.current = false;
	}, []);

	const previewTrim = useCallback(() => {
		if (!videoElement || !isReady || inPoint === null || outPoint === null) return;

		// Stop any existing preview loop
		stopTrimPreviewLoop();

		isTrimPreviewRef.current = true;
		videoElement.currentTime = inPoint;

		// Use requestAnimationFrame for precise stopping at outPoint
		// This avoids overshoot that can happen with timeupdate (fires ~4Hz)
		const checkOutPoint = () => {
			if (!isTrimPreviewRef.current || !videoElement) {
				stopTrimPreviewLoop();
				return;
			}

			// Check if we've reached or passed the out point
			if (videoElement.currentTime >= outPoint) {
				videoElement.pause();
				// Ensure we're exactly at outPoint (prevents visual overshoot)
				videoElement.currentTime = outPoint;
				stopTrimPreviewLoop();
				return;
			}

			// Continue the loop if still playing
			if (!videoElement.paused) {
				trimPreviewRafRef.current = requestAnimationFrame(checkOutPoint);
			} else {
				stopTrimPreviewLoop();
			}
		};

		videoElement.play().then(() => {
			// Start the rAF loop after play succeeds
			trimPreviewRafRef.current = requestAnimationFrame(checkOutPoint);
		}).catch((err) => {
			console.error("Play failed:", err);
			stopTrimPreviewLoop();
			if (err.name === "NotAllowedError") {
				setError("Playback blocked - tap the video to enable audio");
			} else {
				setError("Playback failed - please try again");
			}
		});
	}, [videoElement, isReady, inPoint, outPoint, stopTrimPreviewLoop]);

	// Consolidated video lifecycle effect
	useEffect(() => {
		if (!videoElement) return;

		// Event handlers
		const handleLoadedMetadata = () => {
			clearLoadTimeout();
			setDuration(videoElement.duration);
			setIsLoading(false);
			setIsReady(true);

			// Apply pending seek only if it's for the current load request
			// Using requestId ref avoids stale closure issues with session state
			if (pendingSeekRef.current && pendingSeekRef.current.requestId === loadRequestIdRef.current) {
				const clampedTime = Math.max(0, Math.min(pendingSeekRef.current.time, videoElement.duration));
				videoElement.currentTime = clampedTime;
				setCurrentTime(clampedTime);
				pendingSeekRef.current = null;
			}
		};

		const handleTimeUpdate = () => {
			setCurrentTime(videoElement.currentTime);

			// Stop at out point during trim preview
			if (isTrimPreviewRef.current && outPoint !== null) {
				if (videoElement.currentTime >= outPoint) {
					videoElement.pause();
					isTrimPreviewRef.current = false;
				}
			}
		};

		const handleEnded = () => {
			setIsPlaying(false);
			isTrimPreviewRef.current = false;
		};

		const handlePlay = () => setIsPlaying(true);
		const handlePause = () => setIsPlaying(false);

		const handleError = () => {
			clearLoadTimeout();
			const mediaError = videoElement.error;
			let errorMessage = "Failed to load video";
			if (mediaError) {
				switch (mediaError.code) {
					case MediaError.MEDIA_ERR_ABORTED:
						errorMessage = "Video loading was aborted";
						break;
					case MediaError.MEDIA_ERR_NETWORK:
						errorMessage = "Network error while loading video";
						break;
					case MediaError.MEDIA_ERR_DECODE:
						errorMessage = "Video format not supported";
						break;
					case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
						errorMessage = "Video source not supported";
						break;
				}
			}
			setError(errorMessage);
			setIsLoading(false);
			setIsReady(false);
		};

		// Attach all listeners
		videoElement.addEventListener("loadedmetadata", handleLoadedMetadata);
		videoElement.addEventListener("timeupdate", handleTimeUpdate);
		videoElement.addEventListener("ended", handleEnded);
		videoElement.addEventListener("play", handlePlay);
		videoElement.addEventListener("pause", handlePause);
		videoElement.addEventListener("error", handleError);

		// If video already has metadata (e.g., re-render), update state
		if (videoElement.readyState >= 1 && videoElement.duration > 0) {
			handleLoadedMetadata();
		}

		// If we have a blob URL but src isn't set, set it now
		if (blobUrlRef.current && !videoElement.src) {
			videoElement.src = blobUrlRef.current;
			videoElement.load();
		}

		return () => {
			videoElement.removeEventListener("loadedmetadata", handleLoadedMetadata);
			videoElement.removeEventListener("timeupdate", handleTimeUpdate);
			videoElement.removeEventListener("ended", handleEnded);
			videoElement.removeEventListener("play", handlePlay);
			videoElement.removeEventListener("pause", handlePause);
			videoElement.removeEventListener("error", handleError);
			// Cancel any running trim preview rAF loop
			if (trimPreviewRafRef.current !== null) {
				cancelAnimationFrame(trimPreviewRafRef.current);
				trimPreviewRafRef.current = null;
			}
		};
	}, [videoElement, outPoint, clearLoadTimeout]);

	// Save clip (create new saved session from trim)
	const saveClip = useCallback(
		async (name: string): Promise<PracticeSession | null> => {
			if (!session) return null;

			try {
				// Update the session to mark it as saved
				await sessionStorageService.markAsSaved(session.id, name);

				// If we have trim points, validate and save them
				if (inPoint !== null && outPoint !== null) {
					// Validate trim points before saving
					const validInPoint = Math.max(0, inPoint);
					const validOutPoint = Math.min(outPoint, duration || outPoint);

					// Only save if in < out and minimum duration met
					if (validInPoint < validOutPoint && validOutPoint - validInPoint >= MIN_CLIP_DURATION) {
						await sessionStorageService.setTrimPoints(session.id, validInPoint, validOutPoint);
					}
					// If validation fails, save without trim points (full clip)
				}

				// Refresh and return updated session
				const updated = await sessionStorageService.getSession(session.id);
				if (updated) {
					setSession(updated);
				}
				return updated;
			} catch (err) {
				console.error("Failed to save clip:", err);
				setError("Failed to save clip - please try again");
				return null;
			}
		},
		[session, sessionStorageService, inPoint, outPoint, duration],
	);

	// Export video
	const exportVideo = useCallback(async () => {
		if (!session || isExporting) return;

		setIsExporting(true);
		setExportProgress(0);

		try {
			// Get the blob
			const blob = await sessionStorageService.getBlob(session.id);
			if (!blob) {
				throw new Error("Video blob not found");
			}

			setExportProgress(0.5);

			// Generate filename
			const filename = shareService.generateFilename(
				session.name || "practice-clip",
				blob.type,
			);

			// Share or download
			await shareService.share(blob, filename);

			setExportProgress(1);
		} catch (err) {
			console.error("Export failed:", err);
			setError("Export failed - please try again");
		} finally {
			setIsExporting(false);
			setExportProgress(0);
		}
	}, [session, sessionStorageService, shareService, isExporting]);

	// Cleanup on unmount
	useEffect(() => {
		return () => {
			cleanupBlobUrl();
			clearLoadTimeout();
		};
	}, [cleanupBlobUrl, clearLoadTimeout]);

	return {
		// State
		session,
		isLoading,
		isReady,
		isPlaying,
		currentTime,
		duration,
		error,

		// Trim state
		inPoint,
		outPoint,
		hasTrimSelection,

		// Export state
		isExporting,
		exportProgress,

		// Session controls
		loadSession,
		unloadSession,

		// Playback controls
		play,
		pause,
		seek,
		stepFrame,

		// Trim controls
		setInPoint,
		setOutPoint,
		clearTrim,
		previewTrim,

		// Save/Export
		saveClip,
		exportVideo,

		// Video element callback ref
		videoRef,
	};
}

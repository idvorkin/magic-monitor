import { useCallback, useEffect, useRef, useState } from "react";
import {
	DeviceService,
	type DeviceServiceType,
} from "../services/DeviceService";
import {
	type ChunkPreview,
	DiskBufferService,
	type DiskBufferServiceType,
} from "../services/DiskBufferService";
import {
	MediaRecorderService,
	type MediaRecorderServiceType,
	type RecordingSession,
} from "../services/MediaRecorderService";

// ===== Types =====

export interface DiskTimeMachineConfig {
	videoRef: React.RefObject<HTMLVideoElement | null>;
	enabled: boolean;
	chunkDurationMs?: number; // Default: 2000 (2 seconds)
	maxChunks?: number; // Default: 30 (60 seconds total)
	// Dependency injection for testing
	diskBufferService?: DiskBufferServiceType;
	deviceService?: DeviceServiceType;
	mediaRecorderService?: MediaRecorderServiceType;
}

export interface DiskTimeMachineControls {
	// State
	isRecording: boolean;
	isReplaying: boolean;
	isPlaying: boolean;
	chunkCount: number;
	currentChunkIndex: number;
	totalDuration: number; // Total buffer duration in seconds
	currentTime: number; // Current playback position in seconds
	previews: ChunkPreview[];
	recordingError: string | null; // Error message if recording failed
	isExporting: boolean; // True while export is in progress
	exportProgress: number; // Export progress 0-1

	// Controls
	enterReplay: () => void;
	exitReplay: () => void;
	play: () => void;
	pause: () => void;
	seekToChunk: (index: number) => void;
	nextChunk: () => void;
	prevChunk: () => void;
	saveVideo: () => Promise<void>;

	// Internal (for CameraStage integration)
	getPlaybackVideo: () => HTMLVideoElement | null;
}

// ===== Hook implementation =====

export function useDiskTimeMachine({
	videoRef,
	enabled,
	chunkDurationMs = 2000,
	maxChunks = 30,
	diskBufferService = DiskBufferService,
	deviceService = DeviceService,
	mediaRecorderService = MediaRecorderService,
}: DiskTimeMachineConfig): DiskTimeMachineControls {
	// Recording state
	const [isRecording, setIsRecording] = useState(false);
	const [chunkCount, setChunkCount] = useState(0);
	const [previews, setPreviews] = useState<ChunkPreview[]>([]);
	const [recordingError, setRecordingError] = useState<string | null>(null);

	// Playback state
	const [isReplaying, setIsReplaying] = useState(false);
	const [isPlaying, setIsPlaying] = useState(false);
	const [currentChunkIndex, setCurrentChunkIndex] = useState(0);

	// Export state
	const [isExporting, setIsExporting] = useState(false);
	const [exportProgress, setExportProgress] = useState(0);

	// Refs
	const recordingSessionRef = useRef<RecordingSession | null>(null);
	const recordingIntervalRef = useRef<number | null>(null);
	const playbackVideoRef = useRef<HTMLVideoElement | null>(null);
	const chunksRef = useRef<{ id: number; blob: Blob; timestamp: number }[]>([]);

	// Initialize database on mount
	useEffect(() => {
		diskBufferService.init().catch((err) => {
			console.error("Failed to initialize storage:", err);
			setRecordingError(
				"Storage unavailable - time machine disabled. This may happen in private browsing mode.",
			);
		});
	}, [diskBufferService]);

	// Load existing chunks on mount
	useEffect(() => {
		async function loadExisting() {
			try {
				const existingPreviews = await diskBufferService.getPreviews();
				setPreviews(existingPreviews);
				setChunkCount(existingPreviews.length);
			} catch (err) {
				console.error("Failed to load existing chunks:", err);
				setRecordingError(
					"Could not load saved recordings - storage may be corrupted",
				);
			}
		}
		loadExisting();
	}, [diskBufferService]);

	// Start a new recording chunk
	const startRecordingChunk = useCallback(() => {
		const video = videoRef.current;
		if (!video || !video.srcObject) return;

		const stream = video.srcObject as MediaStream;

		try {
			const session = mediaRecorderService.startRecording(stream, {
				videoBitsPerSecond: 2500000, // 2.5 Mbps
			});

			const startTimestamp = Date.now();

			// Set up callback to save chunk when recording stops
			const originalStop = session.stop.bind(session);
			session.stop = async () => {
				const result = await originalStop();

				try {
					// Extract preview frame
					const preview = await mediaRecorderService.extractPreviewFrame(
						result.blob,
					);

					// Save to IndexedDB
					await diskBufferService.saveChunk({
						blob: result.blob,
						preview,
						timestamp: startTimestamp,
						duration: result.duration,
					});

					// Prune old chunks
					await diskBufferService.pruneOldChunks(maxChunks);

					// Update state
					const updatedPreviews = await diskBufferService.getPreviews();
					setPreviews(updatedPreviews);
					setChunkCount(updatedPreviews.length);

					// Update local cache
					chunksRef.current = (await diskBufferService.getAllChunks()).map(
						(c) => ({
							id: c.id!,
							blob: c.blob,
							timestamp: c.timestamp,
						}),
					);
				} catch (err) {
					console.error("Failed to save chunk:", err);
					setRecordingError(
						"Storage full - some video data may be lost. Free up space or reduce buffer size.",
					);
				}

				return result;
			};

			session.start();
			recordingSessionRef.current = session;
			setRecordingError(null);
		} catch (err) {
			console.error("Failed to start MediaRecorder:", err);
			setRecordingError("Recording failed - check camera connection");
			setIsRecording(false);
		}
	}, [videoRef, diskBufferService, maxChunks, mediaRecorderService]);

	// Stop current recording chunk
	const stopRecordingChunk = useCallback(() => {
		const session = recordingSessionRef.current;
		if (session && session.getState() === "recording") {
			try {
				session.stop();
			} catch (err) {
				console.error("Failed to stop recording chunk:", err);
			} finally {
				recordingSessionRef.current = null;
			}
		}
	}, []);

	// Recording loop: start new chunk every chunkDurationMs
	useEffect(() => {
		if (!enabled || isReplaying) {
			// Stop recording when disabled or in replay mode
			stopRecordingChunk();
			if (recordingIntervalRef.current) {
				clearInterval(recordingIntervalRef.current);
				recordingIntervalRef.current = null;
			}
			setIsRecording(false);
			return;
		}

		// Wait for video to be ready
		const video = videoRef.current;
		if (!video || video.readyState < 3) {
			let attempts = 0;
			const MAX_ATTEMPTS = 50; // 5 seconds
			const checkReady = setInterval(() => {
				if (videoRef.current && videoRef.current.readyState >= 3) {
					clearInterval(checkReady);
					// Start recording
					startRecordingChunk();
					setIsRecording(true);

					// Set up interval for chunk rotation
					recordingIntervalRef.current = window.setInterval(() => {
						stopRecordingChunk();
						startRecordingChunk();
					}, chunkDurationMs);
				} else if (++attempts >= MAX_ATTEMPTS) {
					clearInterval(checkReady);
					setRecordingError("Camera not ready - recording could not start");
					console.error("Video element never became ready for recording");
				}
			}, 100);

			return () => clearInterval(checkReady);
		}

		// Video is ready, start recording immediately
		startRecordingChunk();
		setIsRecording(true);

		// Set up interval for chunk rotation
		recordingIntervalRef.current = window.setInterval(() => {
			stopRecordingChunk();
			startRecordingChunk();
		}, chunkDurationMs);

		return () => {
			stopRecordingChunk();
			if (recordingIntervalRef.current) {
				clearInterval(recordingIntervalRef.current);
				recordingIntervalRef.current = null;
			}
			// Cleanup playback video blob URL on unmount
			if (
				playbackVideoRef.current?.src &&
				playbackVideoRef.current.src.startsWith("blob:")
			) {
				mediaRecorderService.revokeObjectUrl(playbackVideoRef.current.src);
			}
		};
	}, [
		enabled,
		isReplaying,
		chunkDurationMs,
		videoRef,
		startRecordingChunk,
		stopRecordingChunk,
		mediaRecorderService,
	]);

	// Playback: load chunk into video element
	const loadChunkForPlayback = useCallback(
		async (index: number) => {
			if (index < 0 || index >= chunksRef.current.length) return;

			const chunk = chunksRef.current[index];
			if (!chunk) return;

			// Get or create playback video element
			if (!playbackVideoRef.current) {
				playbackVideoRef.current = mediaRecorderService.createPlaybackElement();
			}

			const video = playbackVideoRef.current;

			// Load blob (automatically revokes previous URL)
			mediaRecorderService.loadBlob(video, chunk.blob);

			// Set up auto-advance to next chunk
			video.onended = () => {
				setCurrentChunkIndex((prev) => {
					const next = prev + 1;
					if (next >= chunksRef.current.length) {
						// Loop back to beginning
						return 0;
					}
					return next;
				});
			};

			if (isPlaying) {
				video.play().catch((err) => {
					console.error("Playback failed:", err);
					setRecordingError("Playback failed - video may be corrupted");
					setIsPlaying(false);
				});
			}
		},
		[isPlaying, mediaRecorderService],
	);

	// When chunk index changes during replay, load the new chunk
	useEffect(() => {
		if (isReplaying) {
			loadChunkForPlayback(currentChunkIndex);
		}
	}, [currentChunkIndex, isReplaying, loadChunkForPlayback]);

	// Play/pause control
	useEffect(() => {
		if (!isReplaying || !playbackVideoRef.current) return;

		if (isPlaying) {
			playbackVideoRef.current.play().catch((err) => {
				console.error("Playback failed:", err);
				setRecordingError("Playback failed - video may be corrupted");
				setIsPlaying(false);
			});
		} else {
			playbackVideoRef.current.pause();
		}
	}, [isPlaying, isReplaying]);

	// Controls
	const enterReplay = useCallback(async () => {
		if (chunkCount === 0) return;

		try {
			// Load all chunks for playback
			const allChunks = await diskBufferService.getAllChunks();
			chunksRef.current = allChunks.map((c) => ({
				id: c.id!,
				blob: c.blob,
				timestamp: c.timestamp,
			}));

			setIsReplaying(true);
			setIsPlaying(true);
			setCurrentChunkIndex(0);
		} catch (err) {
			console.error("Failed to enter replay mode:", err);
			setRecordingError(
				"Could not load replay data - storage may be corrupted",
			);
		}
	}, [chunkCount, diskBufferService]);

	const exitReplay = useCallback(() => {
		setIsReplaying(false);
		setIsPlaying(false);

		// Clean up playback video
		if (playbackVideoRef.current) {
			playbackVideoRef.current.pause();
			if (playbackVideoRef.current.src) {
				mediaRecorderService.revokeObjectUrl(playbackVideoRef.current.src);
			}
			playbackVideoRef.current.src = "";
		}
	}, [mediaRecorderService]);

	const play = useCallback(() => setIsPlaying(true), []);
	const pause = useCallback(() => setIsPlaying(false), []);

	const seekToChunk = useCallback((index: number) => {
		const clampedIndex = Math.max(
			0,
			Math.min(index, chunksRef.current.length - 1),
		);
		setCurrentChunkIndex(clampedIndex);
	}, []);

	const nextChunk = useCallback(() => {
		setCurrentChunkIndex((prev) => {
			const next = prev + 1;
			if (next >= chunksRef.current.length) return 0;
			return next;
		});
	}, []);

	const prevChunk = useCallback(() => {
		setCurrentChunkIndex((prev) => {
			const next = prev - 1;
			if (next < 0) return chunksRef.current.length - 1;
			return next;
		});
	}, []);

	const saveVideo = useCallback(async () => {
		if (isExporting) return; // Prevent double-clicks

		setIsExporting(true);
		setExportProgress(0);

		try {
			const blob = await diskBufferService.exportVideo((progress) => {
				setExportProgress(progress);
			});

			if (blob.size === 0) {
				setIsExporting(false);
				setRecordingError(
					"No video data to export - record some footage first",
				);
				return;
			}

			const filename = `magic-monitor-replay-${new Date().toISOString().slice(0, 19).replace(/:/g, "-")}.webm`;
			const url = URL.createObjectURL(blob);
			deviceService.downloadDataUrl(url, filename);
			URL.revokeObjectURL(url);
		} catch (err) {
			console.error("Export failed:", err);
			setRecordingError("Export failed - please try again");
		} finally {
			setIsExporting(false);
			setExportProgress(0);
		}
	}, [diskBufferService, deviceService, isExporting]);

	// Calculate durations
	const totalDuration = (chunkCount * chunkDurationMs) / 1000;
	const currentTime = (currentChunkIndex * chunkDurationMs) / 1000;

	// Expose playback video for CameraStage to use
	// We'll add this to the returned controls object as a ref
	const getPlaybackVideo = useCallback(() => playbackVideoRef.current, []);

	return {
		// State
		isRecording,
		isReplaying,
		isPlaying,
		chunkCount,
		currentChunkIndex,
		totalDuration,
		currentTime,
		previews,
		recordingError,
		isExporting,
		exportProgress,

		// Controls
		enterReplay,
		exitReplay,
		play,
		pause,
		seekToChunk,
		nextChunk,
		prevChunk,
		saveVideo,

		// Internal (for CameraStage integration)
		getPlaybackVideo,
	};
}

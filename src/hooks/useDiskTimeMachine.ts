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

// ===== Types =====

export interface DiskTimeMachineConfig {
	videoRef: React.RefObject<HTMLVideoElement | null>;
	enabled: boolean;
	chunkDurationMs?: number; // Default: 2000 (2 seconds)
	maxChunks?: number; // Default: 30 (60 seconds total)
	// Dependency injection for testing
	diskBufferService?: DiskBufferServiceType;
	deviceService?: DeviceServiceType;
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
	isFFmpegReady: boolean; // True when FFmpeg.wasm is loaded

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

// ===== Utility functions =====

/**
 * Extract the first frame of a video blob as a JPEG data URL.
 */
async function extractPreviewFrame(blob: Blob): Promise<string> {
	return new Promise((resolve, reject) => {
		const video = document.createElement("video");
		video.muted = true;
		video.playsInline = true;

		const blobUrl = URL.createObjectURL(blob);
		video.src = blobUrl;

		video.onloadeddata = () => {
			// Seek to the beginning to ensure we get the first frame
			video.currentTime = 0;
		};

		video.onseeked = () => {
			try {
				const canvas = document.createElement("canvas");
				canvas.width = video.videoWidth;
				canvas.height = video.videoHeight;

				const ctx = canvas.getContext("2d");
				if (!ctx) {
					URL.revokeObjectURL(blobUrl);
					reject(new Error("Could not get canvas context"));
					return;
				}

				ctx.drawImage(video, 0, 0);
				const dataUrl = canvas.toDataURL("image/jpeg", 0.7);

				URL.revokeObjectURL(blobUrl);
				resolve(dataUrl);
			} catch (err) {
				URL.revokeObjectURL(blobUrl);
				reject(err);
			}
		};

		video.onerror = () => {
			URL.revokeObjectURL(blobUrl);
			reject(new Error("Failed to load video for preview extraction"));
		};

		video.load();
	});
}

// ===== Hook implementation =====

export function useDiskTimeMachine({
	videoRef,
	enabled,
	chunkDurationMs = 2000,
	maxChunks = 30,
	diskBufferService = DiskBufferService,
	deviceService = DeviceService,
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
	const [isFFmpegReady, setIsFFmpegReady] = useState(false);

	// Refs
	const mediaRecorderRef = useRef<MediaRecorder | null>(null);
	const recordingIntervalRef = useRef<number | null>(null);
	const playbackVideoRef = useRef<HTMLVideoElement | null>(null);
	const chunksRef = useRef<{ id: number; blob: Blob; timestamp: number }[]>([]);

	// Initialize database on mount
	useEffect(() => {
		diskBufferService.init().catch(console.error);
	}, [diskBufferService]);

	// Preload FFmpeg in background (for faster first export)
	useEffect(() => {
		// Lazy import and preload after a short delay to not block initial render
		const timer = setTimeout(async () => {
			const { FFmpegService } = await import("../services/FFmpegService");
			// Check if already loaded (from previous session/cache)
			if (FFmpegService.isLoaded()) {
				setIsFFmpegReady(true);
				return;
			}
			FFmpegService.preload()
				.then(() => setIsFFmpegReady(true))
				.catch(() => {
					// Silently ignore preload failures - will show error on actual export
				});
		}, 3000);
		return () => clearTimeout(timer);
	}, []);

	// Load existing chunks on mount
	useEffect(() => {
		async function loadExisting() {
			const existingPreviews = await diskBufferService.getPreviews();
			setPreviews(existingPreviews);
			setChunkCount(existingPreviews.length);
		}
		loadExisting();
	}, [diskBufferService]);

	// Start a new recording chunk
	const startRecordingChunk = useCallback(() => {
		const video = videoRef.current;
		if (!video || !video.srcObject) return;

		const stream = video.srcObject as MediaStream;

		// Determine best codec
		const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
			? "video/webm;codecs=vp9"
			: "video/webm";

		const recorder = new MediaRecorder(stream, {
			mimeType,
			videoBitsPerSecond: 2500000, // 2.5 Mbps
		});

		const chunks: Blob[] = [];
		const startTimestamp = Date.now();

		recorder.ondataavailable = (e) => {
			if (e.data.size > 0) {
				chunks.push(e.data);
			}
		};

		recorder.onstop = async () => {
			if (chunks.length === 0) return;

			const blob = new Blob(chunks, { type: mimeType });
			const duration = Date.now() - startTimestamp;

			try {
				// Extract preview frame
				const preview = await extractPreviewFrame(blob);

				// Save to IndexedDB
				await diskBufferService.saveChunk({
					blob,
					preview,
					timestamp: startTimestamp,
					duration,
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
			}
		};

		try {
			recorder.start();
			mediaRecorderRef.current = recorder;
			setRecordingError(null);
		} catch (err) {
			console.error("Failed to start MediaRecorder:", err);
			setRecordingError("Recording failed - check camera connection");
		}
	}, [videoRef, diskBufferService, maxChunks]);

	// Stop current recording chunk
	const stopRecordingChunk = useCallback(() => {
		if (
			mediaRecorderRef.current &&
			mediaRecorderRef.current.state === "recording"
		) {
			mediaRecorderRef.current.stop();
			mediaRecorderRef.current = null;
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
		};
	}, [
		enabled,
		isReplaying,
		chunkDurationMs,
		videoRef,
		startRecordingChunk,
		stopRecordingChunk,
	]);

	// Playback: load chunk into video element
	const loadChunkForPlayback = useCallback(
		async (index: number) => {
			if (index < 0 || index >= chunksRef.current.length) return;

			const chunk = chunksRef.current[index];
			if (!chunk) return;

			// Get or create playback video element
			if (!playbackVideoRef.current) {
				playbackVideoRef.current = document.createElement("video");
				playbackVideoRef.current.muted = true;
				playbackVideoRef.current.playsInline = true;
			}

			const video = playbackVideoRef.current;

			// Revoke previous blob URL if any
			if (video.src?.startsWith("blob:")) {
				URL.revokeObjectURL(video.src);
			}

			const blobUrl = URL.createObjectURL(chunk.blob);
			video.src = blobUrl;

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

			await video.load();
			if (isPlaying) {
				video.play().catch(console.error);
			}
		},
		[isPlaying],
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
			playbackVideoRef.current.play().catch(console.error);
		} else {
			playbackVideoRef.current.pause();
		}
	}, [isPlaying, isReplaying]);

	// Controls
	const enterReplay = useCallback(async () => {
		if (chunkCount === 0) return;

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
	}, [chunkCount, diskBufferService]);

	const exitReplay = useCallback(() => {
		setIsReplaying(false);
		setIsPlaying(false);

		// Clean up playback video
		if (playbackVideoRef.current) {
			playbackVideoRef.current.pause();
			if (playbackVideoRef.current.src?.startsWith("blob:")) {
				URL.revokeObjectURL(playbackVideoRef.current.src);
			}
			playbackVideoRef.current.src = "";
		}
	}, []);

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
		isFFmpegReady,

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

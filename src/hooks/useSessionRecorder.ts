import { useCallback, useEffect, useRef, useState } from "react";
import {
	type NotRecordingReason,
	SessionRecorderMachine,
	type SessionRecorderState,
} from "../machines/SessionRecorderMachine";
import {
	MediaRecorderService,
	type MediaRecorderServiceType,
} from "../services/MediaRecorderService";
import {
	SessionStorageService,
	type SessionStorageServiceType,
} from "../services/SessionStorageService";
import { TimerService, type TimerServiceType } from "../services/TimerService";
import {
	VideoFixService,
	type VideoFixServiceType,
} from "../services/VideoFixService";
import type { PracticeSession, SessionThumbnail } from "../types/sessions";
import { SESSION_CONFIG } from "../types/sessions";
import { useBlockRecorder } from "./useBlockRecorder";
import { useBlockRotation } from "./useBlockRotation";
import { useLatest } from "./useLatest";
import { useSessionList } from "./useSessionList";
import { useThumbnailCapture } from "./useThumbnailCapture";

// ===== Types =====

export interface SessionRecorderConfig {
	videoRef: React.RefObject<HTMLVideoElement | null>;
	enabled: boolean;
	blockDurationMs?: number;
	thumbnailIntervalMs?: number;
	// Dependency injection for testing
	sessionStorageService?: SessionStorageServiceType;
	mediaRecorderService?: MediaRecorderServiceType;
	videoFixService?: VideoFixServiceType;
	timerService?: TimerServiceType;
}

export interface SessionRecorderControls {
	// State
	isRecording: boolean;
	notRecordingReason: NotRecordingReason | null;
	currentBlockDuration: number; // seconds into current block
	currentThumbnails: SessionThumbnail[]; // thumbnails captured so far
	error: string | null;

	// Sessions
	recentSessions: PracticeSession[];
	savedSessions: PracticeSession[];

	// Controls
	stopCurrentBlock: (options?: {
		disable?: boolean;
	}) => Promise<PracticeSession | null>;
	refreshSessions: () => Promise<void>;
}

// ===== Hook implementation =====

/**
 * Orchestrator hook for Practice Session recording.
 * Uses SessionRecorderMachine for state management,
 * delegates to focused hooks for individual concerns.
 */
export function useSessionRecorder({
	videoRef,
	enabled,
	blockDurationMs = SESSION_CONFIG.BLOCK_DURATION_MS,
	thumbnailIntervalMs = SESSION_CONFIG.THUMBNAIL_INTERVAL_MS,
	sessionStorageService = SessionStorageService,
	mediaRecorderService = MediaRecorderService,
	videoFixService = VideoFixService,
	timerService = TimerService,
}: SessionRecorderConfig): SessionRecorderControls {
	// State exposed to consumers
	const [isRecording, setIsRecording] = useState(false);
	const [notRecordingReason, setNotRecordingReason] =
		useState<NotRecordingReason | null>(null);
	const [currentBlockDuration, setCurrentBlockDuration] = useState(0);

	// Duration tracking
	const durationTimerRef = useRef<number | null>(null);
	const blockStartTimeRef = useRef<number>(0);

	// Create machine with callbacks that use refs (so they're always current)
	const machineRef = useRef<SessionRecorderMachine | null>(null);

	// Mid-block recorder death callback (M1)
	const onRecorderFailure = useCallback(
		(salvaged: { blob: Blob; duration: number } | null) => {
			machineRef.current?.recorderFailed(salvaged);
		},
		[],
	);

	// Use focused hooks for individual concerns
	const blockRecorder = useBlockRecorder({
		videoRef,
		mediaRecorderService,
		timerService,
		onRecorderFailure,
	});
	const { startRecording, stopRecording } = blockRecorder;

	const thumbnailCapture = useThumbnailCapture({
		videoRef,
		thumbnailIntervalMs,
		timerService,
	});
	const { startCapture, stopCapture } = thumbnailCapture;

	const sessionList = useSessionList({
		sessionStorageService,
		videoFixService,
	});
	const { saveBlock, refreshSessions, isInitialized, initFailed } = sessionList;

	// Latest-callback refs so the machine never needs to be recreated
	const startRecordingRef = useLatest(startRecording);
	const stopRecordingRef = useLatest(stopRecording);
	const startCaptureRef = useLatest(startCapture);
	const stopCaptureRef = useLatest(stopCapture);
	const saveBlockRef = useLatest(saveBlock);

	// Block rotation callback
	const onBlockComplete = useCallback(async () => {
		machineRef.current?.blockTimerFired();
	}, []);

	const blockRotation = useBlockRotation({
		blockDurationMs,
		onBlockComplete,
		timerService,
	});
	const { startRotation, stopRotation } = blockRotation;

	const startRotationRef = useLatest(startRotation);
	const stopRotationRef = useLatest(stopRotation);

	// Initialize machine once
	useEffect(() => {
		if (machineRef.current === null) {
			machineRef.current = new SessionRecorderMachine({
				onStartRecording: () => startRecordingRef.current(),
				onStopRecording: () => stopRecordingRef.current(),
				onStartThumbnails: (blockStartTime: number) =>
					startCaptureRef.current(blockStartTime),
				onStopThumbnails: () => stopCaptureRef.current(),
				onStartBlockTimer: () => startRotationRef.current(),
				onStopBlockTimer: () => stopRotationRef.current(),
				onSaveBlock: async (
					blob: Blob,
					duration: number,
					thumbnails: SessionThumbnail[],
					blockStartTime: number,
				) => {
					return saveBlockRef.current(
						blob,
						duration,
						thumbnails,
						blockStartTime,
					);
				},
				onStateChange: (state: SessionRecorderState) => {
					setIsRecording(state.type === "recording");
					if (state.type === "recording") {
						blockStartTimeRef.current = state.blockStart;
					}
					setNotRecordingReason(
						machineRef.current?.getNotRecordingReason() ?? null,
					);
				},
				now: () => timerService.now(),
			});
		}
	}, [timerService]);

	// Duration timer effect - updates display while recording
	useEffect(() => {
		if (isRecording) {
			durationTimerRef.current = timerService.setInterval(() => {
				const elapsed = (timerService.now() - blockStartTimeRef.current) / 1000;
				setCurrentBlockDuration(elapsed);
			}, 1000);
		} else {
			if (durationTimerRef.current) {
				timerService.clearInterval(durationTimerRef.current);
				durationTimerRef.current = null;
			}
			// Reset duration display when recording stops - intentional synchronous setState
			// eslint-disable-next-line react-hooks/set-state-in-effect
			setCurrentBlockDuration(0);
		}

		return () => {
			if (durationTimerRef.current) {
				timerService.clearInterval(durationTimerRef.current);
				durationTimerRef.current = null;
			}
		};
	}, [isRecording, timerService]);

	// Storage initialization effect: only genuine init failure kills recording.
	// Save/refresh errors stay in sessionList.error for display (M8).
	useEffect(() => {
		if (initFailed) {
			machineRef.current?.storageInitFailed();
		} else if (isInitialized) {
			machineRef.current?.storageInitialized();
		}
	}, [initFailed, isInitialized]);

	// Video readiness + stream-change detection (bidirectional, H4).
	// The interval runs for the hook's lifetime: readiness can be lost (device
	// unplugged) and srcObject can be swapped (camera/resolution switch).
	const lastSrcObjectRef = useRef<MediaStream | null>(null);
	useEffect(() => {
		const check = () => {
			const video = videoRef.current;
			const isReady = !!video && video.readyState >= 3;
			const srcObject = (video?.srcObject as MediaStream | null) ?? null;

			const streamChanged =
				lastSrcObjectRef.current !== null &&
				srcObject !== lastSrcObjectRef.current;
			lastSrcObjectRef.current = srcObject;

			if (streamChanged) {
				// Stop + save the in-flight block; the old clone's tracks are
				// released. The next tick reports the new stream's readiness and
				// the machine resumes on its own.
				machineRef.current?.videoNotReady();
				return;
			}
			if (isReady) {
				machineRef.current?.videoIsReady();
			} else {
				machineRef.current?.videoNotReady();
			}
		};

		check();
		const intervalId = timerService.setInterval(check, 250);
		return () => {
			timerService.clearInterval(intervalId);
		};
	}, [videoRef, timerService]);

	// Enable/disable effect - reacts to prop changes
	useEffect(() => {
		if (enabled) {
			machineRef.current?.enable();
		} else {
			machineRef.current?.disable();
		}
		// enable()/disable() don't always change state (e.g. StrictMode
		// double-invokes this effect and the second enable() early-returns),
		// so onStateChange isn't guaranteed to fire - refresh the reason
		// directly. Intentional synchronous setState.
		// eslint-disable-next-line react-hooks/set-state-in-effect
		setNotRecordingReason(machineRef.current?.getNotRecordingReason() ?? null);
	}, [enabled]);

	// Cleanup on unmount
	useEffect(() => {
		return () => {
			machineRef.current?.disable();
		};
	}, []);

	// Stop current block manually - returns the saved session directly from the machine
	const stopCurrentBlock = useCallback(
		async (options?: {
			disable?: boolean;
		}): Promise<PracticeSession | null> => {
			const session = await machineRef.current?.stopCurrentBlock(options);
			return session ?? null;
		},
		[],
	);

	// Combine errors from all hooks
	const combinedError = blockRecorder.error || sessionList.error || null;

	return {
		// State
		isRecording,
		notRecordingReason,
		currentBlockDuration,
		currentThumbnails: thumbnailCapture.thumbnails,
		error: combinedError,

		// Sessions
		recentSessions: sessionList.recentSessions,
		savedSessions: sessionList.savedSessions,

		// Controls
		stopCurrentBlock,
		refreshSessions,
	};
}

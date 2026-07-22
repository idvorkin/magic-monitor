import { useCallback, useRef, useState } from "react";
import {
	DeviceService,
	type DeviceServiceType,
} from "../services/DeviceService";
import {
	MediaRecorderService,
	type MediaRecorderServiceType,
	type RecordingSession,
} from "../services/MediaRecorderService";
import { TimerService, type TimerServiceType } from "../services/TimerService";
import { SESSION_CONFIG } from "../types/sessions";
import { useLatest } from "./useLatest";

export interface BlockRecorderConfig {
	videoRef: React.RefObject<HTMLVideoElement | null>;
	mediaRecorderService?: MediaRecorderServiceType;
	timerService?: TimerServiceType;
	deviceService?: DeviceServiceType;
	/** Fires when the active recorder dies mid-block (after local cleanup). */
	onRecorderFailure?: (
		salvaged: { blob: Blob; duration: number } | null,
	) => void;
}

export interface StopRecordingOptions {
	/** Skip state updates - use during cleanup/unmount */
	forCleanup?: boolean;
}

export interface BlockRecorderControls {
	isRecording: boolean;
	error: string | null;
	startRecording: () => void;
	stopRecording: (options?: StopRecordingOptions) => Promise<{ blob: Blob; duration: number } | null>;
	getState: () => RecordingState;
}

/**
 * Get the appropriate video bitrate based on device type.
 * Mobile devices use lower bitrate to reduce encoder strain.
 */
function getVideoBitrate(deviceService: DeviceServiceType): number {
	return deviceService.isMobileDevice()
		? SESSION_CONFIG.VIDEO_BITRATE_MOBILE
		: SESSION_CONFIG.VIDEO_BITRATE_DESKTOP;
}

/**
 * Hook for managing MediaRecorder lifecycle (start/stop recording).
 * Single Responsibility: MediaRecorder session management.
 */
export function useBlockRecorder({
	videoRef,
	mediaRecorderService = MediaRecorderService,
	timerService = TimerService,
	deviceService = DeviceService,
	onRecorderFailure,
}: BlockRecorderConfig): BlockRecorderControls {
	const [isRecording, setIsRecording] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const recordingSessionRef = useRef<RecordingSession | null>(null);
	const blockStartTimeRef = useRef<number>(0);
	const clonedStreamRef = useRef<MediaStream | null>(null); // Track cloned stream for cleanup
	// Generation token: each start owns a generation; a stale stop resolving
	// after a newer start must not touch the newer block's refs (H3).
	const generationRef = useRef(0);
	const onRecorderFailureRef = useLatest(onRecorderFailure);

	// Helper to clean up cloned stream
	const cleanupClonedStream = useCallback(() => {
		if (clonedStreamRef.current) {
			// Stop all tracks to release encoder resources
			clonedStreamRef.current.getTracks().forEach((track) => track.stop());
			clonedStreamRef.current = null;
		}
	}, []);

	const startRecording = useCallback(() => {
		// A previous block's clone is ours to release before cloning anew —
		// the stale stop no longer cleans up across generations.
		cleanupClonedStream();

		const video = videoRef.current;
		if (!video || !video.srcObject) {
			setError("Camera not available");
			return;
		}

		// Clone the stream for recording to avoid affecting the main video display
		// This prevents encoder state from impacting MediaPipe hand tracking
		const originalStream = video.srcObject as MediaStream;
		const stream = originalStream.clone();
		clonedStreamRef.current = stream; // Store for cleanup on stop

		// Validate stream health before attempting to record
		if (!stream.active) {
			setError("Camera stream is not active. Try refreshing the page.");
			return;
		}

		const videoTracks = stream.getVideoTracks();
		if (videoTracks.length === 0) {
			setError("No video track available from camera.");
			return;
		}

		const liveTrack = videoTracks.find((t) => t.readyState === "live");
		if (!liveTrack) {
			setError("Camera video track has ended. Try selecting a different camera.");
			return;
		}

		try {
			// Captured here (not read from the ref) so the onFailure closure
			// below can compare against the generation this block was started
			// under — reading generationRef.current at failure time would
			// compare it to itself and never detect staleness. Assigned just
			// before recordingSessionRef.current below: if this call, or
			// session.start() next, bails out first, generation stays -1
			// (never a real generation) so a stale in-flight stop from a
			// previous block still cleans up correctly, and this closure
			// safely no-ops if it somehow fired for a session that never
			// fully established.
			let generation = -1;
			const session = mediaRecorderService.startRecording(stream, {
				videoBitsPerSecond: getVideoBitrate(deviceService),
				onFailure: (salvaged) => {
					if (generationRef.current !== generation) return; // a dead PAST block is old news
					recordingSessionRef.current = null;
					cleanupClonedStream();
					setIsRecording(false);
					setError("Recording failed mid-block");
					onRecorderFailureRef.current?.(salvaged);
				},
			});

			blockStartTimeRef.current = timerService.now();
			setError(null);

			// Wrap session.start() in try-catch to handle MediaRecorder failures
			try {
				session.start();
			} catch (startErr) {
				const errorMessage =
					startErr instanceof Error
						? startErr.message
						: "Failed to start recording";
				// Log diagnostic info to help debug MediaRecorder failures
				console.error("MediaRecorder.start() failed:", startErr);
				console.error("[MediaRecorder Debug]", {
					streamActive: stream.active,
					videoTracks: stream.getVideoTracks().map((t) => ({
						id: t.id,
						label: t.label,
						readyState: t.readyState,
						enabled: t.enabled,
						muted: t.muted,
					})),
					audioTracks: stream.getAudioTracks().length,
					mimeType: mediaRecorderService.getBestCodec(),
				});
				setError(errorMessage);
				setIsRecording(false);
				return;
			}

			// This block is now live: advance the generation so a stale stop
			// from a previous block can no longer touch these refs (H3), and
			// so this block's own onFailure closure above recognizes itself.
			generation = ++generationRef.current;
			recordingSessionRef.current = session;
			setIsRecording(true);
		} catch (err) {
			console.error("Failed to create recording session:", err);
			setError("Recording failed - check camera connection");
			setIsRecording(false);
		}
	}, [
		videoRef,
		mediaRecorderService,
		timerService,
		deviceService,
		cleanupClonedStream,
		onRecorderFailureRef,
	]);

	const stopRecording = useCallback(
		async (options?: StopRecordingOptions): Promise<{ blob: Blob; duration: number } | null> => {
			const { forCleanup = false } = options ?? {};
			const generation = generationRef.current;
			const session = recordingSessionRef.current;
			if (!session || session.getState() !== "recording") {
				cleanupClonedStream();
				return null;
			}

			try {
				const result = await session.stop();
				if (generationRef.current === generation) {
					recordingSessionRef.current = null;
					cleanupClonedStream(); // Release cloned stream tracks
					// Skip state updates during cleanup to avoid setState on unmount
					if (!forCleanup) {
						setIsRecording(false);
					}
				}
				return result;
			} catch (err) {
				console.error("Failed to stop recording:", err);
				if (generationRef.current === generation) {
					recordingSessionRef.current = null;
					cleanupClonedStream(); // Cleanup on error too
					// Skip state updates during cleanup to avoid setState on unmount
					if (!forCleanup) {
						setError("Recording may have been lost - please try again");
						setIsRecording(false);
					}
				}
				return null;
			}
		},
		[cleanupClonedStream],
	);

	const getState = useCallback(() => {
		return recordingSessionRef.current?.getState() ?? "inactive";
	}, []);

	return {
		isRecording,
		error,
		startRecording,
		stopRecording,
		getState,
	};
}

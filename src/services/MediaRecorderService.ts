/**
 * Humble Object for MediaRecorder and related browser APIs.
 * Isolates MediaRecorder, URL.createObjectURL, canvas operations for testability.
 */

export interface RecordingChunk {
	blob: Blob;
	duration: number;
}

export interface MediaRecorderConfig {
	videoBitsPerSecond?: number;
	/**
	 * Fires when the recorder dies mid-block (error event, or a stop that was
	 * never requested). Salvage is best-effort and usually null - without a
	 * timeslice no chunks exist until stop.
	 */
	onFailure?: (salvaged: RecordingChunk | null) => void;
}

export interface RecordingSession {
	start: () => void;
	stop: () => Promise<RecordingChunk>;
	getState: () => RecordingState;
}

export const MediaRecorderService = {
	/**
	 * Check if a MIME type is supported by MediaRecorder.
	 */
	isTypeSupported(mimeType: string): boolean {
		return (
			typeof MediaRecorder !== "undefined" &&
			MediaRecorder.isTypeSupported(mimeType)
		);
	},

	/**
	 * Detect if running on iOS Safari.
	 * iOS Safari lies about WebM support in isTypeSupported() - it reports true
	 * but cannot actually play back WebM videos. We must force MP4 on iOS.
	 */
	isIOSSafari(): boolean {
		const ua = navigator.userAgent;
		const isIOS = /iPad|iPhone|iPod/.test(ua);
		const isSafari = /Safari/.test(ua) && !/Chrome/.test(ua);
		return isIOS && isSafari;
	},

	/**
	 * Get the best supported video codec.
	 * iOS Safari requires MP4 (doesn't support WebM playback despite isTypeSupported lying).
	 * Other browsers prefer WebM with VP9 for better compression.
	 */
	getBestCodec(): string {
		// iOS Safari MUST use MP4 - it lies about WebM support in isTypeSupported
		// but cannot play back WebM videos (fails with "format not supported")
		if (this.isIOSSafari()) {
			if (this.isTypeSupported("video/mp4;codecs=avc1.42E01E")) {
				return "video/mp4;codecs=avc1.42E01E";
			}
			if (this.isTypeSupported("video/mp4;codecs=avc1")) {
				return "video/mp4;codecs=avc1";
			}
			if (this.isTypeSupported("video/mp4")) {
				return "video/mp4";
			}
			// Let iOS pick - it will use MP4
			console.warn(
				"[MediaRecorder] No specific MP4 codec detected as supported on iOS, letting browser pick",
			);
			return "";
		}

		// Non-iOS: Try WebM with VP9 first (best compression, works on Chrome/Firefox/Edge)
		if (this.isTypeSupported("video/webm;codecs=vp9")) {
			return "video/webm;codecs=vp9";
		}
		// Try plain WebM (broader browser support)
		if (this.isTypeSupported("video/webm")) {
			return "video/webm";
		}
		// Try MP4 with H.264 baseline profile
		// avc1.42E01E = H.264 Baseline Profile Level 3.0 (widely compatible)
		if (this.isTypeSupported("video/mp4;codecs=avc1.42E01E")) {
			return "video/mp4;codecs=avc1.42E01E";
		}
		if (this.isTypeSupported("video/mp4;codecs=avc1")) {
			return "video/mp4;codecs=avc1";
		}
		if (this.isTypeSupported("video/mp4")) {
			return "video/mp4";
		}
		// Last resort - let browser pick
		console.warn(
			"[MediaRecorder] No supported codec detected, letting browser pick",
		);
		return "";
	},

	/**
	 * Start recording from a MediaStream.
	 * Returns a recording session with start/stop/getState methods.
	 */
	startRecording(
		stream: MediaStream,
		config: MediaRecorderConfig = {},
	): RecordingSession {
		const mimeType = this.getBestCodec();

		const recorder = new MediaRecorder(stream, {
			mimeType,
			videoBitsPerSecond: config.videoBitsPerSecond ?? 2500000,
		});

		const chunks: Blob[] = [];
		const startTime = Date.now();

		let stopRequested = false;

		const salvage = (): RecordingChunk | null => {
			if (chunks.length === 0) return null;
			const blob = new Blob(chunks, { type: mimeType });
			chunks.length = 0;
			return { blob, duration: Date.now() - startTime };
		};

		const handleMidBlockDeath = () => {
			if (stopRequested) return; // stop() owns the handlers from here on
			recorder.ondataavailable = null;
			recorder.onstop = null;
			recorder.onerror = null;
			config.onFailure?.(salvage());
		};

		return {
			start: () => {
				recorder.ondataavailable = (e) => {
					if (e.data.size > 0) {
						chunks.push(e.data);
					}
				};

				recorder.onerror = handleMidBlockDeath;
				recorder.onstop = handleMidBlockDeath;

				try {
					recorder.start();
				} catch (err) {
					// Provide a meaningful error message when MediaRecorder.start() fails
					// Common causes: unsupported codec, invalid stream state, no active tracks
					const errorMessage = err instanceof Error ? err.message : String(err);
					throw new Error(
						`Failed to start recording. This may occur if the codec is not supported, the stream is in an invalid state, or there are no active video tracks. Original error: ${errorMessage}`,
					);
				}
			},
			stop: (): Promise<RecordingChunk> => {
				stopRequested = true;
				return new Promise((resolve, reject) => {
					recorder.onstop = () => {
						const blob = new Blob(chunks, { type: mimeType });
						const duration = Date.now() - startTime;
						// Clear chunks array to release memory
						chunks.length = 0;
						// Clear event handlers to help GC
						recorder.ondataavailable = null;
						recorder.onstop = null;
						recorder.onerror = null;
						resolve({ blob, duration });
					};
					recorder.onerror = () => {
						// Clear on error too
						chunks.length = 0;
						recorder.ondataavailable = null;
						recorder.onstop = null;
						recorder.onerror = null;
						reject(new Error("Recording failed"));
					};
					if (recorder.state === "recording") {
						recorder.stop();
					} else {
						reject(new Error("Recorder not in recording state"));
					}
				});
			},
			getState: () => recorder.state,
		};
	},
};

export type MediaRecorderServiceType = typeof MediaRecorderService;

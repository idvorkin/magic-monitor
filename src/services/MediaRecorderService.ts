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
	 * Get the best supported video codec.
	 */
	getBestCodec(): string {
		if (this.isTypeSupported("video/webm;codecs=vp9")) {
			return "video/webm;codecs=vp9";
		}
		return "video/webm";
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

		return {
			start: () => {
				recorder.ondataavailable = (e) => {
					if (e.data.size > 0) {
						chunks.push(e.data);
					}
				};
				recorder.start();
			},
			stop: (): Promise<RecordingChunk> => {
				return new Promise((resolve, reject) => {
					recorder.onstop = () => {
						const blob = new Blob(chunks, { type: mimeType });
						const duration = Date.now() - startTime;
						resolve({ blob, duration });
					};
					recorder.onerror = () => {
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

	/**
	 * Extract first frame of video blob as JPEG data URL.
	 * Isolated for testability.
	 */
	async extractPreviewFrame(blob: Blob): Promise<string> {
		return new Promise((resolve, reject) => {
			const video = document.createElement("video");
			video.muted = true;
			video.playsInline = true;

			const blobUrl = URL.createObjectURL(blob);
			video.src = blobUrl;

			video.onloadeddata = () => {
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
	},

	/**
	 * Create a video element for playback.
	 */
	createPlaybackElement(): HTMLVideoElement {
		const video = document.createElement("video");
		video.muted = true;
		video.playsInline = true;
		return video;
	},

	/**
	 * Load a blob into a video element and return the blob URL.
	 * Automatically revokes previous blob URL if present.
	 */
	loadBlob(video: HTMLVideoElement, blob: Blob): string {
		// Revoke previous blob URL if any
		if (video.src?.startsWith("blob:")) {
			URL.revokeObjectURL(video.src);
		}
		const blobUrl = URL.createObjectURL(blob);
		video.src = blobUrl;
		video.load();
		return blobUrl;
	},

	/**
	 * Revoke a blob URL to free memory.
	 */
	revokeObjectUrl(url: string): void {
		if (url.startsWith("blob:")) {
			URL.revokeObjectURL(url);
		}
	},
};

export type MediaRecorderServiceType = typeof MediaRecorderService;

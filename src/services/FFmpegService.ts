import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile } from "@ffmpeg/util";

// Singleton instance
let ffmpegInstance: FFmpeg | null = null;
let loadPromise: Promise<void> | null = null;
let isLoaded = false;

// Loading state callbacks
type LoadingCallback = (progress: number) => void;
const loadingCallbacks: Set<LoadingCallback> = new Set();

/**
 * FFmpeg service for browser-based video processing.
 * Lazy-loads FFmpeg WASM (~2MB) on first use.
 */
export const FFmpegService = {
	/**
	 * Check if FFmpeg is already loaded.
	 */
	isLoaded(): boolean {
		return isLoaded;
	},

	/**
	 * Subscribe to loading progress updates.
	 * Returns unsubscribe function.
	 */
	onLoadingProgress(callback: LoadingCallback): () => void {
		loadingCallbacks.add(callback);
		return () => loadingCallbacks.delete(callback);
	},

	/**
	 * Preload FFmpeg in the background.
	 * Safe to call multiple times - will only load once.
	 */
	async preload(): Promise<void> {
		if (isLoaded) return;
		if (loadPromise) return loadPromise;

		loadPromise = this._load();
		return loadPromise;
	},

	/**
	 * Internal load implementation.
	 */
	async _load(): Promise<void> {
		if (isLoaded) return;

		ffmpegInstance = new FFmpeg();

		// Track loading progress
		ffmpegInstance.on("progress", ({ progress }) => {
			for (const cb of loadingCallbacks) {
				cb(progress);
			}
		});

		// Load from CDN (smaller bundle, cached by browser)
		const baseURL = "https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm";
		await ffmpegInstance.load({
			coreURL: `${baseURL}/ffmpeg-core.js`,
			wasmURL: `${baseURL}/ffmpeg-core.wasm`,
		});

		isLoaded = true;
	},

	/**
	 * Merge multiple WebM blobs into a single video file.
	 * Uses FFmpeg concat demuxer with -c copy (no re-encoding, fast).
	 *
	 * @param blobs - Array of WebM blobs to merge
	 * @param onProgress - Optional progress callback (0-1)
	 * @returns Merged WebM blob
	 */
	async mergeWebmBlobs(
		blobs: Blob[],
		onProgress?: (progress: number) => void,
	): Promise<Blob> {
		if (blobs.length === 0) {
			return new Blob([], { type: "video/webm" });
		}

		if (blobs.length === 1) {
			return blobs[0];
		}

		// Ensure FFmpeg is loaded
		await this.preload();
		const ffmpeg = ffmpegInstance!;

		// Write all chunks to virtual filesystem
		for (let i = 0; i < blobs.length; i++) {
			const data = await fetchFile(blobs[i]);
			await ffmpeg.writeFile(`chunk${i}.webm`, data);
			onProgress?.((i + 1) / (blobs.length + 2)); // +2 for merge and read steps
		}

		// Create concat list file
		const listContent = blobs.map((_, i) => `file 'chunk${i}.webm'`).join("\n");
		await ffmpeg.writeFile("list.txt", listContent);

		// Merge without re-encoding (fast!)
		await ffmpeg.exec([
			"-f",
			"concat",
			"-safe",
			"0",
			"-i",
			"list.txt",
			"-c",
			"copy",
			"output.webm",
		]);

		onProgress?.((blobs.length + 1) / (blobs.length + 2));

		// Read result
		const data = await ffmpeg.readFile("output.webm");
		onProgress?.(1);

		// Cleanup virtual filesystem
		for (let i = 0; i < blobs.length; i++) {
			await ffmpeg.deleteFile(`chunk${i}.webm`);
		}
		await ffmpeg.deleteFile("list.txt");
		await ffmpeg.deleteFile("output.webm");

		// Convert to Blob (data is Uint8Array for binary files)
		// FFmpeg readFile returns Uint8Array for binary files, string for text
		return new Blob([data as BlobPart], { type: "video/webm" });
	},
};

export type FFmpegServiceType = typeof FFmpegService;

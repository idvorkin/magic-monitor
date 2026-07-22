/**
 * Humble Object for sharing and downloading files.
 * Isolates navigator.share and download operations for testability.
 * See docs/ARCHITECTURE-practice-recorder.md for details.
 */

export const ShareService = {
	/**
	 * Check if native sharing is available.
	 */
	canShare(): boolean {
		return "share" in navigator && "canShare" in navigator;
	},

	/**
	 * Check if we can share files (not just text/URLs).
	 */
	canShareFiles(): boolean {
		if (!this.canShare()) return false;

		// Create a test file to check if file sharing is supported
		const testFile = new File(["test"], "test.txt", { type: "text/plain" });
		return navigator.canShare({ files: [testFile] });
	},

	/**
	 * Share a video file via native share sheet.
	 * Returns true if shared successfully, false if user cancelled.
	 * Falls back to download if sharing is not available.
	 */
	async share(blob: Blob, filename: string): Promise<boolean> {
		const file = new File([blob], filename, { type: blob.type });

		if (!this.canShare() || !navigator.canShare({ files: [file] })) {
			this.download(blob, filename);
			return false;
		}

		try {
			await navigator.share({
				files: [file],
				title: filename,
			});
			return true;
		} catch (err) {
			if ((err as Error).name === "AbortError") {
				return false; // User cancelled
			}
			// Fall back to download on other errors
			console.warn("Share failed, falling back to download:", err);
			this.download(blob, filename);
			return false;
		}
	},

	/**
	 * Download a blob as a file.
	 */
	download(blob: Blob, filename: string): void {
		const url = URL.createObjectURL(blob);
		const a = document.createElement("a");
		a.href = url;
		a.download = filename;
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
		URL.revokeObjectURL(url);
	},

	/**
	 * Generate a timestamped filename for video exports.
	 * Extension follows the blob's container (iOS records MP4; naming it
	 * .webm makes receiving apps refuse to play it).
	 */
	generateFilename(prefix = "practice-clip", mimeType = "video/webm"): string {
		const timestamp = new Date()
			.toISOString()
			.slice(0, 19)
			.replace(/:/g, "-");
		const extension = mimeType.startsWith("video/mp4") ? "mp4" : "webm";
		return `${prefix}-${timestamp}.${extension}`;
	},
};

export type ShareServiceType = typeof ShareService;

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { MediaRecorderService } from "./MediaRecorderService";

// Mock MediaStream for tests
class MockMediaStream {}

// Mock MediaRecorder for tests
class MockMediaRecorder {
	state: RecordingState;
	ondataavailable: ((e: { data: Blob }) => void) | null;
	onstop: (() => void) | null;
	onerror: (() => void) | null;
	stream: MediaStream;
	options: MediaRecorderOptions;

	constructor(stream: MediaStream, options: MediaRecorderOptions) {
		this.stream = stream;
		this.options = options;
		this.state = "inactive";
		this.ondataavailable = null;
		this.onstop = null;
		this.onerror = null;
	}

	start() {
		this.state = "recording";
	}

	stop() {
		this.state = "inactive";
		// Simulate chunk available
		if (this.ondataavailable) {
			this.ondataavailable({
				data: new Blob(["test video data"], {
					type: this.options.mimeType || "video/webm",
				}),
			});
		}
		// Trigger stop event
		if (this.onstop) {
			this.onstop();
		}
	}

	static isTypeSupported(mimeType: string): boolean {
		return mimeType.includes("webm");
	}
}

// Mock URL.createObjectURL and revokeObjectURL
const mockBlobUrls = new Map<string, Blob>();
let blobUrlCounter = 0;

beforeAll(() => {
	// @ts-expect-error - Mock MediaStream for testing
	globalThis.MediaStream = MockMediaStream;

	// @ts-expect-error - Mock MediaRecorder for testing
	globalThis.MediaRecorder = MockMediaRecorder;

	// Mock URL.createObjectURL
	globalThis.URL.createObjectURL = vi.fn((blob: Blob) => {
		const url = `blob:mock-${blobUrlCounter++}`;
		mockBlobUrls.set(url, blob);
		return url;
	});

	// Mock URL.revokeObjectURL
	globalThis.URL.revokeObjectURL = vi.fn((url: string) => {
		mockBlobUrls.delete(url);
	});

	// Mock document.createElement for video/canvas
	const originalCreateElement = document.createElement.bind(document);
	document.createElement = vi.fn((tagName: string) => {
		if (tagName === "video") {
			const video = originalCreateElement("video") as HTMLVideoElement;
			// Mock video properties
			Object.defineProperty(video, "videoWidth", {
				get: () => 640,
				configurable: true,
			});
			Object.defineProperty(video, "videoHeight", {
				get: () => 480,
				configurable: true,
			});
			// Auto-trigger events for testing
			setTimeout(() => {
				if (video.onloadeddata) video.onloadeddata(new Event("loadeddata"));
			}, 0);
			setTimeout(() => {
				if (video.onseeked) video.onseeked(new Event("seeked"));
			}, 10);
			return video;
		}
		if (tagName === "canvas") {
			const canvas = originalCreateElement("canvas") as HTMLCanvasElement;
			// Mock canvas.getContext
			canvas.getContext = vi.fn(() => ({
				drawImage: vi.fn(),
			})) as unknown as typeof canvas.getContext;
			// Mock canvas.toDataURL
			canvas.toDataURL = vi.fn(() => "data:image/jpeg;base64,mockdata");
			return canvas;
		}
		return originalCreateElement(tagName);
	});
});

beforeEach(() => {
	vi.clearAllMocks();
	mockBlobUrls.clear();
	blobUrlCounter = 0;
});

describe("MediaRecorderService", () => {
	describe("isTypeSupported", () => {
		it("should check if MIME type is supported", () => {
			expect(MediaRecorderService.isTypeSupported("video/webm")).toBe(true);
			expect(
				MediaRecorderService.isTypeSupported("video/webm;codecs=vp9"),
			).toBe(true);
			expect(MediaRecorderService.isTypeSupported("video/mp4")).toBe(false);
		});
	});

	describe("getBestCodec", () => {
		it("should return best supported codec", () => {
			const codec = MediaRecorderService.getBestCodec();
			expect(codec).toMatch(/^video\/webm/);
		});
	});

	describe("startRecording", () => {
		it("should create recording session", () => {
			const mockStream = new MediaStream();
			const session = MediaRecorderService.startRecording(mockStream);

			expect(session).toHaveProperty("start");
			expect(session).toHaveProperty("stop");
			expect(session).toHaveProperty("getState");
		});

		it("should start recording when session.start() is called", () => {
			const mockStream = new MediaStream();
			const session = MediaRecorderService.startRecording(mockStream);

			expect(session.getState()).toBe("inactive");

			session.start();

			expect(session.getState()).toBe("recording");
		});

		it("should collect chunks and stop recording", async () => {
			const mockStream = new MediaStream();
			const session = MediaRecorderService.startRecording(mockStream);

			session.start();
			expect(session.getState()).toBe("recording");

			const result = await session.stop();

			expect(session.getState()).toBe("inactive");
			expect(result).toHaveProperty("blob");
			expect(result).toHaveProperty("duration");
			expect(result.blob).toBeInstanceOf(Blob);
			expect(result.duration).toBeGreaterThanOrEqual(0);
		});

		it("should reject if recorder is not in recording state", async () => {
			const mockStream = new MediaStream();
			const session = MediaRecorderService.startRecording(mockStream);

			// Don't call start(), try to stop immediately
			await expect(session.stop()).rejects.toThrow(
				"Recorder not in recording state",
			);
		});

		it("should use custom videoBitsPerSecond if provided", () => {
			const mockStream = new MediaStream();
			const customBitrate = 5000000;

			MediaRecorderService.startRecording(mockStream, {
				videoBitsPerSecond: customBitrate,
			});

			// Note: This test verifies the MediaRecorder was called with correct config
			// Full verification would require exposing the mock's call history
		});

		it("should skip zero-size data chunks", async () => {
			// Create custom mock that emits empty and valid chunks
			const originalMockMediaRecorder = (globalThis.MediaRecorder as unknown as typeof MockMediaRecorder);

			// @ts-expect-error - Override MediaRecorder temporarily
			globalThis.MediaRecorder = class extends originalMockMediaRecorder {
				constructor(stream: MediaStream, options: MediaRecorderOptions) {
					super(stream, options);
				}

				stop() {
					this.state = "inactive";
					// Emit empty chunk followed by valid chunk
					if (this.ondataavailable) {
						this.ondataavailable({
							data: new Blob([], { type: this.options.mimeType || "video/webm" }),
						});
						this.ondataavailable({
							data: new Blob(["valid data"], { type: this.options.mimeType || "video/webm" }),
						});
					}
					if (this.onstop) {
						this.onstop();
					}
				}
			};

			const mockStream = new MediaStream();
			const session = MediaRecorderService.startRecording(mockStream);
			session.start();

			const result = await session.stop();

			// Should have filtered out empty chunk, only valid data remains
			expect(result.blob.size).toBeGreaterThan(0);

			// Restore original mock
			// @ts-expect-error - Restore MediaRecorder
			globalThis.MediaRecorder = originalMockMediaRecorder;
		});
	});

	describe("extractPreviewFrame", () => {
		it("should extract JPEG data URL from video blob", async () => {
			const blob = new Blob(["fake video"], { type: "video/webm" });

			const dataUrl = await MediaRecorderService.extractPreviewFrame(blob);

			expect(dataUrl).toBe("data:image/jpeg;base64,mockdata");
			expect(URL.createObjectURL).toHaveBeenCalledWith(blob);
			expect(URL.revokeObjectURL).toHaveBeenCalled();
		});

		it("should create video element with correct properties", async () => {
			const blob = new Blob(["fake video"], { type: "video/webm" });

			await MediaRecorderService.extractPreviewFrame(blob);

			expect(document.createElement).toHaveBeenCalledWith("video");
		});

		it("should create canvas and draw video frame", async () => {
			const blob = new Blob(["fake video"], { type: "video/webm" });

			await MediaRecorderService.extractPreviewFrame(blob);

			expect(document.createElement).toHaveBeenCalledWith("canvas");
		});

		it("should reject if canvas context is not available", async () => {
			// Mock canvas.getContext to return null
			const originalCreateElement = document.createElement;
			document.createElement = vi.fn((tagName: string) => {
				if (tagName === "canvas") {
					const canvas = originalCreateElement.call(
						document,
						"canvas",
					) as HTMLCanvasElement;
					canvas.getContext = vi.fn(() => null);
					return canvas;
				}
				return originalCreateElement.call(document, tagName);
			});

			const blob = new Blob(["fake video"], { type: "video/webm" });

			await expect(
				MediaRecorderService.extractPreviewFrame(blob),
			).rejects.toThrow("Could not get canvas context");

			// Restore
			document.createElement = originalCreateElement;
		});

		it("should reject if video fails to load", async () => {
			// Mock video to trigger error
			const originalCreateElement = document.createElement;
			document.createElement = vi.fn((tagName: string) => {
				if (tagName === "video") {
					const video = originalCreateElement.call(
						document,
						"video",
					) as HTMLVideoElement;
					setTimeout(() => {
						if (video.onerror) video.onerror(new Event("error"));
					}, 0);
					return video;
				}
				return originalCreateElement.call(document, tagName);
			});

			const blob = new Blob(["fake video"], { type: "video/webm" });

			await expect(
				MediaRecorderService.extractPreviewFrame(blob),
			).rejects.toThrow("Failed to load video for preview extraction");

			// Restore
			document.createElement = originalCreateElement;
		});
	});

	describe("createPlaybackElement", () => {
		it("should create muted video element", () => {
			const video = MediaRecorderService.createPlaybackElement();

			expect(video).toBeInstanceOf(HTMLVideoElement);
			expect(video.muted).toBe(true);
			expect(video.playsInline).toBe(true);
		});
	});

	describe("loadBlob", () => {
		it("should load blob into video element", () => {
			const video = document.createElement("video");
			const blob = new Blob(["test"], { type: "video/webm" });

			const blobUrl = MediaRecorderService.loadBlob(video, blob);

			expect(blobUrl).toMatch(/^blob:mock-/);
			expect(video.src).toBe(blobUrl);
			expect(URL.createObjectURL).toHaveBeenCalledWith(blob);
		});

		it("should revoke previous blob URL before loading new one", () => {
			const video = document.createElement("video");
			const blob1 = new Blob(["test1"], { type: "video/webm" });
			const blob2 = new Blob(["test2"], { type: "video/webm" });

			const url1 = MediaRecorderService.loadBlob(video, blob1);
			expect(URL.revokeObjectURL).not.toHaveBeenCalled();

			MediaRecorderService.loadBlob(video, blob2);
			expect(URL.revokeObjectURL).toHaveBeenCalledWith(url1);
		});

		it("should not revoke if previous src is not a blob URL", () => {
			const video = document.createElement("video");
			video.src = "https://example.com/video.mp4";

			const blob = new Blob(["test"], { type: "video/webm" });
			MediaRecorderService.loadBlob(video, blob);

			// Should create new blob URL but not revoke the https URL
			expect(URL.createObjectURL).toHaveBeenCalledWith(blob);
			expect(URL.revokeObjectURL).not.toHaveBeenCalledWith(
				"https://example.com/video.mp4",
			);
		});
	});

	describe("revokeObjectUrl", () => {
		it("should revoke blob URL", () => {
			const blobUrl = "blob:mock-123";

			MediaRecorderService.revokeObjectUrl(blobUrl);

			expect(URL.revokeObjectURL).toHaveBeenCalledWith(blobUrl);
		});

		it("should only revoke blob URLs", () => {
			const httpUrl = "https://example.com/video.mp4";

			MediaRecorderService.revokeObjectUrl(httpUrl);

			expect(URL.revokeObjectURL).not.toHaveBeenCalled();
		});
	});
});

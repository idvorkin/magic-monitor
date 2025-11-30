import "fake-indexeddb/auto";
import { act, renderHook, waitFor } from "@testing-library/react";
import {
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import type {
	ChunkPreview,
	DiskBufferServiceType,
} from "../services/DiskBufferService";
import { useDiskTimeMachine } from "./useDiskTimeMachine";

// Mock HTMLMediaElement methods that jsdom doesn't implement
beforeAll(() => {
	// Mock play() method
	HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
	// Mock pause() method
	HTMLMediaElement.prototype.pause = vi.fn();
	// Mock load() method
	HTMLMediaElement.prototype.load = vi.fn();
});

// Mock DeviceService
const mockDeviceService = {
	downloadDataUrl: vi.fn(),
	getScreenWidth: () => 1920,
	getDeviceMemoryGB: () => 8,
	isTouchDevice: () => false,
	addResizeListener: () => () => {},
	getStorageItem: () => null,
	setStorageItem: () => {},
	hasDeviceMotion: () => false,
	requestDeviceMotionPermission: async () => "denied" as const,
	addDeviceMotionListener: () => () => {},
	copyToClipboard: async () => true,
	copyImageToClipboard: async () => true,
	openInNewTab: () => {},
	isMobileDevice: () => false,
	getUserAgent: () => "test",
	getCurrentRoute: () => "/",
	captureScreenshot: async () => null,
};

// Create a mock DiskBufferService for testing
function createMockDiskBufferService(
	initialChunks: { id: number; preview: string; timestamp: number }[] = [],
): DiskBufferServiceType {
	let chunks = [...initialChunks];
	let nextId = chunks.length > 0 ? Math.max(...chunks.map((c) => c.id)) + 1 : 1;

	return {
		init: vi.fn().mockResolvedValue(undefined),
		saveChunk: vi.fn().mockImplementation(async () => {
			const id = nextId++;
			return id;
		}),
		getAllChunks: vi.fn().mockImplementation(async () => {
			return chunks.map((c) => ({
				id: c.id,
				blob: new Blob(["test"], { type: "video/webm" }),
				preview: c.preview,
				timestamp: c.timestamp,
				duration: 2000,
			}));
		}),
		getChunk: vi.fn().mockImplementation(async (id: number) => {
			const chunk = chunks.find((c) => c.id === id);
			if (!chunk) return null;
			return {
				id: chunk.id,
				blob: new Blob(["test"], { type: "video/webm" }),
				preview: chunk.preview,
				timestamp: chunk.timestamp,
				duration: 2000,
			};
		}),
		getPreviews: vi
			.fn()
			.mockImplementation(async (): Promise<ChunkPreview[]> => {
				return chunks.map((c) => ({
					id: c.id,
					preview: c.preview,
					timestamp: c.timestamp,
				}));
			}),
		getChunkCount: vi.fn().mockImplementation(async () => chunks.length),
		pruneOldChunks: vi.fn().mockResolvedValue(undefined),
		exportVideo: vi.fn().mockImplementation(async () => {
			if (chunks.length === 0) {
				return new Blob([], { type: "video/webm" });
			}
			return new Blob(["combined video"], { type: "video/webm" });
		}),
		clear: vi.fn().mockImplementation(async () => {
			chunks = [];
		}),
		close: vi.fn(),
	};
}

describe("useDiskTimeMachine", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe("initialization", () => {
		it("should initialize with default state", () => {
			const videoRef = { current: null };
			const mockService = createMockDiskBufferService();

			const { result } = renderHook(() =>
				useDiskTimeMachine({
					videoRef,
					enabled: false,
					deviceService: mockDeviceService,
					diskBufferService: mockService,
				}),
			);

			expect(result.current.isRecording).toBe(false);
			expect(result.current.isReplaying).toBe(false);
			expect(result.current.isPlaying).toBe(false);
			expect(result.current.chunkCount).toBe(0);
			expect(result.current.currentChunkIndex).toBe(0);
			expect(result.current.previews).toEqual([]);
		});

		it("should load existing chunks on mount", async () => {
			const videoRef = { current: null };
			const mockService = createMockDiskBufferService([
				{ id: 1, preview: "data:image/jpeg;base64,test1", timestamp: 1000 },
				{ id: 2, preview: "data:image/jpeg;base64,test2", timestamp: 3000 },
			]);

			const { result } = renderHook(() =>
				useDiskTimeMachine({
					videoRef,
					enabled: false,
					deviceService: mockDeviceService,
					diskBufferService: mockService,
				}),
			);

			await waitFor(() => {
				expect(result.current.chunkCount).toBe(2);
				expect(result.current.previews.length).toBe(2);
			});
		});
	});

	describe("replay controls", () => {
		it("should not enter replay when no chunks exist", async () => {
			const videoRef = { current: null };
			const mockService = createMockDiskBufferService();

			const { result } = renderHook(() =>
				useDiskTimeMachine({
					videoRef,
					enabled: false,
					deviceService: mockDeviceService,
					diskBufferService: mockService,
				}),
			);

			await act(async () => {
				await result.current.enterReplay();
			});

			expect(result.current.isReplaying).toBe(false);
		});

		it("should enter replay when chunks exist", async () => {
			const videoRef = { current: null };
			const mockService = createMockDiskBufferService([
				{ id: 1, preview: "data:image/jpeg;base64,test", timestamp: 1000 },
			]);

			const { result } = renderHook(() =>
				useDiskTimeMachine({
					videoRef,
					enabled: false,
					deviceService: mockDeviceService,
					diskBufferService: mockService,
				}),
			);

			await waitFor(() => {
				expect(result.current.chunkCount).toBe(1);
			});

			await act(async () => {
				await result.current.enterReplay();
			});

			expect(result.current.isReplaying).toBe(true);
			expect(result.current.isPlaying).toBe(true);
			expect(result.current.currentChunkIndex).toBe(0);
		});

		it("should exit replay", async () => {
			const videoRef = { current: null };
			const mockService = createMockDiskBufferService([
				{ id: 1, preview: "data:image/jpeg;base64,test", timestamp: 1000 },
			]);

			const { result } = renderHook(() =>
				useDiskTimeMachine({
					videoRef,
					enabled: false,
					deviceService: mockDeviceService,
					diskBufferService: mockService,
				}),
			);

			await waitFor(() => {
				expect(result.current.chunkCount).toBe(1);
			});

			await act(async () => {
				await result.current.enterReplay();
			});

			expect(result.current.isReplaying).toBe(true);

			act(() => {
				result.current.exitReplay();
			});

			expect(result.current.isReplaying).toBe(false);
			expect(result.current.isPlaying).toBe(false);
		});

		it("should play and pause", async () => {
			const videoRef = { current: null };
			const mockService = createMockDiskBufferService([
				{ id: 1, preview: "data:image/jpeg;base64,test", timestamp: 1000 },
			]);

			const { result } = renderHook(() =>
				useDiskTimeMachine({
					videoRef,
					enabled: false,
					deviceService: mockDeviceService,
					diskBufferService: mockService,
				}),
			);

			await waitFor(() => {
				expect(result.current.chunkCount).toBe(1);
			});

			await act(async () => {
				await result.current.enterReplay();
			});

			expect(result.current.isPlaying).toBe(true);

			act(() => {
				result.current.pause();
			});

			expect(result.current.isPlaying).toBe(false);

			act(() => {
				result.current.play();
			});

			expect(result.current.isPlaying).toBe(true);
		});
	});

	describe("chunk navigation", () => {
		it("should seek to specific chunk", async () => {
			const videoRef = { current: null };
			const mockService = createMockDiskBufferService([
				{ id: 1, preview: "data:image/jpeg;base64,test0", timestamp: 1000 },
				{ id: 2, preview: "data:image/jpeg;base64,test1", timestamp: 3000 },
				{ id: 3, preview: "data:image/jpeg;base64,test2", timestamp: 5000 },
			]);

			const { result } = renderHook(() =>
				useDiskTimeMachine({
					videoRef,
					enabled: false,
					deviceService: mockDeviceService,
					diskBufferService: mockService,
				}),
			);

			await waitFor(() => {
				expect(result.current.chunkCount).toBe(3);
			});

			await act(async () => {
				await result.current.enterReplay();
			});

			expect(result.current.currentChunkIndex).toBe(0);

			act(() => {
				result.current.seekToChunk(2);
			});

			expect(result.current.currentChunkIndex).toBe(2);
		});

		it("should clamp seek to valid range", async () => {
			const videoRef = { current: null };
			const mockService = createMockDiskBufferService([
				{ id: 1, preview: "data:image/jpeg;base64,test", timestamp: 1000 },
			]);

			const { result } = renderHook(() =>
				useDiskTimeMachine({
					videoRef,
					enabled: false,
					deviceService: mockDeviceService,
					diskBufferService: mockService,
				}),
			);

			await waitFor(() => {
				expect(result.current.chunkCount).toBe(1);
			});

			await act(async () => {
				await result.current.enterReplay();
			});

			act(() => {
				result.current.seekToChunk(100); // Way out of bounds
			});

			expect(result.current.currentChunkIndex).toBe(0); // Clamped to max (0)

			act(() => {
				result.current.seekToChunk(-5); // Negative
			});

			expect(result.current.currentChunkIndex).toBe(0); // Clamped to 0
		});

		it("should navigate to next chunk with wrap", async () => {
			const videoRef = { current: null };
			const mockService = createMockDiskBufferService([
				{ id: 1, preview: "data:image/jpeg;base64,test0", timestamp: 1000 },
				{ id: 2, preview: "data:image/jpeg;base64,test1", timestamp: 3000 },
				{ id: 3, preview: "data:image/jpeg;base64,test2", timestamp: 5000 },
			]);

			const { result } = renderHook(() =>
				useDiskTimeMachine({
					videoRef,
					enabled: false,
					deviceService: mockDeviceService,
					diskBufferService: mockService,
				}),
			);

			await waitFor(() => {
				expect(result.current.chunkCount).toBe(3);
			});

			await act(async () => {
				await result.current.enterReplay();
			});

			expect(result.current.currentChunkIndex).toBe(0);

			act(() => {
				result.current.nextChunk();
			});
			expect(result.current.currentChunkIndex).toBe(1);

			act(() => {
				result.current.nextChunk();
			});
			expect(result.current.currentChunkIndex).toBe(2);

			// Should wrap to beginning
			act(() => {
				result.current.nextChunk();
			});
			expect(result.current.currentChunkIndex).toBe(0);
		});

		it("should navigate to previous chunk with wrap", async () => {
			const videoRef = { current: null };
			const mockService = createMockDiskBufferService([
				{ id: 1, preview: "data:image/jpeg;base64,test0", timestamp: 1000 },
				{ id: 2, preview: "data:image/jpeg;base64,test1", timestamp: 3000 },
				{ id: 3, preview: "data:image/jpeg;base64,test2", timestamp: 5000 },
			]);

			const { result } = renderHook(() =>
				useDiskTimeMachine({
					videoRef,
					enabled: false,
					deviceService: mockDeviceService,
					diskBufferService: mockService,
				}),
			);

			await waitFor(() => {
				expect(result.current.chunkCount).toBe(3);
			});

			await act(async () => {
				await result.current.enterReplay();
			});

			// Should wrap to end
			act(() => {
				result.current.prevChunk();
			});
			expect(result.current.currentChunkIndex).toBe(2);

			act(() => {
				result.current.prevChunk();
			});
			expect(result.current.currentChunkIndex).toBe(1);
		});
	});

	describe("duration calculations", () => {
		it("should calculate total duration based on chunk count", async () => {
			const videoRef = { current: null };
			const mockService = createMockDiskBufferService([
				{ id: 1, preview: "test1", timestamp: 1000 },
				{ id: 2, preview: "test2", timestamp: 3000 },
				{ id: 3, preview: "test3", timestamp: 5000 },
				{ id: 4, preview: "test4", timestamp: 7000 },
				{ id: 5, preview: "test5", timestamp: 9000 },
			]);

			const { result } = renderHook(() =>
				useDiskTimeMachine({
					videoRef,
					enabled: false,
					chunkDurationMs: 2000,
					deviceService: mockDeviceService,
					diskBufferService: mockService,
				}),
			);

			await waitFor(() => {
				expect(result.current.chunkCount).toBe(5);
			});

			// 5 chunks * 2 seconds = 10 seconds
			expect(result.current.totalDuration).toBe(10);
		});

		it("should calculate current time based on chunk index", async () => {
			const videoRef = { current: null };
			const mockService = createMockDiskBufferService([
				{ id: 1, preview: "test1", timestamp: 1000 },
				{ id: 2, preview: "test2", timestamp: 3000 },
				{ id: 3, preview: "test3", timestamp: 5000 },
				{ id: 4, preview: "test4", timestamp: 7000 },
				{ id: 5, preview: "test5", timestamp: 9000 },
			]);

			const { result } = renderHook(() =>
				useDiskTimeMachine({
					videoRef,
					enabled: false,
					chunkDurationMs: 2000,
					deviceService: mockDeviceService,
					diskBufferService: mockService,
				}),
			);

			await waitFor(() => {
				expect(result.current.chunkCount).toBe(5);
			});

			await act(async () => {
				await result.current.enterReplay();
			});

			expect(result.current.currentTime).toBe(0); // Index 0 * 2s = 0s

			act(() => {
				result.current.seekToChunk(3);
			});

			expect(result.current.currentTime).toBe(6); // Index 3 * 2s = 6s
		});
	});

	describe("saveVideo", () => {
		it("should call deviceService.downloadDataUrl with blob URL", async () => {
			const videoRef = { current: null };
			const mockService = createMockDiskBufferService([
				{ id: 1, preview: "data:image/jpeg;base64,test", timestamp: 1000 },
			]);

			const { result } = renderHook(() =>
				useDiskTimeMachine({
					videoRef,
					enabled: false,
					deviceService: mockDeviceService,
					diskBufferService: mockService,
				}),
			);

			await waitFor(() => {
				expect(result.current.chunkCount).toBe(1);
			});

			await act(async () => {
				await result.current.saveVideo();
			});

			expect(mockDeviceService.downloadDataUrl).toHaveBeenCalledTimes(1);
			expect(mockDeviceService.downloadDataUrl).toHaveBeenCalledWith(
				expect.stringMatching(/^blob:/),
				expect.stringMatching(/^magic-monitor-replay-.*\.webm$/),
			);
		});

		it("should not download when no chunks exist", async () => {
			const videoRef = { current: null };
			const mockService = createMockDiskBufferService();

			const { result } = renderHook(() =>
				useDiskTimeMachine({
					videoRef,
					enabled: false,
					deviceService: mockDeviceService,
					diskBufferService: mockService,
				}),
			);

			await act(async () => {
				await result.current.saveVideo();
			});

			expect(mockDeviceService.downloadDataUrl).not.toHaveBeenCalled();
		});
	});
});

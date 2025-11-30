import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DiskBufferService, type VideoChunk } from "./DiskBufferService";

// Mock FFmpegService since it won't work in Node environment
vi.mock("./FFmpegService", () => ({
	FFmpegService: {
		mergeWebmBlobs: vi.fn(async (blobs: Blob[]) => {
			// Simple concatenation for testing (just like old behavior)
			return new Blob(blobs, { type: "video/webm" });
		}),
	},
}));

// Helper to create a test chunk
function createTestChunk(
	timestamp: number,
	duration: number = 2000,
): Omit<VideoChunk, "id"> {
	return {
		blob: new Blob(["test video data"], { type: "video/webm" }),
		preview: `data:image/jpeg;base64,test-preview-${timestamp}`,
		timestamp,
		duration,
	};
}

describe("DiskBufferService", () => {
	beforeEach(async () => {
		// Clear any existing data before each test
		await DiskBufferService.clear();
	});

	afterEach(() => {
		// Close database connection after each test
		DiskBufferService.close();
	});

	describe("init", () => {
		it("should initialize without error", async () => {
			await expect(DiskBufferService.init()).resolves.not.toThrow();
		});

		it("should be idempotent", async () => {
			await DiskBufferService.init();
			await expect(DiskBufferService.init()).resolves.not.toThrow();
		});
	});

	describe("saveChunk", () => {
		it("should save a chunk and return an ID", async () => {
			const chunk = createTestChunk(1000);
			const id = await DiskBufferService.saveChunk(chunk);

			expect(typeof id).toBe("number");
			expect(id).toBeGreaterThan(0);
		});

		it("should save multiple chunks with unique IDs", async () => {
			const id1 = await DiskBufferService.saveChunk(createTestChunk(1000));
			const id2 = await DiskBufferService.saveChunk(createTestChunk(2000));
			const id3 = await DiskBufferService.saveChunk(createTestChunk(3000));

			expect(id1).not.toBe(id2);
			expect(id2).not.toBe(id3);
		});
	});

	describe("getAllChunks", () => {
		it("should return empty array when no chunks exist", async () => {
			const chunks = await DiskBufferService.getAllChunks();
			expect(chunks).toEqual([]);
		});

		it("should return all saved chunks ordered by timestamp", async () => {
			// Save in non-chronological order
			await DiskBufferService.saveChunk(createTestChunk(3000));
			await DiskBufferService.saveChunk(createTestChunk(1000));
			await DiskBufferService.saveChunk(createTestChunk(2000));

			const chunks = await DiskBufferService.getAllChunks();

			expect(chunks.length).toBe(3);
			expect(chunks[0].timestamp).toBe(1000);
			expect(chunks[1].timestamp).toBe(2000);
			expect(chunks[2].timestamp).toBe(3000);
		});

		it("should include all chunk properties", async () => {
			const original = createTestChunk(1000, 2500);
			await DiskBufferService.saveChunk(original);

			const chunks = await DiskBufferService.getAllChunks();

			expect(chunks[0]).toMatchObject({
				timestamp: original.timestamp,
				duration: original.duration,
				preview: original.preview,
			});
			expect(chunks[0].id).toBeDefined();
			// Blob may be stored as object in fake-indexeddb
			expect(chunks[0].blob).toBeDefined();
		});
	});

	describe("getChunk", () => {
		it("should return null for non-existent ID", async () => {
			const chunk = await DiskBufferService.getChunk(999);
			expect(chunk).toBeNull();
		});

		it("should return the correct chunk by ID", async () => {
			const id = await DiskBufferService.saveChunk(createTestChunk(1000));
			const chunk = await DiskBufferService.getChunk(id);

			expect(chunk).not.toBeNull();
			expect(chunk!.id).toBe(id);
			expect(chunk!.timestamp).toBe(1000);
		});
	});

	describe("getPreviews", () => {
		it("should return empty array when no chunks exist", async () => {
			const previews = await DiskBufferService.getPreviews();
			expect(previews).toEqual([]);
		});

		it("should return previews without blobs", async () => {
			await DiskBufferService.saveChunk(createTestChunk(1000));
			await DiskBufferService.saveChunk(createTestChunk(2000));

			const previews = await DiskBufferService.getPreviews();

			expect(previews.length).toBe(2);
			expect(previews[0]).toHaveProperty("id");
			expect(previews[0]).toHaveProperty("preview");
			expect(previews[0]).toHaveProperty("timestamp");
			expect(previews[0]).not.toHaveProperty("blob");
			expect(previews[0]).not.toHaveProperty("duration");
		});

		it("should return previews ordered by timestamp", async () => {
			await DiskBufferService.saveChunk(createTestChunk(3000));
			await DiskBufferService.saveChunk(createTestChunk(1000));

			const previews = await DiskBufferService.getPreviews();

			expect(previews[0].timestamp).toBe(1000);
			expect(previews[1].timestamp).toBe(3000);
		});
	});

	describe("getChunkCount", () => {
		it("should return 0 for empty database", async () => {
			const count = await DiskBufferService.getChunkCount();
			expect(count).toBe(0);
		});

		it("should return correct count after saves", async () => {
			await DiskBufferService.saveChunk(createTestChunk(1000));
			await DiskBufferService.saveChunk(createTestChunk(2000));
			await DiskBufferService.saveChunk(createTestChunk(3000));

			const count = await DiskBufferService.getChunkCount();
			expect(count).toBe(3);
		});
	});

	describe("pruneOldChunks", () => {
		it("should do nothing when under limit", async () => {
			await DiskBufferService.saveChunk(createTestChunk(1000));
			await DiskBufferService.saveChunk(createTestChunk(2000));

			await DiskBufferService.pruneOldChunks(5);

			const count = await DiskBufferService.getChunkCount();
			expect(count).toBe(2);
		});

		it("should remove oldest chunks when over limit", async () => {
			await DiskBufferService.saveChunk(createTestChunk(1000));
			await DiskBufferService.saveChunk(createTestChunk(2000));
			await DiskBufferService.saveChunk(createTestChunk(3000));
			await DiskBufferService.saveChunk(createTestChunk(4000));
			await DiskBufferService.saveChunk(createTestChunk(5000));

			await DiskBufferService.pruneOldChunks(3);

			const chunks = await DiskBufferService.getAllChunks();
			expect(chunks.length).toBe(3);
			// Should keep newest 3 (timestamps 3000, 4000, 5000)
			expect(chunks[0].timestamp).toBe(3000);
			expect(chunks[1].timestamp).toBe(4000);
			expect(chunks[2].timestamp).toBe(5000);
		});

		it("should handle pruning to zero", async () => {
			await DiskBufferService.saveChunk(createTestChunk(1000));
			await DiskBufferService.saveChunk(createTestChunk(2000));

			await DiskBufferService.pruneOldChunks(0);

			const count = await DiskBufferService.getChunkCount();
			expect(count).toBe(0);
		});
	});

	describe("exportVideo", () => {
		it("should return empty blob when no chunks exist", async () => {
			const blob = await DiskBufferService.exportVideo();

			expect(blob).toBeInstanceOf(Blob);
			expect(blob.size).toBe(0);
			expect(blob.type).toBe("video/webm");
		});

		it("should concatenate all chunk blobs", async () => {
			await DiskBufferService.saveChunk(createTestChunk(1000));
			await DiskBufferService.saveChunk(createTestChunk(2000));

			const blob = await DiskBufferService.exportVideo();

			expect(blob).toBeInstanceOf(Blob);
			expect(blob.type).toBe("video/webm");
			// Each test chunk has "test video data" (15 bytes)
			expect(blob.size).toBeGreaterThan(0);
		});
	});

	describe("clear", () => {
		it("should remove all chunks", async () => {
			await DiskBufferService.saveChunk(createTestChunk(1000));
			await DiskBufferService.saveChunk(createTestChunk(2000));

			await DiskBufferService.clear();

			const count = await DiskBufferService.getChunkCount();
			expect(count).toBe(0);
		});
	});
});

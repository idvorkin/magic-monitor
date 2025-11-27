import { describe, expect, it } from "vitest";
import {
	calculateMaxFrames,
	calculateMemoryUsageMB,
	frameIndexToTime,
	getThumbnailIndices,
	timeToFrameIndex,
} from "./useTimeMachine";

describe("calculateMemoryUsageMB", () => {
	it("should return 0 for empty buffer", () => {
		expect(calculateMemoryUsageMB(0, 1920, 1080)).toBe(0);
	});

	it("should return 0 for zero dimensions", () => {
		expect(calculateMemoryUsageMB(100, 0, 1080)).toBe(0);
		expect(calculateMemoryUsageMB(100, 1920, 0)).toBe(0);
	});

	it("should calculate memory for 1080p frames", () => {
		// 1920 * 1080 * 4 bytes = 8,294,400 bytes per frame
		// 100 frames = 829,440,000 bytes ≈ 791 MB
		const result = calculateMemoryUsageMB(100, 1920, 1080);
		expect(result).toBe(791);
	});

	it("should calculate memory for smaller frames", () => {
		// 960 * 540 * 4 bytes = 2,073,600 bytes per frame (quarter of 1080p)
		// 100 frames = 207,360,000 bytes ≈ 198 MB
		const result = calculateMemoryUsageMB(100, 960, 540);
		expect(result).toBe(198);
	});
});

describe("timeToFrameIndex", () => {
	it("should convert 0 seconds to frame 0", () => {
		expect(timeToFrameIndex(0, 30)).toBe(0);
	});

	it("should convert 1 second to fps frames", () => {
		expect(timeToFrameIndex(1, 30)).toBe(30);
		expect(timeToFrameIndex(1, 60)).toBe(60);
	});

	it("should floor fractional frames", () => {
		expect(timeToFrameIndex(0.5, 30)).toBe(15);
		expect(timeToFrameIndex(0.55, 30)).toBe(16); // 0.55 * 30 = 16.5 -> 16
	});
});

describe("frameIndexToTime", () => {
	it("should convert frame 0 to 0 seconds", () => {
		expect(frameIndexToTime(0, 30)).toBe(0);
	});

	it("should convert fps frames to 1 second", () => {
		expect(frameIndexToTime(30, 30)).toBe(1);
		expect(frameIndexToTime(60, 60)).toBe(1);
	});

	it("should handle fractional seconds", () => {
		expect(frameIndexToTime(15, 30)).toBe(0.5);
		expect(frameIndexToTime(45, 30)).toBe(1.5);
	});
});

describe("getThumbnailIndices", () => {
	it("should return empty array for empty buffer", () => {
		expect(getThumbnailIndices(0, 10)).toEqual([]);
	});

	it("should return empty array for 0 count", () => {
		expect(getThumbnailIndices(100, 0)).toEqual([]);
	});

	it("should return evenly spaced indices", () => {
		// 100 frames, want 10 thumbnails -> step of 10
		const indices = getThumbnailIndices(100, 10);
		expect(indices).toEqual([0, 10, 20, 30, 40, 50, 60, 70, 80, 90]);
	});

	it("should handle when count exceeds buffer length", () => {
		// 5 frames, want 10 thumbnails -> step of 1, but only 10 iterations
		// indices: 0, 1, 2, 3, 4, 4, 4, 4, 4, 4 (clamped to max)
		const indices = getThumbnailIndices(5, 10);
		expect(indices.length).toBe(10);
		expect(indices[0]).toBe(0);
		expect(indices[4]).toBe(4);
		expect(indices[9]).toBe(4); // clamped to last valid index
	});

	it("should handle small buffer", () => {
		const indices = getThumbnailIndices(3, 3);
		expect(indices).toEqual([0, 1, 2]);
	});
});

describe("calculateMaxFrames", () => {
	it("should calculate frames for 30 seconds at 30fps", () => {
		expect(calculateMaxFrames(30, 30)).toBe(900);
	});

	it("should calculate frames for 60 seconds at 15fps", () => {
		expect(calculateMaxFrames(60, 15)).toBe(900);
	});

	it("should ceiling fractional results", () => {
		// 10 seconds at 7fps = 70 frames exactly
		expect(calculateMaxFrames(10, 7)).toBe(70);
		// 10.5 seconds at 7fps = 73.5 -> 74
		expect(calculateMaxFrames(10.5, 7)).toBe(74);
	});
});

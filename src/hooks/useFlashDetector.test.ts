import { describe, expect, it } from "vitest";
import {
	colorDistance,
	isColorMatch,
	MAX_COLOR_DISTANCE,
	thresholdToMaxDistance,
} from "./useFlashDetector";

describe("colorDistance", () => {
	it("should return 0 for identical colors", () => {
		const color = { r: 128, g: 64, b: 200 };
		expect(colorDistance(color, color)).toBe(0);
	});

	it("should calculate distance between black and white", () => {
		const black = { r: 0, g: 0, b: 0 };
		const white = { r: 255, g: 255, b: 255 };
		// sqrt(255^2 + 255^2 + 255^2) = sqrt(195075) ≈ 441.67
		expect(colorDistance(black, white)).toBeCloseTo(MAX_COLOR_DISTANCE, 1);
	});

	it("should calculate distance for single channel difference", () => {
		const color1 = { r: 100, g: 0, b: 0 };
		const color2 = { r: 200, g: 0, b: 0 };
		expect(colorDistance(color1, color2)).toBe(100);
	});

	it("should be symmetric", () => {
		const color1 = { r: 50, g: 100, b: 150 };
		const color2 = { r: 200, g: 50, b: 100 };
		expect(colorDistance(color1, color2)).toBe(colorDistance(color2, color1));
	});
});

describe("thresholdToMaxDistance", () => {
	it("should return 0 for threshold 0", () => {
		expect(thresholdToMaxDistance(0)).toBe(0);
	});

	it("should return MAX_COLOR_DISTANCE for threshold 100", () => {
		expect(thresholdToMaxDistance(100)).toBeCloseTo(MAX_COLOR_DISTANCE, 5);
	});

	it("should return half max distance for threshold 50", () => {
		expect(thresholdToMaxDistance(50)).toBeCloseTo(MAX_COLOR_DISTANCE / 2, 5);
	});
});

describe("isColorMatch", () => {
	it("should match identical colors at any threshold", () => {
		const color = { r: 100, g: 100, b: 100 };
		expect(isColorMatch(color, color, 1)).toBe(true);
		expect(isColorMatch(color, color, 50)).toBe(true);
	});

	it("should not match very different colors at low threshold", () => {
		const red = { r: 255, g: 0, b: 0 };
		const blue = { r: 0, g: 0, b: 255 };
		expect(isColorMatch(red, blue, 10)).toBe(false);
	});

	it("should match similar colors within threshold", () => {
		const color1 = { r: 100, g: 100, b: 100 };
		const color2 = { r: 110, g: 100, b: 100 }; // distance = 10
		// threshold 5% = 0.05 * 441.67 ≈ 22
		expect(isColorMatch(color1, color2, 5)).toBe(true);
	});

	it("should not match colors outside threshold", () => {
		const color1 = { r: 100, g: 100, b: 100 };
		const color2 = { r: 150, g: 100, b: 100 }; // distance = 50
		// threshold 5% = 0.05 * 441.67 ≈ 22
		expect(isColorMatch(color1, color2, 5)).toBe(false);
	});
});

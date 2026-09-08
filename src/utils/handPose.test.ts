import { describe, expect, it } from "vitest";
import {
	anyHandIsVSign,
	fingerSpreadDegrees,
	HAND_LANDMARK_COUNT,
	type HandLandmark,
	isVSign,
	V_SIGN_THRESHOLDS,
} from "./handPose";
import {
	FIST,
	INDEX_ONLY,
	NARROW_SPREAD,
	OPEN_PALM,
	V_SIGN,
} from "./handPose.fixtures";

function transform(
	hand: HandLandmark[],
	fn: (p: HandLandmark) => HandLandmark,
): HandLandmark[] {
	return hand.map(fn);
}

describe("isVSign", () => {
	it("accepts a V", () => {
		expect(isVSign(V_SIGN)).toBe(true);
	});

	it("rejects a fist", () => {
		expect(isVSign(FIST)).toBe(false);
	});

	it("rejects an open palm", () => {
		expect(isVSign(OPEN_PALM)).toBe(false);
	});

	it("rejects a single extended index finger", () => {
		expect(isVSign(INDEX_ONLY)).toBe(false);
	});

	it("rejects two fingers up but not spread", () => {
		expect(isVSign(NARROW_SPREAD)).toBe(false);
	});

	it("rejects a hand with too few landmarks", () => {
		expect(isVSign(V_SIGN.slice(0, 10))).toBe(false);
	});

	it("rejects missing landmarks", () => {
		expect(isVSign(undefined)).toBe(false);
		expect(isVSign(null)).toBe(false);
		expect(isVSign([])).toBe(false);
	});

	it("is scale invariant - a hand further from the camera still reads", () => {
		const small = transform(V_SIGN, (p) => ({
			x: p.x * 0.25,
			y: p.y * 0.25,
			z: p.z * 0.25,
		}));
		expect(isVSign(small)).toBe(true);
	});

	it("is rotation invariant - a sideways V still reads", () => {
		// Rotate 90 degrees about the origin: (x, y) -> (-y, x)
		const sideways = transform(V_SIGN, (p) => ({
			x: -p.y,
			y: p.x,
			z: p.z,
		}));
		expect(isVSign(sideways)).toBe(true);
	});

	it("reads a mirrored (left) hand", () => {
		const mirrored = transform(V_SIGN, (p) => ({ ...p, x: 1 - p.x }));
		expect(isVSign(mirrored)).toBe(true);
	});

	it("uses exactly 21 landmarks", () => {
		expect(V_SIGN).toHaveLength(HAND_LANDMARK_COUNT);
	});
});

describe("fingerSpreadDegrees", () => {
	const INDEX = { mcp: 5, tip: 8 };
	const MIDDLE = { mcp: 9, tip: 12 };

	it("measures the V wide enough to pass the threshold", () => {
		const spread = fingerSpreadDegrees(V_SIGN, INDEX, MIDDLE);
		expect(spread).toBeGreaterThan(V_SIGN_THRESHOLDS.MIN_SPREAD_DEG);
		// Sanity: the synthetic hand was built with a 28 degree fan.
		expect(spread).toBeCloseTo(28, 0);
	});

	it("measures near-parallel fingers below the threshold", () => {
		expect(fingerSpreadDegrees(NARROW_SPREAD, INDEX, MIDDLE)).toBeLessThan(
			V_SIGN_THRESHOLDS.MIN_SPREAD_DEG,
		);
	});
});

describe("anyHandIsVSign", () => {
	it("is false with no hands", () => {
		expect(anyHandIsVSign([])).toBe(false);
		expect(anyHandIsVSign(undefined)).toBe(false);
	});

	it("is true when either hand holds the V", () => {
		expect(anyHandIsVSign([FIST, V_SIGN])).toBe(true);
		expect(anyHandIsVSign([V_SIGN, FIST])).toBe(true);
	});

	it("is false when neither hand holds the V", () => {
		expect(anyHandIsVSign([FIST, OPEN_PALM])).toBe(false);
	});
});

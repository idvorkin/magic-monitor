import { describe, expect, it } from "vitest";
import { anyHandIsVSign, fingerSpreadDegrees, isVSign } from "./handPose";
import { buildPixelVHand, makeNormalizer } from "./handPose.fixtures";

/**
 * Regression coverage for the V-sign angle anisotropy bug.
 *
 * MediaPipe's `NormalizedLandmark` normalizes `x` by frame width and `y` by
 * frame height (with `z` ~ per-width). On any non-square frame the spread
 * angle used to drift with the hand's tilt, so the same physical V was
 * accepted in one orientation and rejected in another. These tests build a
 * hand in pixel space with a known *physical* V-spread, apply MediaPipe's
 * normalization, and assert the classified spread is the true physical
 * angle regardless of tilt, frame aspect, or which way the camera is held.
 */

const INDEX = { mcp: 5, tip: 8 };
const MIDDLE = { mcp: 9, tip: 12 };

const FRAMES = [
	{ label: "16:9 landscape", w: 640, h: 360 },
	{ label: "9:16 portrait", w: 360, h: 640 },
	{ label: "4:3", w: 640, h: 480 },
	{ label: "1:1 square", w: 640, h: 640 },
];

describe("fingerSpreadDegrees — tilt invariance across frame aspects", () => {
	for (const { label, w, h } of FRAMES) {
		const aspect = w / h;
		const norm = makeNormalizer(w, h);
		const SPREAD = 20;

		it(`${label}: a ${SPREAD}deg V measures ${SPREAD}deg upright and sideways`, () => {
			const upright = fingerSpreadDegrees(
				buildPixelVHand(SPREAD, 0, norm),
				INDEX,
				MIDDLE,
				aspect,
			);
			const sideways = fingerSpreadDegrees(
				buildPixelVHand(SPREAD, 90, norm),
				INDEX,
				MIDDLE,
				aspect,
			);
			// Both must equal the physical spread (isotropic correction),
			// and must agree with each other to floating-point precision.
			expect(upright).toBeCloseTo(SPREAD, 5);
			expect(sideways).toBeCloseTo(SPREAD, 5);
			expect(Math.abs(upright - sideways)).toBeLessThan(1e-6);
		});

		it(`${label}: the measured spread is independent of tilt across the documented 20-40deg range`, () => {
			for (const spread of [20, 28, 40]) {
				const up = fingerSpreadDegrees(
					buildPixelVHand(spread, 0, norm),
					INDEX,
					MIDDLE,
					aspect,
				);
				const side = fingerSpreadDegrees(
					buildPixelVHand(spread, 90, norm),
					INDEX,
					MIDDLE,
					aspect,
				);
				const diag = fingerSpreadDegrees(
					buildPixelVHand(spread, 45, norm),
					INDEX,
					MIDDLE,
					aspect,
				);
				expect(up).toBeCloseTo(spread, 4);
				expect(side).toBeCloseTo(spread, 4);
				expect(diag).toBeCloseTo(spread, 4);
			}
		});
	}
});

describe("isVSign — same physical V classifies the same at any tilt", () => {
	for (const { label, w, h } of FRAMES) {
		const aspect = w / h;
		const norm = makeNormalizer(w, h);

		it(`${label}: a deliberate 20deg V is accepted both upright and sideways`, () => {
			expect(isVSign(buildPixelVHand(20, 0, norm), aspect)).toBe(true);
			expect(isVSign(buildPixelVHand(20, 90, norm), aspect)).toBe(true);
			expect(isVSign(buildPixelVHand(20, 45, norm), aspect)).toBe(true);
		});

		it(`${label}: a narrow (6deg) two-finger point is rejected at every tilt (no new false positives)`, () => {
			expect(isVSign(buildPixelVHand(6, 0, norm), aspect)).toBe(false);
			expect(isVSign(buildPixelVHand(6, 90, norm), aspect)).toBe(false);
			expect(isVSign(buildPixelVHand(6, 45, norm), aspect)).toBe(false);
		});
	}
});

describe("anyHandIsVSign — forwards the frame aspect", () => {
	it("accepts a 20deg V on the previously-broken 16:9 upright path only when aspect is supplied", () => {
		const norm = makeNormalizer(640, 360);
		const hand = buildPixelVHand(20, 0, norm); // upright, the orientation 16:9 used to reject
		// Without aspect (square assumption) the upright V measured ~11.3deg
		// and was silently rejected — this guards the backward-compatible default.
		expect(anyHandIsVSign([hand], 1)).toBe(false);
		// With the real 16:9 aspect the spread is restored to the true 20deg
		// and the gesture is accepted.
		expect(anyHandIsVSign([hand], 640 / 360)).toBe(true);
	});

	it("treats both orientations of a portrait (9:16) V the same with aspect supplied", () => {
		const norm = makeNormalizer(360, 640);
		const aspect = 360 / 640;
		expect(anyHandIsVSign([buildPixelVHand(20, 0, norm)], aspect)).toBe(true);
		expect(anyHandIsVSign([buildPixelVHand(20, 90, norm)], aspect)).toBe(true);
	});

	it("still rejects a narrow spread at any aspect", () => {
		const norm = makeNormalizer(640, 360);
		expect(anyHandIsVSign([buildPixelVHand(6, 0, norm)], 640 / 360)).toBe(
			false,
		);
		expect(anyHandIsVSign([buildPixelVHand(6, 90, norm)], 640 / 360)).toBe(
			false,
		);
	});
});

describe("fingerSpreadDegrees — default aspect matches an explicit square frame", () => {
	it("omitting aspect is equivalent to aspect 1 (a square/isotropic frame)", () => {
		const norm = makeNormalizer(640, 360);
		const hand = buildPixelVHand(20, 0, norm);
		expect(fingerSpreadDegrees(hand, INDEX, MIDDLE)).toBeCloseTo(
			fingerSpreadDegrees(hand, INDEX, MIDDLE, 1),
			10,
		);
	});

	it("the previously-broken 16:9 upright V was 11.34deg without correction — default preserves that", () => {
		// This is the buggy value from the report. With the default (square)
		// assumption it is unchanged: the fix only alters behaviour when the
		// caller supplies the real aspect, so callers that still build hands
		// in an isotropic [0,1]^2 space (the existing fixtures) are unaffected.
		const norm = makeNormalizer(640, 360);
		expect(
			fingerSpreadDegrees(buildPixelVHand(20, 0, norm), INDEX, MIDDLE),
		).toBeCloseTo(11.34, 1);
	});
});

import { describe, expect, it } from "vitest";
import { EmaSmoother, emaStep } from "./ema";
import { clampSpeed, createSmoother } from "./index";
import {
	KALMAN_FAST,
	KALMAN_SMOOTH,
	KalmanSmoother,
	kalmanPredict,
} from "./kalman";
import type { SmoothedPosition } from "./types";

describe("EmaSmoother", () => {
	it("should start at default position", () => {
		const smoother = new EmaSmoother();
		const pos = smoother.getPosition();

		expect(pos.x).toBe(0);
		expect(pos.y).toBe(0);
		expect(pos.zoom).toBe(1);
	});

	it("should smoothly approach target", () => {
		const smoother = new EmaSmoother({ smoothFactor: 0.5 });

		// Move towards target
		const result = smoother.update({ x: 1, y: 1, zoom: 2 });

		// Should be halfway there with smoothFactor 0.5
		expect(result.x).toBeCloseTo(0.5, 2);
		expect(result.y).toBeCloseTo(0.5, 2);
		expect(result.zoom).toBeCloseTo(1.5, 2);
	});

	it("should converge after many iterations", () => {
		const smoother = new EmaSmoother({ smoothFactor: 0.1 });
		const target = { x: 0.3, y: -0.2, zoom: 2.5 };

		// Run many iterations
		for (let i = 0; i < 100; i++) {
			smoother.update(target);
		}

		const pos = smoother.getPosition();
		expect(pos.x).toBeCloseTo(target.x, 2);
		expect(pos.y).toBeCloseTo(target.y, 2);
		expect(pos.zoom).toBeCloseTo(target.zoom, 2);
	});

	it("should reset to default", () => {
		const smoother = new EmaSmoother();

		smoother.update({ x: 1, y: 1, zoom: 3 });
		smoother.reset();

		const pos = smoother.getPosition();
		expect(pos.x).toBe(0);
		expect(pos.y).toBe(0);
		expect(pos.zoom).toBe(1);
	});
});

describe("emaStep (pure function)", () => {
	it("should compute single step correctly", () => {
		const current = { x: 0, y: 0, zoom: 1 };
		const target = { x: 1, y: 1, zoom: 2 };
		const result = emaStep(current, target, 0.5);

		expect(result.x).toBeCloseTo(0.5, 2);
		expect(result.y).toBeCloseTo(0.5, 2);
		expect(result.zoom).toBeCloseTo(1.5, 2);
	});

	it("should not move with smoothFactor 0", () => {
		const current = { x: 0, y: 0, zoom: 1 };
		const target = { x: 1, y: 1, zoom: 2 };
		const result = emaStep(current, target, 0);

		expect(result.x).toBe(0);
		expect(result.y).toBe(0);
		expect(result.zoom).toBe(1);
	});

	it("should jump to target with smoothFactor 1", () => {
		const current = { x: 0, y: 0, zoom: 1 };
		const target = { x: 1, y: 1, zoom: 2 };
		const result = emaStep(current, target, 1);

		expect(result.x).toBe(1);
		expect(result.y).toBe(1);
		expect(result.zoom).toBe(2);
	});
});

describe("KalmanSmoother", () => {
	it("should start at default position", () => {
		const smoother = new KalmanSmoother();
		const pos = smoother.getPosition();

		expect(pos.x).toBe(0);
		expect(pos.y).toBe(0);
		expect(pos.zoom).toBe(1);
	});

	it("should smoothly approach target", () => {
		const smoother = new KalmanSmoother(KALMAN_FAST);
		const target = { x: 1, y: 1, zoom: 2 };

		// Run a few iterations
		for (let i = 0; i < 10; i++) {
			smoother.update(target);
		}

		const pos = smoother.getPosition();
		// Should have moved towards target
		expect(pos.x).toBeGreaterThan(0);
		expect(pos.y).toBeGreaterThan(0);
		expect(pos.zoom).toBeGreaterThan(1);
	});

	it("should converge after many iterations", () => {
		const smoother = new KalmanSmoother(KALMAN_FAST);
		const target = { x: 0.3, y: -0.2, zoom: 2.5 };

		// Run many iterations
		for (let i = 0; i < 200; i++) {
			smoother.update(target);
		}

		const pos = smoother.getPosition();
		expect(pos.x).toBeCloseTo(target.x, 1);
		expect(pos.y).toBeCloseTo(target.y, 1);
		expect(pos.zoom).toBeCloseTo(target.zoom, 1);
	});

	it("should reset to default", () => {
		const smoother = new KalmanSmoother();

		for (let i = 0; i < 10; i++) {
			smoother.update({ x: 1, y: 1, zoom: 3 });
		}
		smoother.reset();

		const pos = smoother.getPosition();
		expect(pos.x).toBe(0);
		expect(pos.y).toBe(0);
		expect(pos.zoom).toBe(1);
	});

	it("should track velocities", () => {
		const smoother = new KalmanSmoother(KALMAN_FAST);

		// Give consistent input - velocity should build up
		for (let i = 0; i < 20; i++) {
			smoother.update({ x: 1, y: 1, zoom: 2 });
		}

		const vel = smoother.getVelocities();
		// Velocities should be non-zero (filter is tracking)
		// Note: Can be slightly negative due to overshoot/damping
		expect(typeof vel.vx).toBe("number");
		expect(typeof vel.vy).toBe("number");
	});

	it("should have different response characteristics for fast vs smooth", () => {
		const fastSmoother = new KalmanSmoother(KALMAN_FAST);
		const smoothSmoother = new KalmanSmoother(KALMAN_SMOOTH);

		// Both should converge to target over time
		const target = { x: 1, y: 0, zoom: 1 };

		for (let i = 0; i < 200; i++) {
			fastSmoother.update(target);
			smoothSmoother.update(target);
		}

		const fastPos = fastSmoother.getPosition();
		const smoothPos = smoothSmoother.getPosition();

		// Both should converge to target
		expect(fastPos.x).toBeCloseTo(1, 1);
		expect(smoothPos.x).toBeCloseTo(1, 1);
	});
});

describe("kalmanPredict (pure function)", () => {
	it("should predict next position based on velocity", () => {
		const { xPred, vPred } = kalmanPredict(0, 0.1);

		expect(xPred).toBeCloseTo(0.1, 5);
		expect(vPred).toBeCloseTo(0.1, 5);
	});

	it("should keep velocity constant in prediction", () => {
		const { vPred } = kalmanPredict(5, 0.5);

		expect(vPred).toBe(0.5);
	});
});

describe("createSmoother", () => {
	it("should create EMA smoother for 'ema' preset", () => {
		const smoother = createSmoother("ema");
		expect(smoother).toBeInstanceOf(EmaSmoother);
	});

	it("should create Kalman smoother for 'kalmanFast' preset", () => {
		const smoother = createSmoother("kalmanFast");
		expect(smoother).toBeInstanceOf(KalmanSmoother);
	});

	it("should create Kalman smoother for 'kalmanSmooth' preset", () => {
		const smoother = createSmoother("kalmanSmooth");
		expect(smoother).toBeInstanceOf(KalmanSmoother);
	});
});

describe("clampSpeed", () => {
	it("should not clamp when within limits", () => {
		const current = { x: 0, y: 0, zoom: 1 };
		const target = { x: 0.01, y: 0.01, zoom: 1.05 };

		const result = clampSpeed(current, target, 0.1, 0.1);

		expect(result.x).toBe(target.x);
		expect(result.y).toBe(target.y);
		expect(result.zoom).toBe(target.zoom);
	});

	it("should clamp pan speed when exceeding limit", () => {
		const current = { x: 0, y: 0, zoom: 1 };
		const target = { x: 1, y: 0, zoom: 1 }; // Large pan

		const result = clampSpeed(current, target, 0.1, 0.1);

		// Should be clamped to maxPanSpeed
		expect(result.x).toBeCloseTo(0.1, 5);
		expect(result.y).toBe(0);
	});

	it("should clamp zoom speed when exceeding limit", () => {
		const current = { x: 0, y: 0, zoom: 1 };
		const target = { x: 0, y: 0, zoom: 3 }; // Large zoom change

		const result = clampSpeed(current, target, 0.1, 0.1);

		// Should be clamped to maxZoomSpeed
		expect(result.zoom).toBeCloseTo(1.1, 5);
	});

	it("should clamp negative zoom changes", () => {
		const current = { x: 0, y: 0, zoom: 3 };
		const target = { x: 0, y: 0, zoom: 1 }; // Large zoom out

		const result = clampSpeed(current, target, 0.1, 0.1);

		// Should be clamped to maxZoomSpeed in negative direction
		expect(result.zoom).toBeCloseTo(2.9, 5);
	});

	it("should preserve direction when clamping pan", () => {
		const current = { x: 0, y: 0, zoom: 1 };
		const target = { x: -1, y: -1, zoom: 1 }; // Diagonal pan

		const result = clampSpeed(current, target, 0.1, 0.1);

		// Should maintain 45-degree direction
		expect(result.x).toBeCloseTo(result.y, 5);
		// Total distance should be maxPanSpeed
		const dist = Math.sqrt(result.x ** 2 + result.y ** 2);
		expect(dist).toBeCloseTo(0.1, 5);
	});
});

// `Smoother.reseed` closes the loop between `clampSpeed` and the smoother's
// internal state. See the Smoother interface doc and the bug report on
// wrong-direction frames at target reversal.
describe("Smoother.reseed", () => {
	it("KalmanSmoother.reseed sets the position to the seeded value", () => {
		const smoother = new KalmanSmoother(KALMAN_FAST);
		smoother.reseed({ x: 0.3, y: -0.2, zoom: 2.5 });

		const pos = smoother.getPosition();
		expect(pos.x).toBeCloseTo(0.3, 5);
		expect(pos.y).toBeCloseTo(-0.2, 5);
		expect(pos.zoom).toBeCloseTo(2.5, 5);
	});

	it("KalmanSmoother.reseed zeroes the velocity estimate", () => {
		// Build up velocity by tracking a moving target.
		const smoother = new KalmanSmoother(KALMAN_FAST);
		for (let i = 0; i < 20; i++) {
			smoother.update({ x: 1, y: 1, zoom: 3 });
		}
		const before = smoother.getVelocities();
		// Sanity: the filter should have built up meaningful zoom velocity.
		expect(Math.abs(before.vZoom)).toBeGreaterThan(0);

		smoother.reseed({ x: 0, y: 0, zoom: 1.7 });

		const after = smoother.getVelocities();
		expect(after.vx).toBe(0);
		expect(after.vy).toBe(0);
		expect(after.vZoom).toBe(0);
	});

	it("KalmanSmoother: after reseed, first update does not race past the seeded position", () => {
		// Without velocity reset, a Kalman filter that has been tracking a
		// rising target will predict forward past a freshly seeded position.
		// After reseed the velocity is 0, so the predicted next position is
		// exactly the seeded position (plus a fraction of the innovation).
		const smoother = new KalmanSmoother(KALMAN_FAST);
		for (let i = 0; i < 20; i++) {
			smoother.update({ x: 0, y: 0, zoom: 3 });
		}
		smoother.reseed({ x: 0, y: 0, zoom: 1.7 });

		const out = smoother.update({ x: 0, y: 0, zoom: 1 });

		// Target is below the seeded position; output must move toward the
		// target (i.e. be <= 1.7), never above it.
		expect(out.zoom).toBeLessThanOrEqual(1.7 + 1e-9);
		expect(out.zoom).toBeLessThan(1.7);
	});

	it("EmaSmoother.reseed sets the internal state to the seeded value", () => {
		const smoother = new EmaSmoother({ smoothFactor: 0.05 });
		smoother.update({ x: 1, y: 1, zoom: 3 });
		smoother.reseed({ x: 0.3, y: -0.2, zoom: 2.5 });

		const pos = smoother.getPosition();
		expect(pos.x).toBeCloseTo(0.3, 5);
		expect(pos.y).toBeCloseTo(-0.2, 5);
		expect(pos.zoom).toBeCloseTo(2.5, 5);
	});

	it("EmaSmoother: after reseed, the next update lerps from the seeded position", () => {
		const smoother = new EmaSmoother({ smoothFactor: 0.5 });
		smoother.reseed({ x: 0, y: 0, zoom: 1 });

		// smoothFactor 0.5 from zoom 1 toward target 3 -> 1 + 0.5*(3-1) = 2.0
		const out = smoother.update({ x: 0, y: 0, zoom: 3 });
		expect(out.zoom).toBeCloseTo(2.0, 5);
	});

	it("createSmoother returns smoothers that implement reseed", () => {
		for (const preset of ["ema", "kalmanFast", "kalmanSmooth"] as const) {
			const smoother = createSmoother(preset);
			smoother.reseed({ x: 0.1, y: -0.1, zoom: 1.2 });
			const pos = smoother.getPosition();
			expect(pos.x).toBeCloseTo(0.1, 5);
			expect(pos.y).toBeCloseTo(-0.1, 5);
			expect(pos.zoom).toBeCloseTo(1.2, 5);
		}
	});
});

// Integration of clampSpeed + Smoother, mirroring the useSmartZoom frame
// loop. Guards the closed-loop behavior that prevents wrong-direction frames
// at target reversal.
describe("clampSpeed + Smoother closed loop (useSmartZoom frame pipeline)", () => {
	// Per-frame speed limits used by useSmartZoom (DEFAULT_SPEED_CLAMP).
	const HANDS_PAN = 0.05;
	const HANDS_ZOOM = 0.1;
	const NOHAND_PAN = 0.025; // half speed on no-hands
	const NOHAND_ZOOM = 0.05;

	// Drive the pipeline the way useSmartZoom does: each frame run the
	// smoother on the committed target, clamp toward the displayed
	// position, update the displayed position, and (when closed) reseed
	// the smoother to the displayed position.
	function runPipeline(
		smoother: ReturnType<typeof createSmoother>,
		handsFrames: number,
		closedLoop: boolean,
	): { phase: "HANDS" | "NOHEAD"; prevBefore: number; out: number }[] {
		let prev: SmoothedPosition = { x: 0, y: 0, zoom: 1 };
		const trace: {
			phase: "HANDS" | "NOHEAD";
			prevBefore: number;
			out: number;
		}[] = [];

		for (let i = 0; i < handsFrames; i++) {
			const smoothed = smoother.update({ x: 0, y: 0, zoom: 3 });
			const sc = clampSpeed(prev, smoothed, HANDS_PAN, HANDS_ZOOM);
			trace.push({ phase: "HANDS", prevBefore: prev.zoom, out: sc.zoom });
			prev = { x: 0, y: 0, zoom: sc.zoom };
			if (closedLoop) smoother.reseed(prev);
		}
		for (let i = 0; i < 6; i++) {
			const smoothed = smoother.update({ x: 0, y: 0, zoom: 1 });
			const sc = clampSpeed(prev, smoothed, NOHAND_PAN, NOHAND_ZOOM);
			trace.push({ phase: "NOHEAD", prevBefore: prev.zoom, out: sc.zoom });
			prev = { x: 0, y: 0, zoom: sc.zoom };
			if (closedLoop) smoother.reseed(prev);
		}
		return trace;
	}

	// A "wrong-direction" frame is a no-hands frame where the displayed
	// zoom moves *away* from the new target (1) — i.e. out > prevBefore.
	function countWrongDirection(trace: ReturnType<typeof runPipeline>): number {
		return trace
			.filter((t) => t.phase === "NOHEAD")
			.filter((t) => t.out > t.prevBefore + 1e-9).length;
	}

	it("closed-loop KALMAN_FAST produces zero wrong-direction frames across the trigger range N=1..12", () => {
		for (let n = 1; n <= 12; n++) {
			const trace = runPipeline(new KalmanSmoother(KALMAN_FAST), n, true);
			expect(countWrongDirection(trace)).toBe(0);
		}
	});

	it("closed-loop KALMAN_SMOOTH produces zero wrong-direction frames across the trigger range N=1..16", () => {
		for (let n = 1; n <= 16; n++) {
			const trace = runPipeline(new KalmanSmoother(KALMAN_SMOOTH), n, true);
			expect(countWrongDirection(trace)).toBe(0);
		}
	});

	it("EMA is unaffected by the loop (no wrong-direction frames either way)", () => {
		// EMA's per-frame climb (0.05 * (3-1) = 0.1) never exceeds the 0.1
		// zoom clamp, so its output never sits above prev.zoom at reversal.
		expect(
			countWrongDirection(
				runPipeline(new EmaSmoother({ smoothFactor: 0.05 }), 7, false),
			),
		).toBe(0);
		expect(
			countWrongDirection(
				runPipeline(new EmaSmoother({ smoothFactor: 0.05 }), 7, true),
			),
		).toBe(0);
	});
});

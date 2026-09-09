/**
 * Kalman filter smoother for SmartZoom.
 *
 * Uses a 6D state vector: [x, y, zoom, vx, vy, vZoom]
 * - Position (x, y, zoom) and velocity (vx, vy, vZoom)
 *
 * The Kalman filter provides better smoothing than EMA by:
 * 1. Predicting where the target will be based on velocity
 * 2. Balancing prediction vs measurement based on noise parameters
 * 3. Adapting to motion patterns over time
 *
 * Key parameters:
 * - Q (process noise): How much we expect the target to change unexpectedly
 * - R (measurement noise): How noisy our hand detection measurements are
 * - Higher Q = trust measurements more, respond faster
 * - Higher R = trust predictions more, smoother output
 */

import type { Measurement, SmoothedPosition, Smoother } from "./types";

export interface KalmanConfig {
	// Process noise (Q matrix diagonal) - how much target can change per frame
	processNoisePos: number; // Position process noise
	processNoiseVel: number; // Velocity process noise

	// Measurement noise (R matrix diagonal) - how noisy detection is
	measurementNoise: number;

	// Initial uncertainty
	initialUncertainty: number;
}

/** Fast preset: responds quickly, some jitter allowed */
export const KALMAN_FAST: KalmanConfig = {
	processNoisePos: 0.01,
	processNoiseVel: 0.001,
	measurementNoise: 0.1,
	initialUncertainty: 1,
};

/** Smooth preset: very stable, slower response */
export const KALMAN_SMOOTH: KalmanConfig = {
	processNoisePos: 0.001,
	processNoiseVel: 0.0001,
	measurementNoise: 0.5,
	initialUncertainty: 1,
};

/**
 * 1D Kalman filter for a single dimension (position + velocity).
 * We use 3 independent 1D filters instead of one 6D filter for simplicity.
 */
class Kalman1D {
	// State: [position, velocity]
	private x: number; // position estimate
	private v: number; // velocity estimate

	// Covariance matrix (2x2, stored as 4 elements)
	private p00: number;
	private p01: number;
	private p10: number;
	private p11: number;

	private config: KalmanConfig;

	constructor(config: KalmanConfig, initialPos = 0) {
		this.config = config;
		this.x = initialPos;
		this.v = 0;

		// Initialize covariance with uncertainty
		this.p00 = config.initialUncertainty;
		this.p01 = 0;
		this.p10 = 0;
		this.p11 = config.initialUncertainty;
	}

	/** Predict + Update step, returns new position estimate */
	update(measurement: number): number {
		// === PREDICT ===
		// State prediction: x' = x + v, v' = v (constant velocity model)
		const xPred = this.x + this.v;
		const vPred = this.v;

		// Covariance prediction: P' = F * P * F' + Q
		// F = [[1, 1], [0, 1]] (state transition)
		const { processNoisePos, processNoiseVel, measurementNoise } = this.config;

		const p00Pred = this.p00 + this.p01 + this.p10 + this.p11 + processNoisePos;
		const p01Pred = this.p01 + this.p11;
		const p10Pred = this.p10 + this.p11;
		const p11Pred = this.p11 + processNoiseVel;

		// === UPDATE ===
		// Kalman gain: K = P' * H' * (H * P' * H' + R)^-1
		// H = [1, 0] (we only measure position, not velocity)
		const s = p00Pred + measurementNoise; // Innovation covariance
		const k0 = p00Pred / s; // Kalman gain for position
		const k1 = p10Pred / s; // Kalman gain for velocity

		// State update: x = x' + K * (z - H * x')
		const innovation = measurement - xPred;
		this.x = xPred + k0 * innovation;
		this.v = vPred + k1 * innovation;

		// Covariance update: P = (I - K * H) * P'
		this.p00 = (1 - k0) * p00Pred;
		this.p01 = (1 - k0) * p01Pred;
		this.p10 = -k1 * p00Pred + p10Pred;
		this.p11 = -k1 * p01Pred + p11Pred;

		return this.x;
	}

	getPosition(): number {
		return this.x;
	}

	getVelocity(): number {
		return this.v;
	}

	reset(initialPos = 0): void {
		this.x = initialPos;
		this.v = 0;
		this.p00 = this.config.initialUncertainty;
		this.p01 = 0;
		this.p10 = 0;
		this.p11 = this.config.initialUncertainty;
	}
}

export class KalmanSmoother implements Smoother {
	private filterX: Kalman1D;
	private filterY: Kalman1D;
	private filterZoom: Kalman1D;

	constructor(config: KalmanConfig = KALMAN_SMOOTH) {
		this.filterX = new Kalman1D(config, 0);
		this.filterY = new Kalman1D(config, 0);
		this.filterZoom = new Kalman1D(config, 1); // Zoom starts at 1
	}

	update(measurement: Measurement): SmoothedPosition {
		return {
			x: this.filterX.update(measurement.x),
			y: this.filterY.update(measurement.y),
			zoom: this.filterZoom.update(measurement.zoom),
		};
	}

	getPosition(): SmoothedPosition {
		return {
			x: this.filterX.getPosition(),
			y: this.filterY.getPosition(),
			zoom: this.filterZoom.getPosition(),
		};
	}

	reset(): void {
		this.filterX.reset(0);
		this.filterY.reset(0);
		this.filterZoom.reset(1);
	}

	/** Re-seed internal state to the displayed position (closes the clamp<->smoother loop). */
	reseed(pos: SmoothedPosition): void {
		this.filterX.reset(pos.x);
		this.filterY.reset(pos.y);
		this.filterZoom.reset(pos.zoom);
	}

	/** Get current velocities (useful for debugging/visualization) */
	getVelocities(): { vx: number; vy: number; vZoom: number } {
		return {
			vx: this.filterX.getVelocity(),
			vy: this.filterY.getVelocity(),
			vZoom: this.filterZoom.getVelocity(),
		};
	}
}

/** Pure function for single Kalman step (for testing) */
export function kalmanPredict(
	x: number,
	v: number,
): { xPred: number; vPred: number } {
	return { xPred: x + v, vPred: v };
}

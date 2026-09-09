/**
 * EMA (Exponential Moving Average) smoother.
 * Extracted from useSmartZoom.ts - this is the original smoothing algorithm.
 *
 * Formula: current = current + (target - current) * smoothFactor
 */

import type { Measurement, SmoothedPosition, Smoother } from "./types";

export interface EmaConfig {
	smoothFactor: number; // 0-1, lower = smoother (default 0.05)
}

const DEFAULT_CONFIG: EmaConfig = {
	smoothFactor: 0.05,
};

export class EmaSmoother implements Smoother {
	private state: SmoothedPosition;
	private config: EmaConfig;

	constructor(config: Partial<EmaConfig> = {}) {
		this.config = { ...DEFAULT_CONFIG, ...config };
		this.state = { x: 0, y: 0, zoom: 1 };
	}

	update(measurement: Measurement): SmoothedPosition {
		const { smoothFactor } = this.config;

		// Lerp towards target
		this.state.x += (measurement.x - this.state.x) * smoothFactor;
		this.state.y += (measurement.y - this.state.y) * smoothFactor;
		this.state.zoom += (measurement.zoom - this.state.zoom) * smoothFactor;

		return this.getPosition();
	}

	getPosition(): SmoothedPosition {
		return { ...this.state };
	}

	reset(): void {
		this.state = { x: 0, y: 0, zoom: 1 };
	}

	/** Re-seed internal state to the displayed position (closes the clamp<->smoother loop). */
	reseed(pos: SmoothedPosition): void {
		this.state = { x: pos.x, y: pos.y, zoom: pos.zoom };
	}
}

/** Pure function version for testing */
export function emaStep(
	current: SmoothedPosition,
	target: Measurement,
	smoothFactor: number,
): SmoothedPosition {
	return {
		x: current.x + (target.x - current.x) * smoothFactor,
		y: current.y + (target.y - current.y) * smoothFactor,
		zoom: current.zoom + (target.zoom - current.zoom) * smoothFactor,
	};
}

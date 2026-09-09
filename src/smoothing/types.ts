/**
 * Smoothing backend types for SmartZoom.
 * See docs/SMART_ZOOM_SPEC.md for algorithm details.
 */

/** Measurement from hand detection (committed target after hysteresis) */
export interface Measurement {
	x: number; // Normalized pan X (-0.5 to 0.5)
	y: number; // Normalized pan Y (-0.5 to 0.5)
	zoom: number; // Zoom level (1 to MAX_ZOOM)
}

/** Full smoothing state including velocities (for Kalman) */
export interface SmoothingState {
	x: number;
	y: number;
	zoom: number;
	vx: number; // Velocity in x (units per frame)
	vy: number; // Velocity in y (units per frame)
	vZoom: number; // Velocity in zoom (units per frame)
}

/** Output position (what gets rendered) */
export interface SmoothedPosition {
	x: number;
	y: number;
	zoom: number;
}

/** Smoother interface - strategy pattern for different algorithms */
export interface Smoother {
	/** Update with new measurement, returns smoothed position */
	update(measurement: Measurement): SmoothedPosition;

	/** Get current smoothed position without updating */
	getPosition(): SmoothedPosition;

	/** Re-seed internal state to the displayed position (closes the clamp<->smoother loop). */
	reseed(pos: SmoothedPosition): void;

	/** Reset to initial state */
	reset(): void;
}

/** Available smoothing presets */
export type SmoothingPreset = "ema" | "kalmanFast" | "kalmanSmooth";

/** Speed clamp configuration */
export interface SpeedClampConfig {
	maxPanSpeed: number; // Max pan change per frame (normalized units)
	maxZoomSpeed: number; // Max zoom change per frame
}

/** Default speed clamp values */
export const DEFAULT_SPEED_CLAMP: SpeedClampConfig = {
	maxPanSpeed: 0.05, // 5% of screen per frame max
	maxZoomSpeed: 0.1, // 0.1 zoom levels per frame max
};

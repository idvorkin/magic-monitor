/**
 * Zoom and pan constants for smart zoom and manual zoom features.
 * See docs/SMART_ZOOM_SPEC.md for algorithm details.
 */

/**
 * Zoom level constraints.
 */
export const ZOOM_CONSTANTS = {
	/** Minimum zoom level (1x = full frame) */
	MIN_ZOOM: 1,
	/** Maximum zoom level for smart zoom */
	MAX_ZOOM: 3,
	/** Minimum zoom change to trigger update (prevents jitter) */
	THRESHOLD: 0.1,
	/** Wheel scroll sensitivity (zoom delta per pixel of scroll) */
	WHEEL_SENSITIVITY: 0.001,
} as const;

/**
 * Pan position constraints.
 */
export const PAN_CONSTANTS = {
	/** Minimum pan change to trigger update (prevents jitter) */
	THRESHOLD: 0.025,
} as const;

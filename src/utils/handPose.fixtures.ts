import type { HandLandmark } from "./handPose";

// ===== Synthetic hand builder (test fixtures) =====
//
// A stylised right hand in MediaPipe's normalized image space: wrist at the
// bottom, knuckles in a row above it, fingers pointing up. Each finger is
// either extended (tip beyond the knuckles) or curled (tip folded back over
// the palm, which is what puts it inside the PIP radius).

type FingerState = "extended" | "curled";

const WRIST_POINT = { x: 0.5, y: 1.0 };
const MCP_Y = 0.7;
const MCP_X = { index: 0.44, middle: 0.5, ring: 0.56, pinky: 0.62 };

interface FingerSpec {
	state: FingerState;
	/** Degrees from straight-up; negative fans left. */
	angle?: number;
}

interface HandSpec {
	index: FingerSpec;
	middle: FingerSpec;
	ring: FingerSpec;
	pinky: FingerSpec;
}

function fingerPoints(mcpX: number, spec: FingerSpec): HandLandmark[] {
	const mcp = { x: mcpX, y: MCP_Y, z: 0 };
	const rad = ((spec.angle ?? 0) * Math.PI) / 180;
	const dir = { x: Math.sin(rad), y: -Math.cos(rad) };

	const along = (d: number) => ({
		x: mcp.x + dir.x * d,
		y: mcp.y + dir.y * d,
		z: 0,
	});

	if (spec.state === "extended") {
		return [mcp, along(0.12), along(0.22), along(0.3)];
	}

	// Curled: the knuckle still stands up, then the finger folds back down
	// over the palm so the tip ends up closer to the wrist than the PIP.
	return [
		mcp,
		along(0.12),
		{ x: mcp.x, y: mcp.y + 0.02, z: 0 },
		{ x: mcp.x, y: mcp.y + 0.06, z: 0 },
	];
}

function makeHand(spec: HandSpec): HandLandmark[] {
	const wrist = { ...WRIST_POINT, z: 0 };
	// Thumb (1-4) is not part of the V rule; plausible filler off the palm's edge.
	const thumb: HandLandmark[] = [
		{ x: 0.4, y: 0.95, z: 0 },
		{ x: 0.34, y: 0.89, z: 0 },
		{ x: 0.3, y: 0.83, z: 0 },
		{ x: 0.27, y: 0.78, z: 0 },
	];

	return [
		wrist,
		...thumb,
		...fingerPoints(MCP_X.index, spec.index),
		...fingerPoints(MCP_X.middle, spec.middle),
		...fingerPoints(MCP_X.ring, spec.ring),
		...fingerPoints(MCP_X.pinky, spec.pinky),
	];
}

export const V_SIGN = makeHand({
	index: { state: "extended", angle: -20 },
	middle: { state: "extended", angle: 8 },
	ring: { state: "curled" },
	pinky: { state: "curled" },
});

export const FIST = makeHand({
	index: { state: "curled" },
	middle: { state: "curled" },
	ring: { state: "curled" },
	pinky: { state: "curled" },
});

export const OPEN_PALM = makeHand({
	index: { state: "extended", angle: -8 },
	middle: { state: "extended", angle: -2 },
	ring: { state: "extended", angle: 4 },
	pinky: { state: "extended", angle: 12 },
});

export const INDEX_ONLY = makeHand({
	index: { state: "extended", angle: 0 },
	middle: { state: "curled" },
	ring: { state: "curled" },
	pinky: { state: "curled" },
});

// Two fingers up but held together - a "scissors closed" / two-finger point.
export const NARROW_SPREAD = makeHand({
	index: { state: "extended", angle: -3 },
	middle: { state: "extended", angle: 0 },
	ring: { state: "curled" },
	pinky: { state: "curled" },
});

// ===== Pixel-space hand builder (for aspect-ratio / anisotropy tests) =====
//
// The fixtures above live in MediaPipe's normalized [0,1]^2 square space, so
// they cannot exercise the non-square normalization that production frames
// actually produce. This builder works the other way: it places a hand in
// pixel space with a known *physical* V-spread, then applies a per-frame
// normalizer (x/width, y/height) so the resulting landmarks carry MediaPipe's
// real per-axis scaling (x per-width, y per-height, z per-width). That lets
// the V-sign's tilt/aspect invariance be tested directly instead of only in
// the isotropic square space the existing fixtures provide.

export function makeNormalizer(frameW: number, frameH: number) {
	return (px: number, py: number): HandLandmark => ({
		x: px / frameW,
		y: py / frameH,
		z: 0,
	});
}

const PIXEL_DEG = Math.PI / 180;
function fingerDir(tiltDeg: number) {
	const a = tiltDeg * PIXEL_DEG;
	return { x: Math.sin(a), y: -Math.cos(a) };
}

interface PixelPoint {
	x: number;
	y: number;
}

/**
 * Build a 21-landmark hand with a true `spreadDeg` V (index and middle
 * extended and fanned, ring and pinky curled) rotated to `bisectorDeg`
 * (0 = fingers pointing up, 90 = pointing right), then normalized by `norm`.
 */
export function buildPixelVHand(
	spreadDeg: number,
	bisectorDeg: number,
	norm: (px: number, py: number) => HandLandmark,
): HandLandmark[] {
	const half = spreadDeg / 2;
	const idxDir = fingerDir(bisectorDeg - half);
	const midDir = fingerDir(bisectorDeg + half);
	const ringDir = fingerDir(bisectorDeg);
	const pinkyDir = fingerDir(bisectorDeg);
	const wrist: PixelPoint = { x: 320, y: 330 };
	const indexMcp: PixelPoint = { x: 312, y: 318 };
	const middleMcp: PixelPoint = { x: 332, y: 318 };
	const ringMcp: PixelPoint = { x: 348, y: 322 };
	const pinkyMcp: PixelPoint = { x: 360, y: 326 };
	const L = 70;
	const ext = (mcp: PixelPoint, dir: { x: number; y: number }) => ({
		pip: { x: mcp.x + dir.x * 0.45 * L, y: mcp.y + dir.y * 0.45 * L },
		tip: { x: mcp.x + dir.x * L, y: mcp.y + dir.y * L },
	});
	const curl = (mcp: PixelPoint, dir: { x: number; y: number }) => ({
		pip: { x: mcp.x + dir.x * 0.5 * L, y: mcp.y + dir.y * 0.5 * L },
		tip: { x: mcp.x + dir.x * 0.15 * L, y: mcp.y + dir.y * 0.15 * L },
	});
	const index = ext(indexMcp, idxDir);
	const middle = ext(middleMcp, midDir);
	const ring = curl(ringMcp, ringDir);
	const pinky = curl(pinkyMcp, pinkyDir);
	const lm: HandLandmark[] = new Array(21).fill(null).map(() => norm(320, 330));
	lm[0] = norm(wrist.x, wrist.y);
	lm[5] = norm(indexMcp.x, indexMcp.y);
	lm[6] = norm(index.pip.x, index.pip.y);
	lm[8] = norm(index.tip.x, index.tip.y);
	lm[9] = norm(middleMcp.x, middleMcp.y);
	lm[10] = norm(middle.pip.x, middle.pip.y);
	lm[12] = norm(middle.tip.x, middle.tip.y);
	lm[13] = norm(ringMcp.x, ringMcp.y);
	lm[14] = norm(ring.pip.x, ring.pip.y);
	lm[16] = norm(ring.tip.x, ring.tip.y);
	lm[17] = norm(pinkyMcp.x, pinkyMcp.y);
	lm[18] = norm(pinky.pip.x, pinky.pip.y);
	lm[20] = norm(pinky.tip.x, pinky.tip.y);
	return lm;
}

/**
 * Pure hand-pose classification over MediaPipe hand landmarks.
 *
 * No DOM, no model, no React — just the 21 landmarks in, a boolean out, so
 * the gesture rule can be unit-tested against synthetic hands.
 *
 * Landmark indices (see https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker):
 *   0 wrist · 1-4 thumb · 5-8 index · 9-12 middle · 13-16 ring · 17-20 pinky
 * Each finger runs MCP → PIP → DIP → TIP.
 */

export interface HandLandmark {
	x: number;
	y: number;
	z: number;
}

const WRIST = 0;

// [MCP, PIP, TIP] per finger. DIP is not needed for extension.
const INDEX = { pip: 6, tip: 8, mcp: 5 } as const;
const MIDDLE = { pip: 10, tip: 12, mcp: 9 } as const;
const RING = { pip: 14, tip: 16, mcp: 13 } as const;
const PINKY = { pip: 18, tip: 20, mcp: 17 } as const;

export const HAND_LANDMARK_COUNT = 21;

/**
 * Thresholds for the V ("peace sign") gesture.
 *
 * Everything here is scale- and rotation-invariant: distances are measured
 * from the wrist as ratios, and spread is an angle, so a hand near or far
 * from the camera and held at any tilt classifies the same — provided the
 * caller passes the frame `aspect` (width / height) so the angle can be
 * computed in an isotropic space. See `fingerSpreadDegrees`.
 *
 * How these were chosen: MediaPipe's normalized landmarks put a fully
 * extended fingertip roughly twice as far from the wrist as its PIP joint,
 * and a curled fingertip *inside* the PIP radius (ratio well under 1). The
 * two thresholds below straddle the geometric crossover at 1.0 with a
 * deliberate dead band in between, so a half-curled finger classifies as
 * neither and the gesture simply does not fire — better than a flicker.
 *
 * Spread: a deliberate V measures roughly 20-40 degrees between the two
 * finger direction vectors; two fingers held together measure under 10.
 * 15 degrees splits them with margin on both sides.
 *
 * To retune: raise MIN_SPREAD_DEG if the app fires on a two-finger point,
 * lower it if a real V is being missed. Raise EXTENDED_TIP_PIP_RATIO if a
 * lazily-curled ring finger keeps counting as extended.
 */
export const V_SIGN_THRESHOLDS = {
	/** Tip must be at least this many times farther from the wrist than its PIP. */
	EXTENDED_TIP_PIP_RATIO: 1.15,
	/** Tip must be no farther than this times its PIP distance to count as curled. */
	CURLED_TIP_PIP_RATIO: 1.0,
	/** Minimum angle, in degrees, between the index and middle finger vectors. */
	MIN_SPREAD_DEG: 15,
} as const;

/**
 * Plain Euclidean distance over normalized landmarks.
 *
 * Deliberately NOT aspect-corrected: its only caller (`fingerExtensionRatio`)
 * takes a ratio of two distances along the same finger, so the per-axis
 * anisotropy of MediaPipe's normalization (x/z per-width, y per-height)
 * cancels in the ratio. Correcting `dy` here would shift the curled/extended
 * thresholds for fingers whose tip and PIP fold in different directions,
 * with no benefit. The angle gate (`fingerSpreadDegrees`) is where the
 * anisotropy fails to cancel, and that is where correction is applied.
 */
function distance(a: HandLandmark, b: HandLandmark): number {
	const dx = a.x - b.x;
	const dy = a.y - b.y;
	const dz = a.z - b.z;
	return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/** Tip distance from the wrist, as a multiple of the PIP joint's distance. */
export function fingerExtensionRatio(
	landmarks: HandLandmark[],
	finger: { pip: number; tip: number },
): number {
	const wrist = landmarks[WRIST];
	const pipDistance = distance(landmarks[finger.pip], wrist);
	if (pipDistance === 0) return 0;
	return distance(landmarks[finger.tip], wrist) / pipDistance;
}

/**
 * Angle in degrees between two finger direction vectors (MCP → TIP).
 *
 * MediaPipe's `NormalizedLandmark` is NOT isotropic: `x` and `z` are
 * per-frame-width, while `y` is per-frame-height (per the
 * `@mediapipe/tasks-vision` contract). Computing the angle directly on
 * `(x, y, z)` would mix those units, so a hand at one tilt would measure a
 * different spread than the same hand rotated 90° — breaking the
 * rotation-invariance the V-sign contract depends on.
 *
 * `aspect` (frame width / height) brings `y` onto the `x`/`z` scale by
 * dividing `dy` by `aspect`. With all three axes in per-frame-width units
 * the angle becomes genuinely tilt-invariant. Pass the production frame
 * aspect from the camera/processing config; the default of `1` (a square
 * frame) leaves the math unchanged, so synthetic fixtures built in an
 * isotropic `[0,1]²` space behave exactly as before.
 */
export function fingerSpreadDegrees(
	landmarks: HandLandmark[],
	a: { mcp: number; tip: number },
	b: { mcp: number; tip: number },
	aspect = 1,
): number {
	const invAspect = 1 / aspect;
	const va = {
		x: landmarks[a.tip].x - landmarks[a.mcp].x,
		y: (landmarks[a.tip].y - landmarks[a.mcp].y) * invAspect,
		z: landmarks[a.tip].z - landmarks[a.mcp].z,
	};
	const vb = {
		x: landmarks[b.tip].x - landmarks[b.mcp].x,
		y: (landmarks[b.tip].y - landmarks[b.mcp].y) * invAspect,
		z: landmarks[b.tip].z - landmarks[b.mcp].z,
	};

	const magA = Math.sqrt(va.x * va.x + va.y * va.y + va.z * va.z);
	const magB = Math.sqrt(vb.x * vb.x + vb.y * vb.y + vb.z * vb.z);
	if (magA === 0 || magB === 0) return 0;

	const dot = va.x * vb.x + va.y * vb.y + va.z * vb.z;
	const cos = Math.min(Math.max(dot / (magA * magB), -1), 1);
	return (Math.acos(cos) * 180) / Math.PI;
}

/**
 * True when this hand is holding a V: index and middle extended and spread
 * apart, ring and pinky curled. The thumb is deliberately unconstrained —
 * people tuck it or stick it out and both read as a V.
 *
 * `aspect` (frame width / height) is forwarded to `fingerSpreadDegrees` so
 * the spread angle is computed in an isotropic space; without it the same
 * V would classify differently depending on the camera's tilt/aspect.
 */
export function isVSign(
	landmarks: HandLandmark[] | undefined | null,
	aspect = 1,
): boolean {
	if (!landmarks || landmarks.length < HAND_LANDMARK_COUNT) return false;

	const { EXTENDED_TIP_PIP_RATIO, CURLED_TIP_PIP_RATIO, MIN_SPREAD_DEG } =
		V_SIGN_THRESHOLDS;

	const indexExtended =
		fingerExtensionRatio(landmarks, INDEX) >= EXTENDED_TIP_PIP_RATIO;
	const middleExtended =
		fingerExtensionRatio(landmarks, MIDDLE) >= EXTENDED_TIP_PIP_RATIO;
	if (!indexExtended || !middleExtended) return false;

	const ringCurled =
		fingerExtensionRatio(landmarks, RING) <= CURLED_TIP_PIP_RATIO;
	const pinkyCurled =
		fingerExtensionRatio(landmarks, PINKY) <= CURLED_TIP_PIP_RATIO;
	if (!ringCurled || !pinkyCurled) return false;

	return (
		fingerSpreadDegrees(landmarks, INDEX, MIDDLE, aspect) >= MIN_SPREAD_DEG
	);
}

/** True when either hand in the frame is holding a V. */
export function anyHandIsVSign(
	hands: HandLandmark[][] | undefined,
	aspect = 1,
): boolean {
	if (!hands || hands.length === 0) return false;
	return hands.some((hand) => isVSign(hand, aspect));
}

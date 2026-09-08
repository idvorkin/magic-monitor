/**
 * Turns a per-frame "is the gesture showing?" signal into a single, deliberate
 * fire: the pose must survive a hold window, and after it fires the detector
 * goes deaf for a cooldown.
 *
 * Pure and clock-injected — no rAF, no DOM — so the debounce can be tested
 * frame by frame.
 */

export interface GestureHoldOptions {
	/** How long the pose must persist before it counts. */
	holdMs: number;
	/** How long after a fire (or an explicit cooldown) the detector ignores the pose. */
	cooldownMs: number;
	/**
	 * How long the pose may vanish without restarting the hold clock.
	 *
	 * The classifier is per-frame and imperfect: MediaPipe drops a hand for a
	 * frame when it blurs, and a finger that drifts into the extension dead
	 * band classifies as neither extended nor curled. Without a grace window
	 * one such frame in 20 resets the whole 600ms hold, which is why holding a
	 * V could feel like it never fired. Defaults to 0 — the caller decides.
	 */
	graceMs?: number;
}

export class GestureHold {
	private holdStart: number | null = null;
	/** When the pose was last seen, so a short dropout can be forgiven. */
	private lastActiveAt: number | null = null;
	private cooldownUntil = 0;
	private readonly options: GestureHoldOptions;
	private readonly graceMs: number;

	constructor(options: GestureHoldOptions) {
		this.options = options;
		this.graceMs = options.graceMs ?? 0;
	}

	/**
	 * Feed one observation. Returns true on exactly the frame the hold
	 * completes, and never again until the pose drops and the cooldown expires.
	 */
	update(active: boolean, now: number): boolean {
		if (!active) {
			// A gap shorter than the grace window is a dropped detection, not a
			// lowered hand: keep the original hold start so the clock runs on.
			if (
				this.holdStart !== null &&
				this.lastActiveAt !== null &&
				now - this.lastActiveAt > this.graceMs
			) {
				this.clearHold();
			}
			return false;
		}

		if (now < this.cooldownUntil) {
			// Hold time accrued during a cooldown does not count, otherwise a hand
			// parked in the pose fires the instant the cooldown lapses.
			this.clearHold();
			return false;
		}

		this.holdStart ??= now;
		this.lastActiveAt = now;
		if (now - this.holdStart < this.options.holdMs) return false;

		this.clearHold();
		this.cooldownUntil = now + this.options.cooldownMs;
		return true;
	}

	/** Start the cooldown without a fire — e.g. when a round ends by other means. */
	startCooldown(now: number): void {
		this.clearHold();
		this.cooldownUntil = now + this.options.cooldownMs;
	}

	reset(): void {
		this.clearHold();
		this.cooldownUntil = 0;
	}

	private clearHold(): void {
		this.holdStart = null;
		this.lastActiveAt = null;
	}
}

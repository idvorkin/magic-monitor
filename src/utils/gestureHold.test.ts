import { describe, expect, it } from "vitest";
import { GestureHold } from "./gestureHold";

const OPTIONS = { holdMs: 600, cooldownMs: 2000, graceMs: 150 };

/** Feed frames every 10ms and collect the times at which the hold fired. */
function run(
	hold: GestureHold,
	frames: Array<{ active: boolean; ms: number }>,
	startAt = 0,
): number[] {
	const fires: number[] = [];
	let now = startAt;
	for (const frame of frames) {
		for (let t = 0; t < frame.ms; t += 10) {
			if (hold.update(frame.active, now)) fires.push(now);
			now += 10;
		}
	}
	return fires;
}

describe("GestureHold", () => {
	it("does not fire immediately", () => {
		const hold = new GestureHold(OPTIONS);
		expect(hold.update(true, 0)).toBe(false);
	});

	it("fires once the pose has been held long enough", () => {
		const hold = new GestureHold(OPTIONS);
		expect(hold.update(true, 0)).toBe(false);
		expect(hold.update(true, 599)).toBe(false);
		expect(hold.update(true, 600)).toBe(true);
	});

	it("fires exactly once for one continuous hold", () => {
		const hold = new GestureHold(OPTIONS);
		const fires = run(hold, [{ active: true, ms: 1500 }]);
		expect(fires).toHaveLength(1);
	});

	it("ignores a pose that flickers past (gaps well past the grace window)", () => {
		const hold = new GestureHold(OPTIONS);
		const fires = run(hold, [
			{ active: true, ms: 300 },
			{ active: false, ms: 300 },
			{ active: true, ms: 300 },
			{ active: false, ms: 300 },
		]);
		expect(fires).toHaveLength(0);
	});

	it("restarts the hold when the pose drops for longer than the grace window", () => {
		const hold = new GestureHold(OPTIONS);
		expect(hold.update(true, 0)).toBe(false);
		expect(hold.update(true, 500)).toBe(false);
		expect(hold.update(false, 510)).toBe(false);
		// Absent 200ms, past the 150ms grace, so the 500ms banked is discarded.
		expect(hold.update(false, 700)).toBe(false);
		expect(hold.update(true, 710)).toBe(false);
		expect(hold.update(true, 1309)).toBe(false);
		expect(hold.update(true, 1310)).toBe(true);
	});

	it("survives a dropped detection mid-hold", () => {
		const hold = new GestureHold(OPTIONS);
		expect(hold.update(true, 0)).toBe(false);
		expect(hold.update(true, 300)).toBe(false);
		// One frame at 30fps where MediaPipe lost the hand.
		expect(hold.update(false, 333)).toBe(false);
		expect(hold.update(true, 366)).toBe(false);
		// The clock still started at 0, so it fires on schedule.
		expect(hold.update(true, 599)).toBe(false);
		expect(hold.update(true, 600)).toBe(true);
	});

	it("survives a scatter of dropped frames across the whole hold", () => {
		const hold = new GestureHold(OPTIONS);
		const DROPPED = new Set([132, 297, 462, 627]); // every 5th frame at 30fps
		const fires: number[] = [];
		for (let now = 0; now <= 900; now += 33) {
			if (hold.update(!DROPPED.has(now), now)) fires.push(now);
		}
		// Fires on the first classified frame at or past 600ms - 627 was dropped,
		// so 660 - rather than never firing at all.
		expect(fires).toEqual([660]);
	});

	it("defaults to no grace when graceMs is omitted", () => {
		const hold = new GestureHold({ holdMs: 600, cooldownMs: 2000 });
		expect(hold.update(true, 0)).toBe(false);
		expect(hold.update(true, 500)).toBe(false);
		expect(hold.update(false, 510)).toBe(false);
		// No grace: the single missed frame throws the 500ms away.
		expect(hold.update(true, 520)).toBe(false);
		expect(hold.update(true, 1110)).toBe(false);
		expect(hold.update(true, 1120)).toBe(true);
	});

	it("stays deaf through the cooldown even if the hand never moves", () => {
		const hold = new GestureHold(OPTIONS);
		const fires = run(hold, [{ active: true, ms: 2000 }]);
		expect(fires).toEqual([600]);
	});

	it("fires again once the cooldown has passed", () => {
		const hold = new GestureHold(OPTIONS);
		// 600ms hold -> fire at 600, cooldown to 2600, then a fresh 600ms hold.
		const fires = run(hold, [{ active: true, ms: 4000 }]);
		expect(fires[0]).toBe(600);
		expect(fires[1]).toBeGreaterThanOrEqual(2600 + OPTIONS.holdMs);
		expect(fires).toHaveLength(2);
	});

	it("does not bank hold time accrued during a cooldown", () => {
		const hold = new GestureHold(OPTIONS);
		hold.startCooldown(0);
		// Pose held right through the cooldown window.
		expect(hold.update(true, 1000)).toBe(false);
		expect(hold.update(true, 1999)).toBe(false);
		// Cooldown lapses at 2000; only now does the hold clock start.
		expect(hold.update(true, 2000)).toBe(false);
		expect(hold.update(true, 2599)).toBe(false);
		expect(hold.update(true, 2600)).toBe(true);
	});

	it("reset clears both the hold and the cooldown", () => {
		const hold = new GestureHold(OPTIONS);
		hold.startCooldown(0);
		hold.reset();
		expect(hold.update(true, 0)).toBe(false);
		expect(hold.update(true, 600)).toBe(true);
	});
});

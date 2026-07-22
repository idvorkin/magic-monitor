import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	SessionRecorderMachine,
	type SessionRecorderState,
} from "./SessionRecorderMachine";

function createMockCallbacks() {
	return {
		onStartRecording: vi.fn(),
		onStopRecording: vi.fn().mockResolvedValue({
			blob: new Blob(["test"], { type: "video/webm" }),
			duration: 5000,
		}),
		onStartThumbnails: vi.fn(),
		onStopThumbnails: vi.fn().mockReturnValue([]),
		onStartBlockTimer: vi.fn(),
		onStopBlockTimer: vi.fn(),
		onSaveBlock: vi.fn().mockResolvedValue(undefined),
		onStateChange: vi.fn(),
		now: vi.fn().mockReturnValue(1000),
	};
}

describe("SessionRecorderMachine", () => {
	let callbacks: ReturnType<typeof createMockCallbacks>;
	let machine: SessionRecorderMachine;

	beforeEach(() => {
		vi.clearAllMocks();
		callbacks = createMockCallbacks();
		machine = new SessionRecorderMachine(callbacks);
	});

	describe("initial state", () => {
		it("starts in idle state", () => {
			expect(machine.getState()).toEqual({ type: "idle" });
		});

		it("is not recording initially", () => {
			expect(machine.isRecording()).toBe(false);
		});
	});

	describe("enable/disable", () => {
		it("transitions to initializing when enabled", () => {
			machine.enable();

			expect(machine.getState()).toEqual({ type: "initializing" });
			expect(callbacks.onStateChange).toHaveBeenCalledWith({
				type: "initializing",
			});
		});

		it("transitions to idle when disabled", async () => {
			machine.enable();
			await machine.disable();

			expect(machine.getState()).toEqual({ type: "idle" });
		});

		it("does nothing if already enabled", () => {
			machine.enable();
			callbacks.onStateChange.mockClear();

			machine.enable();

			expect(callbacks.onStateChange).not.toHaveBeenCalled();
		});

		it("does nothing if already disabled", async () => {
			await machine.disable();

			expect(callbacks.onStateChange).not.toHaveBeenCalled();
		});
	});

	describe("storage initialization", () => {
		it("transitions to waitingForVideo when storage ready", () => {
			machine.enable();
			machine.storageInitialized();

			expect(machine.getState()).toEqual({ type: "waitingForVideo" });
		});

		it("stays in initializing if not enabled", () => {
			machine.storageInitialized();

			expect(machine.getState()).toEqual({ type: "idle" });
		});

		it("transitions to idle on storage init failure", () => {
			machine.enable();
			machine.storageInitFailed();

			expect(machine.getState()).toEqual({ type: "idle" });
		});
	});

	describe("video readiness", () => {
		it("starts recording when video becomes ready", () => {
			machine.enable();
			machine.storageInitialized();
			machine.videoIsReady();

			expect(machine.getState()).toEqual({
				type: "recording",
				blockStart: 1000,
			});
			expect(machine.isRecording()).toBe(true);
		});

		it("calls all start callbacks when recording starts", () => {
			machine.enable();
			machine.storageInitialized();
			machine.videoIsReady();

			expect(callbacks.onStartRecording).toHaveBeenCalled();
			expect(callbacks.onStartThumbnails).toHaveBeenCalledWith(1000);
			expect(callbacks.onStartBlockTimer).toHaveBeenCalled();
		});

		it("does not start if not enabled", () => {
			machine.storageInitialized();
			machine.videoIsReady();

			expect(machine.isRecording()).toBe(false);
		});

		it("does not start if storage not ready", () => {
			machine.enable();
			machine.videoIsReady();

			expect(machine.isRecording()).toBe(false);
			expect(machine.getState()).toEqual({ type: "initializing" });
		});
	});

	describe("stopCurrentBlock", () => {
		it("stops recording and saves block", async () => {
			machine.enable();
			machine.storageInitialized();
			machine.videoIsReady();

			await machine.stopCurrentBlock();

			expect(callbacks.onStopBlockTimer).toHaveBeenCalled();
			expect(callbacks.onStopThumbnails).toHaveBeenCalled();
			expect(callbacks.onStopRecording).toHaveBeenCalled();
			expect(callbacks.onSaveBlock).toHaveBeenCalledWith(
				expect.any(Blob),
				5000,
				[],
				1000,
			);
		});

		it("does not save if recording returns null", async () => {
			callbacks.onStopRecording.mockResolvedValue(null);

			machine.enable();
			machine.storageInitialized();
			machine.videoIsReady();

			await machine.stopCurrentBlock();

			expect(callbacks.onSaveBlock).not.toHaveBeenCalled();
		});

		it("does not save if blob is empty", async () => {
			callbacks.onStopRecording.mockResolvedValue({
				blob: new Blob([], { type: "video/webm" }),
				duration: 0,
			});

			machine.enable();
			machine.storageInitialized();
			machine.videoIsReady();

			await machine.stopCurrentBlock();

			expect(callbacks.onSaveBlock).not.toHaveBeenCalled();
		});

		it("starts the next block immediately when still enabled and ready", async () => {
			machine.enable();
			machine.storageInitialized();
			machine.videoIsReady();

			await machine.stopCurrentBlock();

			// Contract change (H2 fix): a completed stop re-runs the transition
			// ladder instead of parking in waitingForVideo forever.
			expect(machine.getState()).toEqual({
				type: "recording",
				blockStart: 1000,
			});
			expect(callbacks.onStartRecording).toHaveBeenCalledTimes(2);
		});

		it("transitions to idle if disabled during stop", async () => {
			machine.enable();
			machine.storageInitialized();
			machine.videoIsReady();
			await machine.disable();

			// After disable completes its stopCurrentBlock
			expect(machine.getState()).toEqual({ type: "idle" });
		});

		it("does nothing if not recording", async () => {
			await machine.stopCurrentBlock();

			expect(callbacks.onStopRecording).not.toHaveBeenCalled();
		});

		it("recovers when disable() interleaves with an in-flight stop (pause/resume race)", async () => {
			machine.enable();
			machine.storageInitialized();
			machine.videoIsReady();

			// Hold the stop open so we can interleave inputs mid-flight
			let resolveStop!: (v: { blob: Blob; duration: number }) => void;
			callbacks.onStopRecording.mockReturnValueOnce(
				new Promise((r) => {
					resolveStop = r;
				}),
			);

			const stopPromise = machine.stopCurrentBlock();
			machine.disable(); // pause while stopping
			machine.enable(); // resume while still stopping
			resolveStop({
				blob: new Blob(["x"], { type: "video/webm" }),
				duration: 1000,
			});
			await stopPromise;

			expect(machine.getState().type).toBe("recording");
		});

		it("returns to waitingForVideo (and later resumes) if video went away during stop", async () => {
			machine.enable();
			machine.storageInitialized();
			machine.videoIsReady();

			let resolveStop!: (v: { blob: Blob; duration: number }) => void;
			callbacks.onStopRecording.mockReturnValueOnce(
				new Promise((r) => {
					resolveStop = r;
				}),
			);

			const stopPromise = machine.stopCurrentBlock();
			machine.videoNotReady();
			resolveStop({
				blob: new Blob(["x"], { type: "video/webm" }),
				duration: 1000,
			});
			await stopPromise;

			expect(machine.getState()).toEqual({ type: "waitingForVideo" });

			machine.videoIsReady();
			expect(machine.getState().type).toBe("recording");
		});

		it("stop with disable:true does not restart and lands idle atomically", async () => {
			machine.enable();
			machine.storageInitialized();
			machine.videoIsReady();

			await machine.stopCurrentBlock({ disable: true });

			expect(machine.getState()).toEqual({ type: "idle" });
			expect(callbacks.onStartRecording).toHaveBeenCalledTimes(1); // no restart

			machine.enable(); // returning to live resumes
			expect(machine.getState().type).toBe("recording");
		});
	});

	describe("blockTimerFired", () => {
		it("stops current block and starts new one", async () => {
			machine.enable();
			machine.storageInitialized();
			machine.videoIsReady();

			callbacks.onStartRecording.mockClear();
			callbacks.now.mockReturnValue(2000);

			await machine.blockTimerFired();

			// Should have stopped and started again
			expect(callbacks.onStopRecording).toHaveBeenCalled();
			expect(callbacks.onSaveBlock).toHaveBeenCalled();
			expect(callbacks.onStartRecording).toHaveBeenCalled();
			expect(machine.getState()).toEqual({
				type: "recording",
				blockStart: 2000,
			});
		});

		it("does not start new block if disabled", async () => {
			machine.enable();
			machine.storageInitialized();
			machine.videoIsReady();

			callbacks.onStartRecording.mockClear();

			// Disable and wait for it to complete
			await machine.disable();

			expect(machine.getState()).toEqual({ type: "idle" });
			// startRecording should not have been called again after disable
			expect(callbacks.onStartRecording).not.toHaveBeenCalled();
		});

		it("does not start new block if video not ready", async () => {
			machine.enable();
			machine.storageInitialized();
			machine.videoIsReady();

			callbacks.onStartRecording.mockClear();
			await machine.videoNotReady();

			// After video becomes unavailable, should stop and not restart
			expect(machine.isRecording()).toBe(false);
		});

		it("does nothing if not recording", async () => {
			await machine.blockTimerFired();

			expect(callbacks.onStopRecording).not.toHaveBeenCalled();
		});
	});

	describe("videoNotReady", () => {
		it("stops recording when video becomes unavailable", async () => {
			machine.enable();
			machine.storageInitialized();
			machine.videoIsReady();

			await machine.videoNotReady();

			expect(callbacks.onStopRecording).toHaveBeenCalled();
		});

		it("does nothing if not recording", async () => {
			await machine.videoNotReady();

			expect(callbacks.onStopRecording).not.toHaveBeenCalled();
		});
	});

	describe("state transitions sequence", () => {
		it("full lifecycle: enable -> init -> video -> record -> stop -> record -> disable -> idle", async () => {
			const states: string[] = [];
			callbacks.onStateChange.mockImplementation(
				(state: SessionRecorderState) => {
					states.push(state.type);
				},
			);

			machine.enable();
			machine.storageInitialized();
			machine.videoIsReady();
			await machine.stopCurrentBlock();
			await machine.disable();

			expect(states).toEqual([
				"initializing",
				"waitingForVideo",
				"recording",
				"stopping",
				// Contract change (H2 fix): the manual stop above completes with
				// everything still enabled/ready, so it re-runs the transition
				// ladder and restarts recording immediately instead of parking.
				"recording",
				"stopping",
				"idle",
			]);
		});

		it("handles rapid enable/disable without crash", async () => {
			machine.enable();
			await machine.disable();
			machine.enable();
			await machine.disable();
			machine.enable();

			expect(machine.getState()).toEqual({ type: "initializing" });
		});
	});

	describe("save-failure resilience (M8)", () => {
		it("keeps rotating blocks and counts consecutive save failures", async () => {
			machine.enable();
			machine.storageInitialized();
			machine.videoIsReady();

			callbacks.onSaveBlock.mockResolvedValueOnce(null); // save fails
			await machine.stopCurrentBlock();

			expect(machine.getConsecutiveSaveFailures()).toBe(1);
			expect(machine.getState().type).toBe("recording"); // still rotating

			callbacks.onSaveBlock.mockResolvedValueOnce({} as never); // save succeeds
			await machine.stopCurrentBlock();
			expect(machine.getConsecutiveSaveFailures()).toBe(0); // reset on success
		});
	});

	describe("recorderFailed (M1)", () => {
		function startRecordingMachine() {
			machine.enable();
			machine.storageInitialized();
			machine.videoIsReady();
		}

		it("salvages what it can and restarts recording", async () => {
			startRecordingMachine();

			await machine.recorderFailed({
				blob: new Blob(["salvaged"], { type: "video/webm" }),
				duration: 1200,
			});

			expect(callbacks.onStopBlockTimer).toHaveBeenCalled();
			expect(callbacks.onStopThumbnails).toHaveBeenCalled();
			expect(callbacks.onStopRecording).not.toHaveBeenCalled(); // recorder already dead
			expect(callbacks.onSaveBlock).toHaveBeenCalledTimes(1);
			expect(machine.getState().type).toBe("recording"); // restarted
		});

		it("restarts without saving when nothing was salvaged", async () => {
			startRecordingMachine();
			await machine.recorderFailed(null);
			expect(callbacks.onSaveBlock).not.toHaveBeenCalled();
			expect(machine.getState().type).toBe("recording");
		});

		it("parks after 3 consecutive failures instead of hot-looping", async () => {
			startRecordingMachine();
			await machine.recorderFailed(null);
			await machine.recorderFailed(null);
			await machine.recorderFailed(null);
			expect(machine.getState()).toEqual({ type: "idle" });

			// User-driven resume retries fresh
			machine.disable();
			machine.enable();
			expect(machine.getState().type).toBe("recording");
		});

		it("ignores failure reports when not recording", async () => {
			await machine.recorderFailed(null);
			expect(callbacks.onStopBlockTimer).not.toHaveBeenCalled();
		});
	});

	describe("getNotRecordingReason", () => {
		it("is null while recording and null while disabled", () => {
			expect(machine.getNotRecordingReason()).toBeNull(); // disabled
			machine.enable();
			machine.storageInitialized();
			machine.videoIsReady();
			expect(machine.getNotRecordingReason()).toBeNull(); // recording
		});

		it("reports starting during benign transitions", () => {
			machine.enable();
			expect(machine.getNotRecordingReason()).toBe("starting");
		});

		it("reports storage-error on init failure and repeated save failures", async () => {
			machine.enable();
			machine.storageInitFailed();
			expect(machine.getNotRecordingReason()).toBe("storage-error");
		});

		it("reports recorder-error after the 3-strike park", async () => {
			machine.enable();
			machine.storageInitialized();
			machine.videoIsReady();
			await machine.recorderFailed(null);
			await machine.recorderFailed(null);
			await machine.recorderFailed(null);
			expect(machine.getNotRecordingReason()).toBe("recorder-error");
		});

		it("keeps storage-error sticky when video becomes ready later", () => {
			machine.enable();
			machine.storageInitFailed();
			machine.videoIsReady(); // walks state idle -> initializing
			expect(machine.getNotRecordingReason()).toBe("storage-error");
		});

		it("keeps storage-error sticky across disable/enable (pause/resume)", async () => {
			machine.enable();
			machine.storageInitFailed();
			await machine.disable();
			machine.enable();
			expect(machine.getNotRecordingReason()).toBe("storage-error");
		});
	});
});

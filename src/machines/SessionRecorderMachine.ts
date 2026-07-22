import type { PracticeSession, SessionThumbnail } from "../types/sessions";

// ===== State Types =====

export type SessionRecorderState =
	| { type: "idle" }
	| { type: "initializing" } // waiting for storage init
	| { type: "waitingForVideo" } // storage ready, waiting for video
	| { type: "recording"; blockStart: number }
	| { type: "stopping" };

export type NotRecordingReason =
	| "storage-error"
	| "recorder-error"
	| "starting";

// ===== Callback Types =====

export interface SessionRecorderCallbacks {
	// Recording lifecycle
	onStartRecording: () => void;
	onStopRecording: () => Promise<{ blob: Blob; duration: number } | null>;

	// Thumbnail lifecycle
	onStartThumbnails: (blockStartTime: number) => void;
	onStopThumbnails: () => SessionThumbnail[];

	// Block timer lifecycle
	onStartBlockTimer: () => void;
	onStopBlockTimer: () => void;

	// Persistence - returns saved session or null
	onSaveBlock: (
		blob: Blob,
		duration: number,
		thumbnails: SessionThumbnail[],
		blockStartTime: number,
	) => Promise<PracticeSession | null>;

	// State observation
	onStateChange: (state: SessionRecorderState) => void;

	// Time provider (for testing)
	now: () => number;
}

// ===== State Machine =====

/**
 * Pure state machine for session recording coordination.
 * No React, no timers, no async - just state transitions.
 * All side effects happen through injected callbacks.
 */
export class SessionRecorderMachine {
	private state: SessionRecorderState = { type: "idle" };
	private enabled = false;
	private videoReady = false;
	private storageReady = false;
	// Sticky: set by storageInitFailed(), cleared only by storageInitialized().
	// NOT reset in enable() - unlike recorder failures, storage init happens
	// exactly once (no retry path), so re-enabling can't fix it.
	private storageFailed = false;
	private consecutiveSaveFailures = 0;
	private consecutiveRecorderFailures = 0;
	private callbacks: SessionRecorderCallbacks;

	constructor(callbacks: SessionRecorderCallbacks) {
		this.callbacks = callbacks;
	}

	// ===== State Accessors =====

	getState(): SessionRecorderState {
		return this.state;
	}

	isRecording(): boolean {
		return this.state.type === "recording";
	}

	getConsecutiveSaveFailures(): number {
		return this.consecutiveSaveFailures;
	}

	/**
	 * Why recording is not running, from the machine's own point of view.
	 * null while recording, and null while intentionally disabled (pausing is
	 * the caller's concept, not the machine's).
	 */
	getNotRecordingReason(): NotRecordingReason | null {
		if (this.state.type === "recording") return null;
		if (!this.enabled) return null;
		if (this.consecutiveRecorderFailures >= 3) return "recorder-error";
		// `storageFailed` (not merely `!storageReady`) distinguishes a genuine
		// storageInitFailed() from the not-yet-initialized window after
		// enable() - both leave storageReady false, but only the former means
		// storage is broken rather than just not-yet-ready. It is sticky so
		// later transitions (videoIsReady, disable/enable) can't launder a
		// broken storage state into "starting".
		if (this.storageFailed || this.consecutiveSaveFailures >= 2) {
			return "storage-error";
		}
		return "starting";
	}

	// ===== Input Methods =====

	/**
	 * Called when recording is enabled by the user.
	 */
	enable(): void {
		if (this.enabled) return;
		this.enabled = true;
		this.consecutiveSaveFailures = 0;
		this.consecutiveRecorderFailures = 0;
		this.tryTransition();
	}

	/**
	 * Called when recording is disabled by the user.
	 * Returns a promise that resolves when any in-progress recording is stopped.
	 */
	async disable(): Promise<void> {
		if (!this.enabled) return;
		this.enabled = false;

		// If recording, trigger stop and wait for it
		if (this.state.type === "recording") {
			await this.stopCurrentBlock();
		} else {
			this.setState({ type: "idle" });
		}
	}

	/**
	 * Called when storage initialization completes.
	 */
	storageInitialized(): void {
		this.storageFailed = false;
		if (this.storageReady) return;
		this.storageReady = true;
		this.tryTransition();
	}

	/**
	 * Called when storage initialization fails.
	 */
	storageInitFailed(): void {
		this.storageReady = false;
		this.storageFailed = true;
		this.setState({ type: "idle" });
	}

	/**
	 * Called when video element becomes ready (readyState >= 3).
	 */
	videoIsReady(): void {
		if (this.videoReady) return;
		this.videoReady = true;
		this.tryTransition();
	}

	/**
	 * Called when video element is no longer available.
	 * Returns a promise that resolves when any in-progress recording is stopped.
	 */
	async videoNotReady(): Promise<void> {
		if (!this.videoReady) return;
		this.videoReady = false;

		// If recording, we need to stop
		if (this.state.type === "recording") {
			await this.stopCurrentBlock();
		}
	}

	/**
	 * Called when the block rotation timer fires.
	 * Completes the current block; the completing transition starts the next
	 * one if still enabled and ready.
	 */
	async blockTimerFired(): Promise<void> {
		if (this.state.type !== "recording") return;
		await this.stopCurrentBlock();
	}

	/**
	 * Called when the recorder died mid-block (the adapter already cleaned up
	 * its refs/stream). Salvages what was captured, then restarts - unless
	 * failures are repeating, in which case park visibly rather than hot-loop.
	 */
	async recorderFailed(
		salvaged: { blob: Blob; duration: number } | null,
	): Promise<void> {
		if (this.state.type !== "recording") return;

		const blockStart = this.state.blockStart;
		this.setState({ type: "stopping" });

		this.callbacks.onStopBlockTimer();
		const thumbnails = this.callbacks.onStopThumbnails();
		// No onStopRecording: the recorder is already dead.

		if (salvaged && salvaged.blob.size > 0) {
			const saved = await this.callbacks.onSaveBlock(
				salvaged.blob,
				salvaged.duration,
				thumbnails,
				blockStart,
			);
			this.consecutiveSaveFailures =
				saved === null ? this.consecutiveSaveFailures + 1 : 0;
		}

		this.consecutiveRecorderFailures += 1;
		if (this.consecutiveRecorderFailures >= 3) {
			this.setState({ type: "idle" });
			return;
		}

		this.tryTransition({ fromStop: true });
	}

	/**
	 * Manually stop the current recording block.
	 * Returns the saved session or null if not recording or save failed.
	 *
	 * disable: atomically stop AND disable - for callers about to leave live
	 * mode, so the completing transition cannot restart recording before the
	 * caller's disable() arrives.
	 */
	async stopCurrentBlock(
		options: { disable?: boolean } = {},
	): Promise<PracticeSession | null> {
		if (this.state.type !== "recording") return null;

		const blockStart = this.state.blockStart;
		this.setState({ type: "stopping" });

		// Stop all components
		this.callbacks.onStopBlockTimer();
		const thumbnails = this.callbacks.onStopThumbnails();
		const result = await this.callbacks.onStopRecording();

		// Save if we got a recording
		let savedSession: PracticeSession | null = null;
		if (result && result.blob.size > 0) {
			savedSession = await this.callbacks.onSaveBlock(
				result.blob,
				result.duration,
				thumbnails,
				blockStart,
			);
			this.consecutiveSaveFailures =
				savedSession === null ? this.consecutiveSaveFailures + 1 : 0;
		}

		if (savedSession !== null) {
			this.consecutiveRecorderFailures = 0;
		}

		if (options.disable) {
			// Disable atomically before the completing transition so it lands
			// idle with no window for a restart.
			this.enabled = false;
		}

		// Never park: re-run the transition ladder now that the stop is done (H2).
		this.tryTransition({ fromStop: true });

		return savedSession;
	}

	// ===== Private Methods =====

	private setState(newState: SessionRecorderState): void {
		this.state = newState;
		this.callbacks.onStateChange(newState);
	}

	/**
	 * Attempt to transition based on current conditions.
	 * `fromStop` marks the call that completes an in-flight stop — it alone
	 * may leave the "stopping" state.
	 */
	private tryTransition(options: { fromStop?: boolean } = {}): void {
		// Not enabled? Stay idle
		if (!this.enabled) {
			if (this.state.type !== "idle") {
				this.setState({ type: "idle" });
			}
			return;
		}

		// Enabled but storage not ready? Initialize
		if (!this.storageReady) {
			if (this.state.type !== "initializing") {
				this.setState({ type: "initializing" });
			}
			return;
		}

		// Storage ready but video not ready? Wait
		if (!this.videoReady) {
			if (this.state.type !== "waitingForVideo") {
				this.setState({ type: "waitingForVideo" });
			}
			return;
		}

		// Everything ready and nothing in flight? Start!
		if (
			this.state.type !== "recording" &&
			(this.state.type !== "stopping" || options.fromStop)
		) {
			this.startRecordingBlock();
		}
	}

	private startRecordingBlock(): void {
		const blockStart = this.callbacks.now();
		this.setState({ type: "recording", blockStart });

		// Start all components
		this.callbacks.onStartRecording();
		this.callbacks.onStartThumbnails(blockStart);
		this.callbacks.onStartBlockTimer();
	}
}

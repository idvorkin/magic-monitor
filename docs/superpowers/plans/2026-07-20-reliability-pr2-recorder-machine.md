# Reliability Sweep PR2: Recorder Machine Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recording never silently dies: no dead-end machine states (H2), no stale-stop clobbering (H3), mid-block recorder failures are observed and recovered (M1), save errors don't masquerade as storage death (M8), camera switches stop/save/resume cleanly (H4), and the REC indicator tells the truth.

**Architecture:** Spec: `docs/superpowers/specs/2026-07-20-reliability-sweep-design.md` Section 2 (also on branch `pr/reliability-sweep-spec`; fetch via `git show origin/pr/reliability-sweep-spec:docs/...` if absent). All changes live in `SessionRecorderMachine` + its adapters (`useSessionRecorder`, `useBlockRecorder`), `MediaRecorderService`, `useSessionList` (one new field), and the CameraStage status bar. The machine stays pure (no React, no timers, injected callbacks + clock).

**Tech Stack:** TypeScript, Vitest (+ @testing-library/react renderHook), existing DI seams (`timerService`, `mediaRecorderService`, `sessionStorageService`).

## Global Constraints

- Branch: `pr/reliability-recorder` off `origin/main` **rebased onto / branched from the merged PR1 state** — if PR1 (`pr/reliability-tests`) is not yet merged, branch off `pr/reliability-tests` instead so the E2E foundation (deterministic mock, port 5273, un-skipped recording tests, keystone test) is present. Never push to main. Never `--no-verify`. Never `git add -A` without reviewing `git status`.
- Pre-commit runs Biome (tabs, double quotes) + checks; watch for the `[branch sha]` confirmation line after each commit — if missing, re-stage and retry.
- TDD per bug: failing test FIRST, watch it fail, then fix. TDD evidence (RED output, GREEN output) goes in the report.
- Never delete a failing test. Exception, explicitly sanctioned here: `SessionRecorderMachine.test.ts:184` ("transitions to waitingForVideo if still enabled and ready") codifies bug H2 as intended behavior — Task 2 REWRITES this test's assertion to the new contract. That is a deliberate contract change, not a test deletion; the commit message must say so.
- CPU discipline: prefix every test-suite/E2E/build run with `nice -n 19 ionice -c 3`; Playwright runs use `--workers=2`.
- Commit messages end with: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`
- Machine purity: `SessionRecorderMachine.ts` must not import React, timers, or services — inputs and injected callbacks only.
- Spec deviations already adjudicated (do not re-litigate in-task): (a) H4 moves fully into this PR (spec Section 7 listed it under PR3, but every file it touches is a PR2 file); (b) the generation token lives in `useBlockRecorder`, not the machine — the refs it protects live there, and the machine's state guard (`"stopping"` blocks re-entry) already serializes machine-level stops once Task 2 lands; (c) `enable()`/`videoIsReady()`/`storageInitialized()` KEEP their early-return guards — they are safe once `stopCurrentBlock` always re-runs the transition ladder (Task 2), and removing them would invite re-entrant transitions.

## Verification commands

- Focused: `nice -n 19 ionice -c 3 npx vitest run src/machines/SessionRecorderMachine.test.ts` (substitute file under test)
- Full unit: `nice -n 19 ionice -c 3 npx vitest run`
- Type check: `npx tsc -b`
- E2E (Task 9 only): `nice -n 19 ionice -c 3 npx playwright test --project=chromium --workers=2`

---

### Task 1: `useLatest` helper + collapse the 7× ref-mirroring

**Files:**
- Create: `src/hooks/useLatest.ts`
- Create: `src/hooks/useLatest.test.ts`
- Modify: `src/hooks/useSessionRecorder.ts:105-142` (the two mirror blocks)

**Interfaces:**
- Produces: `useLatest<T>(value: T): React.RefObject<T>` — later tasks (5) mirror new callbacks with it.

- [ ] **Step 1: Write the failing test**

`src/hooks/useLatest.test.ts`:

```typescript
import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useLatest } from "./useLatest";

describe("useLatest", () => {
	it("returns a ref holding the latest value across re-renders", () => {
		const { result, rerender } = renderHook(({ value }) => useLatest(value), {
			initialProps: { value: 1 },
		});
		const firstRef = result.current;
		expect(firstRef.current).toBe(1);

		rerender({ value: 2 });
		expect(result.current).toBe(firstRef); // stable ref identity
		expect(result.current.current).toBe(2); // latest value
	});
});
```

- [ ] **Step 2: Run it — expect FAIL** (`Cannot find module './useLatest'`)

Run: `nice -n 19 ionice -c 3 npx vitest run src/hooks/useLatest.test.ts`

- [ ] **Step 3: Implement `src/hooks/useLatest.ts`**

```typescript
import { useEffect, useRef } from "react";

/**
 * Returns a ref that always holds the latest value.
 * Use to hand fresh callbacks to long-lived consumers (state machines,
 * event handlers) without recreating them.
 */
export function useLatest<T>(value: T): React.RefObject<T> {
	const ref = useRef(value);
	useEffect(() => {
		ref.current = value;
	});
	return ref;
}
```

- [ ] **Step 4: Run test — expect PASS**

- [ ] **Step 5: Refactor `useSessionRecorder.ts`**

Replace lines 105-119 (5 refs + sync effect) and lines 136-142 (2 rotation refs + sync effect) with:

```typescript
	// Latest-callback refs so the machine never needs to be recreated
	const startRecordingRef = useLatest(startRecording);
	const stopRecordingRef = useLatest(stopRecording);
	const startCaptureRef = useLatest(startCapture);
	const stopCaptureRef = useLatest(stopCapture);
	const saveBlockRef = useLatest(saveBlock);
```

and (after the `useBlockRotation` destructure, replacing the second mirror block):

```typescript
	const startRotationRef = useLatest(startRotation);
	const stopRotationRef = useLatest(stopRotation);
```

Add `import { useLatest } from "./useLatest";` and remove the now-unused mirror `useEffect`s. All consumer sites (`startRecordingRef.current()` etc. in the machine-construction effect) are unchanged — `useLatest` returns the same `.current` shape.

- [ ] **Step 6: Verify no behavior change**

Run: `nice -n 19 ionice -c 3 npx vitest run src/hooks/useSessionRecorder.test.ts src/hooks/useLatest.test.ts`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add src/hooks/useLatest.ts src/hooks/useLatest.test.ts src/hooks/useSessionRecorder.ts
git commit -m "refactor: collapse hand-rolled ref mirrors into useLatest helper

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: H2 — no dead-end states in the machine

**Files:**
- Modify: `src/machines/SessionRecorderMachine.ts` (`stopCurrentBlock` lines 156-186, `tryTransition` lines 198-230, `blockTimerFired` lines 141-150)
- Modify: `src/machines/SessionRecorderMachine.test.ts` (rewrite test at line 184; add three tests)

**Interfaces:**
- Consumes: nothing new.
- Produces: `stopCurrentBlock()` now ends by re-running the transition ladder — after a manual stop with everything still ready, the machine is `{ type: "recording" }` again (new contract relied on by Tasks 4, 5, 6).
- Public API unchanged: `tryTransition` stays private; its new options parameter is internal.

**Context — the bug:** `stopCurrentBlock()` manually parks in `waitingForVideo` (line 180) and nothing ever escapes: `enable()`/`storageInitialized()`/`videoIsReady()` all early-return because their flags are already true. Both UI entry points (`handleOpenPicker`, `handleStopAndViewRecording` in CameraStage) hit this. `blockTimerFired` works around it with bespoke duplicate logic (lines 146-149) that this task absorbs.

- [ ] **Step 1: Rewrite the codified-bug test + add failing tests**

In `SessionRecorderMachine.test.ts`, replace the test at lines 184-192 with:

```typescript
		it("starts the next block immediately when still enabled and ready", async () => {
			machine.enable();
			machine.storageInitialized();
			machine.videoIsReady();

			await machine.stopCurrentBlock();

			// Contract change (H2 fix): a completed stop re-runs the transition
			// ladder instead of parking in waitingForVideo forever.
			expect(machine.getState()).toEqual({ type: "recording", blockStart: 1000 });
			expect(callbacks.onStartRecording).toHaveBeenCalledTimes(2);
		});
```

Add inside `describe("stopCurrentBlock")`:

```typescript
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
			resolveStop({ blob: new Blob(["x"], { type: "video/webm" }), duration: 1000 });
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
			resolveStop({ blob: new Blob(["x"], { type: "video/webm" }), duration: 1000 });
			await stopPromise;

			expect(machine.getState()).toEqual({ type: "waitingForVideo" });

			machine.videoIsReady();
			expect(machine.getState().type).toBe("recording");
		});
```

Note on `disable()` during `"stopping"`: `disable()`'s else-branch sets `{ type: "idle" }` while a stop is in flight — that's fine; the completing stop re-runs the ladder and `enable()`'s call above re-set `enabled = true` before it completes.

- [ ] **Step 2: Run — expect the three tests to FAIL** (first: state is `waitingForVideo`, `onStartRecording` called once)

Run: `nice -n 19 ionice -c 3 npx vitest run src/machines/SessionRecorderMachine.test.ts`

- [ ] **Step 3: Implement**

In `SessionRecorderMachine.ts`:

Replace `stopCurrentBlock` lines 178-183 (the manual transition) so the method ends:

```typescript
		// Never park: re-run the transition ladder now that the stop is done (H2).
		this.tryTransition({ fromStop: true });

		return savedSession;
```

Change `tryTransition` signature and the final guard:

```typescript
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
```

Simplify `blockTimerFired` — its bespoke restart is now redundant:

```typescript
	/**
	 * Called when the block rotation timer fires.
	 * Completes the current block; the completing transition starts the next
	 * one if still enabled and ready.
	 */
	async blockTimerFired(): Promise<void> {
		if (this.state.type !== "recording") return;
		await this.stopCurrentBlock();
	}
```

- [ ] **Step 4: Run the machine suite — expect ALL PASS** (including the untouched `blockTimerFired` describe block: "stops current block and starts new one" now passes via the generalized path)

Run: `nice -n 19 ionice -c 3 npx vitest run src/machines/SessionRecorderMachine.test.ts`

- [ ] **Step 5: Full unit suite** — `useSessionRecorder.test.ts` exercises the machine through the hook; confirm nothing depended on the parked state.

Run: `nice -n 19 ionice -c 3 npx vitest run`
Expected: all pass. If a hook test asserted the old parking behavior, rewrite its expectation with the same justification as Step 1 and note it in the report.

- [ ] **Step 6: Commit**

```bash
git add src/machines/SessionRecorderMachine.ts src/machines/SessionRecorderMachine.test.ts
git commit -m "fix: recorder machine never parks in a dead state after a stop (H2)

stopCurrentBlock re-runs the transition ladder when the stop completes,
so stop-and-view and pause/resume races resume recording instead of
wedging in waitingForVideo. blockTimerFired's bespoke restart is now
redundant and removed. Rewrites the test that codified the parked state
as intended behavior - deliberate contract change.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: H3 — generation token in `useBlockRecorder`

**Files:**
- Modify: `src/hooks/useBlockRecorder.ts` (`startRecording` lines 60-133, `stopRecording` lines 144-175)
- Modify: `src/hooks/useBlockRecorder.test.ts` (add one test)

**Interfaces:**
- Public shapes unchanged (`BlockRecorderConfig`, `BlockRecorderControls`, `StopRecordingOptions`).
- Produces: internal `generationRef` pattern; Task 5's `onFailure` handler reuses the same `generation` capture.

**Context — the bug:** `stopRecording` captures `session` then awaits `session.stop()`; if a new `startRecording` runs during that await, the stale stop's lines 155-156 null `recordingSessionRef` and stop `clonedStreamRef`'s tracks — which by then belong to the NEW block. Additionally, `startRecording` overwrites `clonedStreamRef` without stopping the previous clone, so the guard alone would leak the old clone — `startRecording` must clean up first.

- [ ] **Step 1: Write the failing test**

In `useBlockRecorder.test.ts` (match the file's existing mock/`renderHook` setup — it already builds a mock `mediaRecorderService` and a video ref with `srcObject`; follow its patterns exactly):

```typescript
	it("a stale stop does not clobber a newer recording session", async () => {
		let resolveStopA!: (v: { blob: Blob; duration: number }) => void;
		const sessionA = {
			start: vi.fn(),
			getState: vi.fn().mockReturnValue("recording"),
			stop: vi.fn().mockReturnValue(
				new Promise<{ blob: Blob; duration: number }>((r) => {
					resolveStopA = r;
				}),
			),
		};
		const sessionB = {
			start: vi.fn(),
			getState: vi.fn().mockReturnValue("recording"),
			stop: vi.fn().mockResolvedValue({
				blob: new Blob(["b"], { type: "video/webm" }),
				duration: 1000,
			}),
		};
		mediaRecorderService.startRecording
			.mockReturnValueOnce(sessionA)
			.mockReturnValueOnce(sessionB);

		const { result } = renderHookWithVideo(); // use the file's existing helper for a ready video ref

		act(() => {
			result.current.startRecording(); // block A
		});
		let stalePromise!: Promise<{ blob: Blob; duration: number } | null>;
		act(() => {
			stalePromise = result.current.stopRecording(); // A's stop, held open
		});
		act(() => {
			result.current.startRecording(); // block B starts while A's stop is in flight
		});
		resolveStopA({ blob: new Blob(["a"], { type: "video/webm" }), duration: 500 });
		await act(async () => {
			await stalePromise;
		});

		// The stale stop must NOT null out B's session: getState reads the live ref.
		expect(result.current.getState()).toBe("recording");
	});
```

(If the file has no ready-video helper, construct the video ref the same way its existing `startRecording` tests do.)

- [ ] **Step 2: Run — expect FAIL** (`getState()` returns `"inactive"`: the stale stop nulled the ref)

Run: `nice -n 19 ionice -c 3 npx vitest run src/hooks/useBlockRecorder.test.ts`

- [ ] **Step 3: Implement**

In `useBlockRecorder.ts` add below the refs (line ~59):

```typescript
	// Generation token: each start owns a generation; a stale stop resolving
	// after a newer start must not touch the newer block's refs (H3).
	const generationRef = useRef(0);
```

In `startRecording`, at the top of the callback body (before reading `videoRef`):

```typescript
		const generation = ++generationRef.current;
		// A previous block's clone is ours to release before cloning anew —
		// the stale stop no longer cleans up across generations.
		cleanupClonedStream();
```

(`cleanupClonedStream` is declared with `useCallback` below `startRecording` in the current file — move the `cleanupClonedStream` declaration ABOVE `startRecording` so it's in scope, keeping its body identical. Add `generation` to nothing else yet; Task 5 uses it.)

In `stopRecording`, capture the generation and gate both cleanup blocks:

```typescript
			const generation = generationRef.current;
			const session = recordingSessionRef.current;
			if (!session || session.getState() !== "recording") {
				cleanupClonedStream();
				return null;
			}

			try {
				const result = await session.stop();
				if (generationRef.current === generation) {
					recordingSessionRef.current = null;
					cleanupClonedStream();
					if (!forCleanup) {
						setIsRecording(false);
					}
				}
				return result;
			} catch (err) {
				console.error("Failed to stop recording:", err);
				if (generationRef.current === generation) {
					recordingSessionRef.current = null;
					cleanupClonedStream();
					if (!forCleanup) {
						setError("Recording may have been lost - please try again");
						setIsRecording(false);
					}
				}
				return null;
			}
```

Also add `startRecording`'s dependency array entry for `cleanupClonedStream` (it now calls it): `[videoRef, mediaRecorderService, timerService, deviceService, cleanupClonedStream]`.

- [ ] **Step 4: Run — expect PASS**, then the whole file's suite

Run: `nice -n 19 ionice -c 3 npx vitest run src/hooks/useBlockRecorder.test.ts`

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useBlockRecorder.ts src/hooks/useBlockRecorder.test.ts
git commit -m "fix: stale stop can no longer clobber a newer recording block (H3)

Each startRecording takes a generation; a stopRecording that resolves
after a newer start skips the ref-null/stream-cleanup that would kill
the newer block. startRecording releases the previous clone itself.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: M8 — save failures are not storage death

**Files:**
- Modify: `src/hooks/useSessionList.ts` (new `initFailed` state + interface + return)
- Modify: `src/hooks/useSessionRecorder.ts:205-214` (storage effect keys on `initFailed`)
- Modify: `src/machines/SessionRecorderMachine.ts` (consecutive save-failure counter)
- Modify: `src/machines/SessionRecorderMachine.test.ts`, `src/hooks/useSessionRecorder.test.ts` (new tests)

**Interfaces:**
- Produces: `useSessionList` return gains `initFailed: boolean` (set only by the one-time init catch at `useSessionList.ts:56-57`). Machine gains `getConsecutiveSaveFailures(): number` (consumed by Task 7's reason accessor).

- [ ] **Step 1: Failing machine test** — in `SessionRecorderMachine.test.ts`, new describe:

```typescript
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
```

- [ ] **Step 2: Run — expect FAIL** (`getConsecutiveSaveFailures is not a function`)

- [ ] **Step 3: Implement machine side** — in `SessionRecorderMachine.ts`:

Add field + accessor:

```typescript
	private consecutiveSaveFailures = 0;
```

```typescript
	getConsecutiveSaveFailures(): number {
		return this.consecutiveSaveFailures;
	}
```

In `stopCurrentBlock`, after the `onSaveBlock` await:

```typescript
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
```

In `enable()`, reset the counter so a user-driven resume retries fresh:

```typescript
	enable(): void {
		if (this.enabled) return;
		this.enabled = true;
		this.consecutiveSaveFailures = 0;
		this.tryTransition();
	}
```

- [ ] **Step 4: Machine tests PASS**, then the wiring. In `useSessionList.ts`:

Add state next to `error` (line ~42): `const [initFailed, setInitFailed] = useState(false);`
In the init catch (lines 56-57), add `setInitFailed(true);` alongside the existing `setError`.
Add `initFailed: boolean;` to the hook's return interface (the `error: string | null;` line ~21 is in that interface) and `initFailed,` to the return object.

In `useSessionRecorder.ts`, replace the storage effect (lines 205-214):

```typescript
	// Storage initialization effect: only genuine init failure kills recording.
	// Save/refresh errors stay in sessionList.error for display (M8).
	useEffect(() => {
		if (sessionList.initFailed) {
			machineRef.current?.storageInitFailed();
		} else if (isInitialized) {
			machineRef.current?.storageInitialized();
		}
	}, [sessionList.initFailed, isInitialized]);
```

- [ ] **Step 5: Failing-then-passing hook test** — in `useSessionRecorder.test.ts` (use its existing mock services; `saveSessionWithBlob` rejection makes `saveBlock` return null and set `error`):

```typescript
	it("a failed block save does not permanently halt recording (M8)", async () => {
		const storage = createMockSessionStorage();
		storage.saveSessionWithBlob.mockRejectedValueOnce(new Error("disk full"));
		// ...render the hook enabled with a ready video per the file's existing patterns,
		// drive one block stop via the exposed stopCurrentBlock()...
		// Assert: after the failed save, the machine starts the next block:
		// isRecording returns true again (waitFor), rather than the pre-fix
		// permanent idle caused by storageInitFailed().
	});
```

Write this test concretely against the file's existing helpers (`createMockSessionStorage`, ready-video setup, `waitFor`) — the assertion is `await waitFor(() => expect(result.current.isRecording).toBe(true));` after a `stopCurrentBlock()` whose save failed. Verify it FAILS against the pre-fix wiring by temporarily reverting the effect if needed (or trust RED from writing it before Step 4's wiring — order the steps so this test exists before editing `useSessionRecorder.ts`).

- [ ] **Step 6: Full unit suite + commit**

```bash
git add src/hooks/useSessionList.ts src/hooks/useSessionRecorder.ts src/machines/SessionRecorderMachine.ts src/machines/SessionRecorderMachine.test.ts src/hooks/useSessionRecorder.test.ts
git commit -m "fix: transient save errors no longer masquerade as storage death (M8)

useSessionList exposes initFailed separately from its shared error
string; the recorder wires storageInitFailed to genuine init failure
only. The machine counts consecutive save failures (reset on success
and on re-enable) and keeps rotating blocks.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: M1 — mid-block recorder death is observed and recovered

**Files:**
- Modify: `src/services/MediaRecorderService.ts` (`MediaRecorderConfig`, `startRecording` lines 99-162)
- Modify: `src/services/MediaRecorderService.test.ts` (new tests)
- Modify: `src/hooks/useBlockRecorder.ts` (pass `onFailure`; new `onRecorderFailure` config callback)
- Modify: `src/hooks/useSessionRecorder.ts` (wire to machine)
- Modify: `src/machines/SessionRecorderMachine.ts` + test (new `recorderFailed` input, failure-park threshold)

**Interfaces:**
- `MediaRecorderConfig` gains `onFailure?: (salvaged: RecordingChunk | null) => void` — fires when the recorder errors or stops WITHOUT `stop()` having been requested. Salvage is best-effort: without a `start(timeslice)` there are usually no chunks yet, so `salvaged` is typically `null`. Deliberate: adding a timeslice risks fragmented-MP4 breakage on iOS Safari, out of scope.
- `BlockRecorderConfig` gains `onRecorderFailure?: (salvaged: { blob: Blob; duration: number } | null) => void`.
- Machine gains `async recorderFailed(salvaged: { blob: Blob; duration: number } | null): Promise<void>` and parks (visible, Task 7) after `3` consecutive mid-block failures (`enable()` resets the counter — same reset added in Task 4).

- [ ] **Step 1: Failing service test** — in `MediaRecorderService.test.ts` (it already constructs sessions against a mocked/global MediaRecorder; follow its setup):

```typescript
	it("fires onFailure with best-effort salvage when the recorder errors mid-block", () => {
		const onFailure = vi.fn();
		const session = MediaRecorderService.startRecording(stream, { onFailure });
		session.start();

		// Simulate mid-block death: fire the recorder's error handler directly
		recorderInstance.onerror?.(new Event("error"));

		expect(onFailure).toHaveBeenCalledTimes(1);
		expect(onFailure).toHaveBeenCalledWith(null); // no chunks yet -> nothing to salvage
	});

	it("does NOT fire onFailure for a requested stop", async () => {
		const onFailure = vi.fn();
		const session = MediaRecorderService.startRecording(stream, { onFailure });
		session.start();
		recorderInstance.state = "recording";

		const stopPromise = session.stop();
		recorderInstance.onstop?.(); // the stop() promise's own handler resolves it
		await stopPromise;

		expect(onFailure).not.toHaveBeenCalled();
	});
```

(`recorderInstance` = however the existing tests reach the constructed mock recorder; reuse their mechanism.)

- [ ] **Step 2: Run — expect FAIL**, then implement in `MediaRecorderService.ts`:

Extend the config interface:

```typescript
export interface MediaRecorderConfig {
	videoBitsPerSecond?: number;
	/**
	 * Fires when the recorder dies mid-block (error event, or a stop that was
	 * never requested). Salvage is best-effort and usually null - without a
	 * timeslice no chunks exist until stop.
	 */
	onFailure?: (salvaged: RecordingChunk | null) => void;
}
```

In `startRecording`, after `const startTime = Date.now();` add:

```typescript
		let stopRequested = false;

		const salvage = (): RecordingChunk | null => {
			if (chunks.length === 0) return null;
			const blob = new Blob(chunks, { type: mimeType });
			chunks.length = 0;
			return { blob, duration: Date.now() - startTime };
		};

		const handleMidBlockDeath = () => {
			if (stopRequested) return; // stop() owns the handlers from here on
			recorder.ondataavailable = null;
			recorder.onstop = null;
			recorder.onerror = null;
			config.onFailure?.(salvage());
		};
```

In the returned object's `start()`, after assigning `ondataavailable`, add:

```typescript
				recorder.onerror = handleMidBlockDeath;
				recorder.onstop = handleMidBlockDeath;
```

In `stop()`, first line of the method body (before the `new Promise`):

```typescript
				stopRequested = true;
```

(The promise executor then reassigns `onstop`/`onerror` to its own handlers exactly as today.)

- [ ] **Step 3: Service tests PASS. Failing machine test** — in `SessionRecorderMachine.test.ts`:

```typescript
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
```

- [ ] **Step 4: Implement machine side** — in `SessionRecorderMachine.ts`:

```typescript
	private consecutiveRecorderFailures = 0;
```

(also reset it in `enable()` next to the Task 4 reset):

```typescript
		this.consecutiveSaveFailures = 0;
		this.consecutiveRecorderFailures = 0;
```

New input method (place after `blockTimerFired`):

```typescript
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
```

Reset the recorder-failure counter on a successful NORMAL stop — in `stopCurrentBlock`, next to the save-outcome bookkeeping from Task 4, add after a successful save (`savedSession !== null`): the ternary already resets `consecutiveSaveFailures`; add one line after the `if (result && ...)` block:

```typescript
		if (savedSession !== null) {
			this.consecutiveRecorderFailures = 0;
		}
```

- [ ] **Step 5: Wire the chain.** In `useBlockRecorder.ts`:

`BlockRecorderConfig` gains:

```typescript
	/** Fires when the active recorder dies mid-block (after local cleanup). */
	onRecorderFailure?: (salvaged: { blob: Blob; duration: number } | null) => void;
```

Destructure it in the hook signature, mirror it: `const onRecorderFailureRef = useLatest(onRecorderFailure);` (import `useLatest` from Task 1).

In `startRecording`, the service call becomes:

```typescript
			const session = mediaRecorderService.startRecording(stream, {
				videoBitsPerSecond: getVideoBitrate(deviceService),
				onFailure: (salvaged) => {
					if (generationRef.current !== generation) return; // a dead PAST block is old news
					recordingSessionRef.current = null;
					cleanupClonedStream();
					setIsRecording(false);
					setError("Recording failed mid-block");
					onRecorderFailureRef.current?.(salvaged);
				},
			});
```

In `useSessionRecorder.ts`, pass it where `useBlockRecorder` is invoked (line ~85):

```typescript
	const blockRecorder = useBlockRecorder({
		videoRef,
		mediaRecorderService,
		timerService,
		onRecorderFailure: (salvaged) => {
			machineRef.current?.recorderFailed(salvaged);
		},
	});
```

(The literal arrow is stable enough — `useBlockRecorder` mirrors it via `useLatest`, so identity churn is harmless.)

- [ ] **Step 6: Full unit suite green; commit**

```bash
git add src/services/MediaRecorderService.ts src/services/MediaRecorderService.test.ts src/hooks/useBlockRecorder.ts src/hooks/useSessionRecorder.ts src/machines/SessionRecorderMachine.ts src/machines/SessionRecorderMachine.test.ts
git commit -m "fix: mid-block recorder death is observed, salvaged, and recovered (M1)

onerror/onstop attach at start() instead of only inside stop(), feeding
a recorderFailed input through the hooks into the machine: best-effort
salvage, automatic restart, and a 3-strike park instead of hot-looping.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: H4 — camera switches stop, save, and resume recording

**Files:**
- Modify: `src/hooks/useSessionRecorder.ts:216-249` (readiness polling becomes bidirectional + srcObject watch)
- Modify: `src/hooks/useSessionRecorder.test.ts` (new test)

**Interfaces:** none new — `videoRef.current.srcObject` identity is the change signal; no new props.

**Context — the bug:** the poll stops permanently once ready ("prevent memory leak") and `machine.videoNotReady()` has zero callers, so switching cameras mid-recording leaves the old cloned tracks live (camera LED on, old device recorded up to 5 min).

- [ ] **Step 1: Failing test** — in `useSessionRecorder.test.ts`, using its `createMockTimerService` (`_triggerAllIntervals`) and mock-stream helpers:

```typescript
	it("stops and saves the current block when the video stream changes (H4)", async () => {
		// Render enabled with ready video + stream A per existing patterns; wait for isRecording.
		// Then swap the video element's srcObject to a new MockMediaStream instance:
		videoElement.srcObject = new MediaStream() as unknown as MediaStream;
		// Drive the poll:
		act(() => {
			timerService._triggerAllIntervals();
		});
		// The machine must have been told the video went away: the in-flight
		// block stops and saves (saveSessionWithBlob called), and once the next
		// poll tick sees the new stream ready, recording resumes.
		await waitFor(() =>
			expect(sessionStorage.saveSessionWithBlob).toHaveBeenCalledTimes(1),
		);
		act(() => {
			timerService._triggerAllIntervals();
		});
		await waitFor(() => expect(result.current.isRecording).toBe(true));
	});
```

Write it concretely against the file's existing enabled-recording setup helper (the file has tests that reach `isRecording === true`; reuse their arrangement verbatim).

- [ ] **Step 2: Run — expect FAIL** (`saveSessionWithBlob` never called on stream swap)

- [ ] **Step 3: Implement** — replace the whole readiness effect (lines 216-249):

```typescript
	// Video readiness + stream-change detection (bidirectional, H4).
	// The interval runs for the hook's lifetime: readiness can be lost (device
	// unplugged) and srcObject can be swapped (camera/resolution switch).
	const lastSrcObjectRef = useRef<MediaStream | null>(null);
	useEffect(() => {
		const check = () => {
			const video = videoRef.current;
			const isReady = !!video && video.readyState >= 3;
			const srcObject = (video?.srcObject as MediaStream | null) ?? null;

			const streamChanged =
				lastSrcObjectRef.current !== null &&
				srcObject !== lastSrcObjectRef.current;
			lastSrcObjectRef.current = srcObject;

			if (streamChanged) {
				// Stop + save the in-flight block; the old clone's tracks are
				// released. The next tick reports the new stream's readiness and
				// the machine resumes on its own.
				machineRef.current?.videoNotReady();
				return;
			}
			if (isReady) {
				machineRef.current?.videoIsReady();
			} else {
				machineRef.current?.videoNotReady();
			}
		};

		check();
		const intervalId = timerService.setInterval(check, 250);
		return () => {
			timerService.clearInterval(intervalId);
		};
	}, [videoRef, timerService]);
```

Delete `videoReadyIntervalRef` (line ~82) — it has no remaining use. `videoIsReady()`/`videoNotReady()` early-return when the flag already matches, so the steady-state tick is two cheap no-ops.

- [ ] **Step 4: Run the file's suite — all PASS** (the old "stops polling once ready" behavior has no dedicated test asserting the interval was cleared; if one exists and fails, rewrite it to assert the new contract — polling continues — and say so in the report)

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useSessionRecorder.ts src/hooks/useSessionRecorder.test.ts
git commit -m "fix: camera switch mid-recording stops, saves, and resumes (H4)

Readiness polling becomes bidirectional and watches srcObject identity,
so machine.videoNotReady finally has its caller: the old block is saved,
the old clone's tracks are released (camera LED off), and recording
re-clones the new stream when it reports ready.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Honest REC indicator

**Files:**
- Modify: `src/machines/SessionRecorderMachine.ts` (+ test): `getNotRecordingReason()`
- Modify: `src/hooks/useSessionRecorder.ts`: expose `notRecordingReason`
- Modify: `src/components/CameraStage.tsx:481-501`: status bar
- Modify: `tests/magic-monitor.spec.ts`: one E2E assertion

**Interfaces:**
- Machine: `export type NotRecordingReason = "storage-error" | "recorder-error" | "starting";` and `getNotRecordingReason(): NotRecordingReason | null` (null = recording, or intentionally disabled).
- `SessionRecorderControls` gains `notRecordingReason: NotRecordingReason | null`.

- [ ] **Step 1: Failing machine tests**

```typescript
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
	});
```

- [ ] **Step 2: Implement machine accessor**

```typescript
export type NotRecordingReason = "storage-error" | "recorder-error" | "starting";
```

```typescript
	/**
	 * Why recording is not running, from the machine's own point of view.
	 * null while recording, and null while intentionally disabled (pausing is
	 * the caller's concept, not the machine's).
	 */
	getNotRecordingReason(): NotRecordingReason | null {
		if (this.state.type === "recording") return null;
		if (!this.enabled) return null;
		if (this.consecutiveRecorderFailures >= 3) return "recorder-error";
		if (!this.storageReady || this.consecutiveSaveFailures >= 2) {
			return "storage-error";
		}
		return "starting";
	}
```

- [ ] **Step 3: Expose through the hook** — in `useSessionRecorder.ts`:

```typescript
	const [notRecordingReason, setNotRecordingReason] =
		useState<NotRecordingReason | null>(null);
```

In the machine-construction effect's `onStateChange` callback, after `setIsRecording(...)`:

```typescript
					setNotRecordingReason(
						machineRef.current?.getNotRecordingReason() ?? null,
					);
```

(Note `machineRef.current` is assigned synchronously right after the constructor returns and no state event fires during construction, so the first invocation sees a non-null ref. Also refresh the reason in the enable/disable effect after calling `enable()`/`disable()`, since `enable()` doesn't always change state:)

```typescript
	useEffect(() => {
		if (enabled) {
			machineRef.current?.enable();
		} else {
			machineRef.current?.disable();
		}
		setNotRecordingReason(machineRef.current?.getNotRecordingReason() ?? null);
	}, [enabled]);
```

Add `notRecordingReason` to `SessionRecorderControls` and the return object. Import the `NotRecordingReason` type.

- [ ] **Step 4: Status bar** — replace `CameraStage.tsx` lines 491-499's inner span content with:

```tsx
				<span>
					{isRecordingPaused ? (
						<span className="text-yellow-400 mr-2">⏸ PAUSED</span>
					) : sessionRecorder.isRecording ? (
						<span className="text-red-400 mr-2">● REC</span>
					) : sessionRecorder.notRecordingReason === "starting" ? (
						<span className="text-gray-400 mr-2">◌ starting…</span>
					) : sessionRecorder.notRecordingReason ? (
						<span className="text-amber-400 font-bold text-sm mr-2">
							⚠ NOT RECORDING (
							{sessionRecorder.notRecordingReason === "storage-error"
								? "storage failing"
								: "recorder failing"}
							)
						</span>
					) : null}
					{Math.floor(sessionRecorder.currentBlockDuration)}s |{" "}
					{sessionRecorder.recentSessions.length + sessionRecorder.savedSessions.length} sessions
				</span>
```

- [ ] **Step 5: E2E honesty assertion** — in `tests/magic-monitor.spec.ts`, extend the Task-3-of-PR1 recording test ("Recording: Shows recording indicator when live") with a final assertion that the amber state is absent while recording:

```typescript
		await expect(page.getByText("NOT RECORDING")).toBeHidden();
```

- [ ] **Step 6: Full unit suite + the recording E2E test green; commit**

Run: `nice -n 19 ionice -c 3 npx vitest run` and `nice -n 19 ionice -c 3 npx playwright test --project=chromium --workers=2 tests/magic-monitor.spec.ts -g "Recording:"`

```bash
git add src/machines/SessionRecorderMachine.ts src/machines/SessionRecorderMachine.test.ts src/hooks/useSessionRecorder.ts src/components/CameraStage.tsx tests/magic-monitor.spec.ts
git commit -m "feat: honest REC indicator - live-but-not-recording is visible

The machine exposes why it isn't recording (starting / storage-error /
recorder-error); the status bar renders a prominent amber NOT RECORDING
state instead of silently showing nothing.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: Delete the dead playback trio (refactor commit)

**Files:**
- Modify: `src/services/MediaRecorderService.ts:164-197` (delete `createPlaybackElement`, `loadBlob`, `revokeObjectUrl`)
- Modify: `src/services/MediaRecorderService.test.ts` (delete their describe blocks, ~lines 425-486)
- Modify: `src/hooks/useBlockRecorder.test.ts:34-36`, `src/hooks/useRecorderDebugInfo.test.ts:34-36`, `src/hooks/useSessionRecorder.test.ts:52-54` (drop the three mock keys)

**Context:** verified dead — no production caller anywhere in `src/`; `useReplayPlayer` calls `URL.createObjectURL` directly. Only their own unit tests and mock literals reference them.

- [ ] **Step 1: Delete the three methods, their tests, and the mock keys** (all locations above).
- [ ] **Step 2: Verify:** `npx tsc -b` clean, `nice -n 19 ionice -c 3 npx vitest run` all pass, and `grep -rn "createPlaybackElement\|loadBlob\|revokeObjectUrl" src/` returns nothing.
- [ ] **Step 3: Commit**

```bash
git add src/services/MediaRecorderService.ts src/services/MediaRecorderService.test.ts src/hooks/useBlockRecorder.test.ts src/hooks/useRecorderDebugInfo.test.ts src/hooks/useSessionRecorder.test.ts
git commit -m "refactor: delete dead playback trio from MediaRecorderService

createPlaybackElement/loadBlob/revokeObjectUrl have no production
callers - useReplayPlayer manages blob URLs directly.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: Full verification + PR

- [ ] **Step 1:** `npx tsc -b` clean.
- [ ] **Step 2:** `nice -n 19 ionice -c 3 npx vitest run` — all pass, output pristine.
- [ ] **Step 3:** `nice -n 19 ionice -c 3 npx playwright test --project=chromium --workers=2` — all pass, including the PR1 keystone and recording tests against the NEW machine behavior.
- [ ] **Step 4:** Commit this plan doc; push; open PR:

```bash
git add docs/superpowers/plans/2026-07-20-reliability-pr2-recorder-machine.md
git commit -m "docs: PR2 recorder-machine implementation plan

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
git push -u origin pr/reliability-recorder
gh pr create --title "fix: recorder machine hardening - no silent recording death (reliability sweep PR2)" --body "PR2 of 4 from the reliability sweep design (docs/superpowers/specs/2026-07-20-reliability-sweep-design.md).

- H2: stopCurrentBlock re-runs the transition ladder - stop-and-view and pause/resume races can no longer park recording in a dead state (rewrites the unit test that codified the bug as intended behavior)
- H3: generation token in useBlockRecorder - a stale stop can't clobber a newer block's recorder/stream
- M1: MediaRecorder onerror/onstop attach at start; mid-block death salvages, restarts, 3-strike park
- M8: save failures are counted and survivable; only genuine init failure halts recording
- H4 (moved here from PR3's table - all touched files are PR2 files): bidirectional readiness polling + srcObject watch; camera switch stops/saves/resumes and releases the old clone
- Honest REC: prominent amber NOT RECORDING (reason) state when live but not recording
- Refactors in separate commits: useLatest helper; dead playback trio deleted

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

Report any `test.fixme`/deviation discovered en route in the PR body.

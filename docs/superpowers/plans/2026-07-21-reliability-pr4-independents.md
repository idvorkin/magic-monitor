# Reliability Sweep PR4: Independent Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close out the sweep's independent fixes: IDB transactions can no longer hang forever on abort (H5), the card-detection loop survives inference errors and the button stops lying (M2), iOS exports get the right extension (M5), smart-zoom model failure is visible (M6), the duplicated model-loader infrastructure becomes one code path, the MediaPipe 0×0-frame crash (verification-discovered: tears down the whole UI) is guarded, and PR2's dead SessionPicker card is deleted.

**Architecture:** Spec Sections 4-5 (docs/superpowers/specs/2026-07-20-reliability-sweep-design.md) + verification-discovered findings. Research with FULL sources: `.superpowers/sdd/pr4-research.md` (implementers: read the cited sections). Branch stacked PR1→PR2→PR3→PR4.

**Adjudicated scope decisions (do not re-litigate in-task):**
- H5's "delete dead non-WithBlob variants" is DEFERRED to the code-health round: the test suite calls them 35× as its seeding mechanism (fake-indexeddb can't structuredClone Blobs — research §7.1). The tx helper instead covers ALL 13 transaction sites uniformly (research §1 table): converting the 5 request-level sites to tx-level settle so `onabort` coverage is complete, not just the spec's "six".
- M2's Cards-button failed state and M6's toggle failed state are IN scope — both are explicit approved-spec text (Section 4), not new UI surfaces.
- M6 gets the full cut (hook + SmartZoomToggle + both its call sites + SettingsModal mirror) per spec "toggle shows failed state".
- The StrictMode replay blob-URL race (test.fixme at tests/magic-monitor.spec.ts ~:407) stays DEFERRED to the code-health round (useReplayPlayer cluster) — document in the PR body, do not touch.

## Global Constraints

- Branch: `pr/reliability-independents` off `pr/reliability-camera`. Never push to main. Never `--no-verify`. Never `git add -A` unreviewed.
- Pre-commit ~40s; confirm `[branch sha]` line; re-stage and retry if absent.
- TDD per bug; accurate RED/GREEN narratives (never smoothed).
- CPU: `nice -n 19 ionice -c 3` on all test runs.
- M6 landmine (research §7.3): `HandLandmarkerService.test.ts`'s success fixture has NO `ok` field — the `response.ok` check commit MUST update that mock in the same diff or 13 tests break.
- M5 gotcha (research §4b): blob types carry codec params (`"video/mp4;codecs=avc1..."`) — derive extension via `startsWith`, never equality.
- Loader-dedup landmine (research §7.5): CardDetectorService has ZERO loader tests — the extraction task MUST add minimal CardDetector loader tests mirroring HandLandmarker's, or the shared path is unguarded on one side.
- Commits end with: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`

---

### Task 1: M5 — export filename matches the blob's real container

**Files:** Modify `src/services/ShareService.ts` (generateFilename, lines 73-79), `src/services/ShareService.test.ts` (two existing tests at ~145-155 + one new), `src/hooks/useReplayPlayer.ts` (~line 564, the only call site).

- [ ] **Step 1 (RED):** Update the two existing `generateFilename` tests to pass a mime type and add the MP4 case:

```typescript
	it("generates a .webm filename for webm blobs", () => {
		expect(
			ShareService.generateFilename("my-clip", "video/webm;codecs=vp9"),
		).toMatch(/^my-clip-.*\.webm$/);
	});

	it("generates an .mp4 filename for mp4 blobs (iOS)", () => {
		expect(
			ShareService.generateFilename("my-clip", "video/mp4;codecs=avc1.42E01E"),
		).toMatch(/^my-clip-.*\.mp4$/);
	});

	it("defaults to .webm when no mime type is given", () => {
		expect(ShareService.generateFilename()).toMatch(/\.webm$/);
	});
```

Run: FAIL (signature has no second param; mp4 case yields .webm).

- [ ] **Step 2 (GREEN):** Change the method:

```typescript
	/**
	 * Generate a timestamped filename for video exports.
	 * Extension follows the blob's container (iOS records MP4; naming it
	 * .webm makes receiving apps refuse to play it).
	 */
	generateFilename(prefix = "practice-clip", mimeType = "video/webm"): string {
		const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, "-");
		const extension = mimeType.startsWith("video/mp4") ? "mp4" : "webm";
		return `${prefix}-${timestamp}.${extension}`;
	},
```

Call site in `useReplayPlayer.ts` (~564): `shareService.generateFilename(session.name || "practice-clip", blob.type)`.

- [ ] **Step 3:** File suites green (`ShareService.test.ts`, `useReplayPlayer.test.ts`), `tsc -b` clean; commit:

```
fix: export filename extension follows the blob container (M5)

iOS records MP4 but exports were always named .webm; share targets
that trust the extension refused to play them.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
```

---

### Task 2: M2 — card-detection loop survives inference errors; the button stops lying

**Files:** Modify `src/hooks/useCardDetection.ts` (detect loop, research §2 full source), Create `src/hooks/useCardDetection.test.ts`, Modify `src/components/CameraStage.tsx` (~lines 626-640, the Cards StatusButton).

**Design:** frame-level errors get their own `detectError` state (distinct failure class from load-time `modelError` — research §2 note). On a rejected `detect()`: log once, set `detectError`, KEEP the rAF loop alive; a subsequent successful detect clears it. Button: `isModelLoading` → "🃏 Loading..." | `(modelError || detectError)` → "🃏 Cards ERR" | enabled → "🃏 Cards ON" | else "🃏 Cards".

- [ ] **Step 1 (RED):** New `useCardDetection.test.ts` modeled on `useSmartZoom.test.ts`'s fake-rAF pattern (queue rAF callbacks, drive frames manually; mock `CardDetectorService` module with `isReady: () => true`, controllable `detect`). Two tests:

```typescript
	it("survives a rejected detect() and keeps the loop alive (M2)", async () => {
		// detect rejects once, then resolves with []
		// drive: frame1 (rejection) -> assert loop scheduled again -> frame2 (success)
		// assert detectError was set after the rejection and cleared after the success
	});

	it("exposes the rejection via detectError while the loop continues", async () => {
		// detect always rejects; drive 2 frames; assert detectError truthy and
		// rAF still being scheduled (queue length grows each drive)
	});
```

Write these concretely against the fake-rAF harness (see `useSmartZoom.test.ts` lines 1-80 for the pattern: `vi.stubGlobal("requestAnimationFrame", ...)` with a callback queue). RED: the first rejection kills the loop (no further rAF scheduled) and nothing sets an error.

- [ ] **Step 2 (GREEN):** In the detect loop (research §2 lines 80-91), wrap the inference:

```typescript
				if (frameCountRef.current % 2 === 0) {
					const t0 = performance.now();
					try {
						const results = await CardDetectorService.detect(
							video,
							confidenceThreshold,
						);
						detectTimeMsRef.current = performance.now() - t0;
						detectionsRef.current = results;
						if (detectError) setDetectError(null);
						if (frameCountRef.current % UI_UPDATE_INTERVAL === 0) {
							setDetections(results);
						}
					} catch (err) {
						// Keep the loop alive: one bad frame must not kill detection
						// permanently (WebGPU device loss, transient ORT errors).
						console.error("Card detection frame failed:", err);
						setDetectError(
							err instanceof Error ? err.message : "Detection failed",
						);
					}
				}
```

Add `const [detectError, setDetectError] = useState<string | null>(null);`, add `detectError` to the return object, add `detectError` to the biome-ignore'd deps note if the linter asks (prefer reading it via functional update `setDetectError((prev) => (prev === null ? prev : null))` if the closure-read trips exhaustive-deps — implementer's judgment, document choice).

- [ ] **Step 3:** CameraStage button (research §5, ~line 631):

```tsx
							{cardDetection.isModelLoading
								? "🃏 Loading..."
								: cardDetection.modelError || cardDetection.detectError
									? "🃏 Cards ERR"
									: cardDetectionEnabled
										? "🃏 Cards ON"
										: "🃏 Cards"}
```

(Match the actual existing ternary tail — read the file; the last branch's current text wins.)

- [ ] **Step 4:** Suites green, `tsc -b`; commit:

```
fix: card-detection loop survives inference errors (M2)

A single rejected detect() permanently killed the rAF loop while the
button kept saying ON. Errors now surface as detectError, the loop
keeps running, and the button shows an error state.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
```

---

### Task 3: Guard the MediaPipe/ONNX 0×0 pre-metadata frame crash; un-fixme the dropdown test

**Files:** Modify `src/hooks/useSmartZoom.ts` (detect loop entry, research §4a ~line 230), `src/hooks/useCardDetection.ts` (same guard, symmetric), `tests/dropdown-bug.spec.ts` (~:84-91, remove the fixme).

**Context (verification-discovered High):** `useSmartZoom` runs `detect()` before `loadedmetadata`; a 0×0 frame crashes MediaPipe's WASM (`RET_CHECK roi->width > 0`), the error boundary catches it, and the WHOLE UI tears down. It wandered across E2E tests under load; `dropdown-bug.spec.ts` carries a `test.fixme` pointing here.

- [ ] **Step 1:** In both hooks' rAF loops, extend the existing skip condition. In `useSmartZoom` (~line 230) and `useCardDetection` (~line 67), change the early-reschedule guard to also skip dimensionless frames:

```typescript
			if (
				!video ||
				video.paused ||
				video.ended ||
				video.readyState < 2 ||
				video.videoWidth === 0
			) {
				requestRef.current = requestAnimationFrame(detect);
				return;
			}
```

(Preserve each file's exact callback style — `detect` vs `() => { detect(); }`.)

- [ ] **Step 2 (unit):** Add one test per hook (in `useSmartZoom.test.ts` + Task 2's new file): a mock video with `videoWidth: 0` / `readyState: 1` drives N frames → `detect`/`detectForVideo` NEVER called; then flip the mock to ready dimensions → called. RED-first where feasible (the smart-zoom harness has a mock video object — set its dimensions to 0 and observe today's call-through).

- [ ] **Step 3:** Un-fixme `tests/dropdown-bug.spec.ts` (~:84): restore `test(...)`, delete the fixme comment, add a comment referencing the guard. Run the dropdown E2E file 3× serially, CPU-prefixed: expect 3/3 green runs (this test crashed nondeterministically before — repetition is the evidence).

Run: `for i in 1 2 3; do nice -n 19 ionice -c 3 npx playwright test --project=chromium tests/dropdown-bug.spec.ts 2>&1 | tail -2; done` (port 5273 free first; BLOCKED with pid if occupied, never kill).

- [ ] **Step 4:** Full unit suite, `tsc -b`; commit:

```
fix: skip detection on dimensionless pre-metadata frames

A 0x0 frame crashes MediaPipe's WASM (RET_CHECK roi->width > 0) and the
error boundary tore down the entire UI - the wandering E2E failure.
Both detection loops now wait for real dimensions. Un-fixmes the
dropdown regression test.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
```

---

### Task 4: H5 — one promisified transaction helper; aborts reject instead of hanging

**Files:** Modify `src/services/SessionStorageService.ts` (all 13 sites, research §1 table + full source), Modify `src/services/SessionStorageService.test.ts` (one new abort test).

**Design:** one private helper; ALL sites converted to transaction-level settle:

```typescript
/**
 * Settle when the transaction does. IndexedDB can abort at commit time
 * (quota exceeded on large blob writes) firing ONLY onabort - a promise
 * wired to oncomplete/onerror alone hangs forever and wedges the
 * recorder in "stopping".
 */
function settleTransaction<T>(tx: IDBTransaction, result: () => T): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		tx.oncomplete = () => resolve(result());
		tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction failed"));
		tx.onabort = () =>
			reject(tx.error ?? new Error("IndexedDB transaction aborted (quota?)"));
	});
}
```

Usage shape — request results captured in closure, promise settles on the TX (e.g. `getSession`):

```typescript
	async getSession(id: string): Promise<PracticeSession | null> {
		const db = await getDB();
		const tx = db.transaction(SESSIONS_STORE, "readonly");
		const request = tx.objectStore(SESSIONS_STORE).get(id);
		return settleTransaction(tx, () => request.result ?? null);
	},
```

- [ ] **Step 1 (RED):** New test in `SessionStorageService.test.ts` — fake-indexeddb can't simulate commit-time abort, so drive it directly: after `init()`, monkey-patch the db's `transaction` to return a tx whose `abort()` is invoked on next tick after the method wires its handlers... simpler and robust: unit-test the HELPER by exporting it for tests (`export` it with a doc comment noting test usage) and constructing a minimal fake tx object:

```typescript
	describe("settleTransaction (H5)", () => {
		it("rejects on abort instead of hanging forever", async () => {
			const fakeTx = {
				oncomplete: null,
				onerror: null,
				onabort: null,
				error: null,
			} as unknown as IDBTransaction;
			const promise = settleTransaction(fakeTx, () => "unreachable");
			fakeTx.onabort?.(new Event("abort"));
			await expect(promise).rejects.toThrow(/aborted/);
		});

		it("resolves the result on complete", async () => {
			const fakeTx = { oncomplete: null, onerror: null, onabort: null } as unknown as IDBTransaction;
			const promise = settleTransaction(fakeTx, () => 42);
			fakeTx.oncomplete?.(new Event("complete"));
			await expect(promise).resolves.toBe(42);
		});
	});
```

RED: `settleTransaction` doesn't exist.

- [ ] **Step 2 (GREEN):** Implement the helper; convert ALL 13 sites (8 writable + 5 read — research §1 table has exact lines): each site creates its tx explicitly, issues its request(s), returns `settleTransaction(tx, () => <result>)`. The request-level `onsuccess`/`onerror` handlers are removed (the tx-level settle subsumes them). Preserve each method's exact return semantics (e.g. `getSession` null-on-missing, `saveSessionWithBlob` returning the generated id, `getRecentSessions` sort/filter post-processing — move post-processing into the `result()` closure or after the await, keep behavior identical).
- [ ] **Step 3:** FULL storage suite green unmodified (35 seeding calls included — those methods still exist, now abort-safe too). Full unit suite. `tsc -b`.
- [ ] **Step 4:** Commit:

```
fix: IndexedDB aborts reject instead of hanging forever (H5)

A quota-exceeded commit-time abort fires only onabort, which nothing
wired - the save promise never settled and the recorder wedged in
"stopping" permanently. One settleTransaction helper now covers all 13
transaction sites uniformly (request-level settles converted to
transaction-level). The dead-variant deletion stays deferred: the test
suite uses those methods as its seeding mechanism.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
```

---

### Task 5: M6 — smart-zoom model failure is visible

**Files:** Modify `src/services/HandLandmarkerService.ts` (fetch path, research §3a), `src/services/HandLandmarkerService.test.ts` (fixture + 1 new test), `src/hooks/useSmartZoom.ts` (+state/+return, research §4a), `src/components/SmartZoomToggle.tsx`, `src/components/CameraStage.tsx` (thread prop, live), `src/components/ReplayControls.tsx` (thread prop, replay), `src/components/SettingsModal.tsx` (+prop, mirror the cardModelError block ~350-354), `src/hooks/useSmartZoom.test.ts` (1 new test).

- [ ] **Step 1 (RED, service):** New test: fetch resolves `{ ok: false, status: 404 }` → `load()` results in `phase: "error"` state (not a corrupted-buffer initialize attempt). **Same commit MUST add `ok: true` to the success fixture (test file beforeEach ~lines 32-48) — the landmine.** RED: no `ok` check exists; the 404 path streams an error page into the model buffer.
- [ ] **Step 2 (GREEN, service):** After the fetch in `loadModel` (~line 89 area), add:

```typescript
		if (!response.ok) {
			throw new Error(
				`Model download failed: HTTP ${response.status}`,
			);
		}
```

(Match CardDetectorService's existing pattern — research §3b has it.)
- [ ] **Step 3 (hook):** `useSmartZoom` adds `const [modelError, setModelError] = useState<string | null>(null);`, sets it in `handleStateChange` exactly as `useCardDetection.ts:44` does, adds `modelError` to the return object. New unit test: push a `phase:"error"` state through the service mock's subscribe → `modelError` truthy.
- [ ] **Step 4 (UI):** `SmartZoomToggle` gains `modelError?: string | null`; when set and not loading, render the toggle in a failed state (title=modelError, error styling consistent with the component's existing conventions — read it first). Thread `smartZoom.modelError` at both call sites (CameraStage ~617-623, ReplayControls' instance — research §5). SettingsModal gains `smartZoomModelError` prop rendered like its `cardModelError` block (~350-354), threaded from CameraStage (~410).
- [ ] **Step 5:** Full unit + `tsc -b`; run the E2E settings group once (`-g "Settings"`) to confirm no modal regression. Commit:

```
fix: smart-zoom model failure is visible, not silent (M6)

HandLandmarkerService never checked response.ok (a 404 streamed an
error page into the model buffer); useSmartZoom had zero modelError
plumbing, so failure was indistinguishable from success. The toggle
and settings now show the failed state.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
```

---

### Task 6: Extract `createModelLoader` — one loader code path

**Files:** Create `src/services/createModelLoader.ts` (+ test), Create `src/hooks/useModelLoadingState.ts`, Modify `src/services/HandLandmarkerService.ts`, `src/services/CardDetectorService.ts`, `src/hooks/useSmartZoom.ts`, `src/hooks/useCardDetection.ts`, Modify `src/services/CardDetectorService.test.ts` (+ minimal loader tests — the asymmetry landmine).

**Contract:** research §3a/§3b hold both FULL sources. The duplicated infrastructure (`LoadingPhase`/`LoadingState`/`subscribe`/`notifyListeners`/`updateState`/load-dedup/streaming-fetch-progress/`isReady`/`isLoading`/`_reset`) becomes:

```typescript
export function createModelLoader<TModel>(config: {
	name: string;
	fetchAndInit: (
		reportProgress: (progress: number) => void,
		setPhase: (phase: "downloading" | "initializing") => void,
	) => Promise<TModel>;
}): {
	getState(): LoadingState;
	getModel(): TModel | null;
	subscribe(listener: (state: LoadingState) => void): () => void;
	load(): Promise<TModel | null>;
	isReady(): boolean;
	isLoading(): boolean;
	_reset(): void;
};
```

Each service keeps its EXACT public surface (research §7 signatures — `useSmartZoom`/`useCardDetection` need zero changes beyond swapping their duplicated subscription effect for the shared `useModelLoadingState(service)` hook, which returns `{ isModelLoading, loadingProgress, loadingPhase, modelError }` implemented once). `CardDetectorService._reset()` clears its two extra fields on top of the shared reset (research §7 note). Domain logic (MediaPipe init, ONNX session, S3/CDN URLs, `detect`, `nms`, `parseYoloOutput`) stays in the services.

- [ ] **Step 1:** Write `createModelLoader.test.ts` first: subscribe/notify, load-dedup (two concurrent `load()` → one `fetchAndInit`), progress reporting, error phase capture, `_reset`. RED (module missing), then implement, GREEN.
- [ ] **Step 2:** Migrate `HandLandmarkerService` onto it — its 13 existing loader tests are the safety net; they must pass UNMODIFIED (any assertion change = refactor mistake).
- [ ] **Step 3:** Migrate `CardDetectorService` + ADD minimal loader tests to its test file (mirror 4-5 of HandLandmarker's: load-dedup, error phase, subscribe, reset) — the side that had zero coverage.
- [ ] **Step 4:** Add `useModelLoadingState.ts` (the shared subscription hook) and swap both hooks' duplicated effects onto it. Hook return shapes unchanged.
- [ ] **Step 5:** Full unit + `tsc -b` + one smart-zoom E2E smoke (`-g "App loads"` — model load path exercised on boot). Commit:

```
refactor: one model-loader code path for MediaPipe and ONNX services

~120 duplicated lines of loader infrastructure (state machine,
subscribe, dedup, streaming progress) collapse into createModelLoader +
useModelLoadingState. CardDetectorService's loader finally gets tests -
it had none, so half the shared path was unguarded.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
```

---

### Task 7: Delete the dead "Recording Now" card

**Files:** Modify `src/components/SessionPicker.tsx` (~line 214 card + its props), `src/components/CameraStage.tsx` (`handleStopAndViewRecording` + the prop), any `SessionPicker` prop types/tests touching it.

**Context (PR2 handoff):** since `stopCurrentBlock({disable:true})`, recording is always stopped before the picker opens — `isRecording` is never true while it renders; the card and its only caller (`handleStopAndViewRecording`) are unreachable. Verify with grep before deleting; if any OTHER caller of `handleStopAndViewRecording` exists, STOP and report.

- [ ] **Step 1:** Delete the card JSX, its props (`isRecording`, `currentRecordingThumbnail`, `currentBlockDuration`, `onStopAndViewRecording` — whichever exist solely for it; check each prop's other uses first), `handleStopAndViewRecording`, and the prop threading. `tsc -b` will catch stragglers.
- [ ] **Step 2:** Full unit + the session E2E group (`-g "Sessions"`) green. Commit:

```
refactor: delete unreachable Recording Now card from SessionPicker

stopCurrentBlock({disable:true}) stops recording before the picker
opens, so isRecording is never true while it renders - the card and
handleStopAndViewRecording were dead.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
```

---

### Task 8: Full verification + PR4

- [ ] **Step 1:** `npx tsc -b` clean; full unit green; full serial E2E — status "passed" via `jq -c '{status, failed: (.failedTests | length)}' test-results/.last-run.json` (never trust a piped tail alone). With Task 3's guard, watch whether the previous "flaky" classes still appear — report the flaky list explicitly.
- [ ] **Step 2:** Commit this plan doc; push; open the PR (body summarizing all fixes + the deferred items: dead-variant deletion, StrictMode replay race, amber-precedence question from PR2). Standard footer.

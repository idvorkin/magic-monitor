# Reliability Sweep — Design

**Date:** 2026-07-20
**Status:** Approved by Igor (brainstorming session)
**Scope decision:** Reliability first. 5 High-severity bugs + 5 silent-failure Mediums (+ M3 riding along with the camera work) + recording E2E coverage. Approach C: structural hardening of two cores (recorder machine, camera selection), surgical patches for the rest, opportunistic refactors fenced to touched files in separate commits.

## Goal

When this round lands:

- Recording either works or the UI visibly says it isn't. No silent data loss from any path found in the 2026-07-20 review.
- Camera selection is deterministic and self-healing (wrong-device pinning and stale-id lockout are gone).
- The real record→storage→picker path has E2E coverage (currently zero — both recording tests skipped, all session tests seed IndexedDB directly).

Non-goals (deferred to a future code-health round): CameraStage decomposition, the 42-prop SettingsModal pipeline, `useReplayPlayer` split, smart-zoom pipeline dedup, `usePersistedState`, and all product features (instant replay, slow-mo, flash timeline).

## Working rules

1. Failing test before each fix (repo TDD convention).
2. Refactor commits separate from fix commits; refactoring only in files the sweep already touches.
3. `SessionRecorderMachine` stays pure — no React, no timers, injected callbacks and clock.
4. Only UI change in scope: the honest REC indicator.

## Findings being fixed

| ID | Location | Defect |
|----|----------|--------|
| H1 | `src/hooks/useCamera.ts:30-45,87-98` | Auto-select race: stale `getDevices()` callback overwrites browser-chosen device with first-enumerated and persists it |
| H2 | `src/machines/SessionRecorderMachine.ts:179-183` | `stopCurrentBlock` parks in dead `waitingForVideo` state; recording never resumes (quick Pause→Resume, or stop-and-view with empty blob) |
| H3 | `SessionRecorderMachine.ts:141-150` + `src/hooks/useBlockRecorder.ts:60-71,144-156` | Re-entrancy across awaits: stale stop clobbers newer recorder's refs, leaks recorder + cloned camera stream |
| H4 | `useBlockRecorder.ts:69-71` + `src/hooks/useCamera.ts:66-69` | Camera switch mid-recording: old device stays powered and recorded up to 5 min; `videoNotReady()` never called |
| H5 | `src/services/SessionStorageService.ts:85-97` (+5 more tx sites) | No `onabort` handler: quota-exceeded save never settles; machine wedged in `"stopping"` forever |
| M1 | `src/services/MediaRecorderService.ts:113-158` | No `onerror`/`onstop` while recording: mid-block failure silently discards up to 5 min of chunks |
| M2 | `src/hooks/useCardDetection.ts:63-97` | Unhandled rejection kills detection rAF loop permanently; UI still shows ON |
| M3 | `useCamera.ts:48-58` + `src/services/CameraService.ts:59` | Stale persisted id → `OverconstrainedError` misreported as permissions error; no fallback; unplug → frozen video (rides along with H1) |
| M5 | `src/services/ShareService.ts:73-79` | iOS MP4 exports named `.webm` |
| M6 | `src/hooks/useSmartZoom.ts:200-214` + `src/services/HandLandmarkerService.ts:92` | Smart-zoom model load failure completely silent; no `response.ok` check |
| M8 | `src/hooks/useSessionRecorder.ts:206-214` | Any `sessionList` error treated as storage-init failure → recording halts permanently |

Opportunistic one-liners while in `CameraStage.tsx`: fix `[bugReporter]` in effect deps (`:211`, violates repo's documented anti-pattern), add input-focus guard to global "z" handler (`:202-207`).

## Section 2 — Recorder machine hardening

All changes inside `SessionRecorderMachine.ts` + its two adapter hooks (`useSessionRecorder`, `useBlockRecorder`).

1. **Generation token for async operations.** Every `startRecordingBlock`/`stopCurrentBlock` increments a generation counter captured by the in-flight operation. When an awaited stop completes, it clears `recordingSessionRef` / cleans up cloned streams **only if its generation is still current**. Kills the H3 class: a stale stop can no longer null a newer recorder's refs or stop its tracks. The second `startRecordingBlock()` call in `blockTimerFired` becomes generation-checked too.
2. **No dead-end states.** After any stop completes, and after any input that flips a readiness flag, the machine re-runs `tryTransition()`. `waitingForVideo` becomes a true transient: if `enabled && videoReady && storageReady`, the next block starts immediately (H2). Inputs like `enable()`/`videoIsReady()` no longer early-return solely because their flag is already true.
3. **Transient save errors ≠ storage death.** `storageInitFailed()` is wired only to the initialization path. A failed `saveBlock` logs, increments a failure count, and the machine keeps rotating blocks (M8). Persistent failure becomes visible via the honest REC state, not via a permanent halt.
4. **Recorder failure + camera-switch awareness.**
   - `MediaRecorder.onerror`/`onstop` attach at `start()` (M1). Mid-block failure feeds a `recorderFailed` input into the machine: salvage accumulated chunks if a blob can be produced, then transition to a recoverable state and retry via `tryTransition`.
   - `videoNotReady()` gets its missing caller (H4): when the live video's `srcObject` changes (device/resolution switch), the adapter notifies the machine → current block stops and saves → cloned tracks stopped (camera LED off) → readiness polling resumes → machine re-clones the new stream when ready. The readiness poll in `useSessionRecorder.ts:217-249` becomes bidirectional instead of stopping permanently once ready.
5. **Honest state exposure.** The machine exposes `isRecording` (true only when a block is actually being captured) for the REC indicator.

## Section 3 — Camera selection policy

Replace the fire-and-forget auto-select with a pure, testable resolver:

```
resolveCameraSelection({ persistedId, devices, activeTrackDeviceId }) → { deviceId, persist: boolean }
```

- Persisted id present in `devices` → use it, no persist.
- No valid persisted id but an active track exists → adopt the browser/OS-chosen device and persist it. Never "first in the list" (H1 root cause).
- Neither → OS default (unconstrained `getUserMedia`), persist only once a track reports its device.

Supporting changes in `useCamera` / `CameraService`:

- **Sequenced, cancellable startup:** enumerate → resolve → open stream in one async path with an `isActive` guard; no stale closure races the sync selection.
- **Stale-id recovery (M3):** catch `OverconstrainedError` specifically, retry without the `deviceId: { exact }` constraint (falls back to OS default), clear the stale persisted id, and show an accurate message — not "allow permissions". `retry` no longer loops the same failing constraint.
- **Unplug detection (M3):** the live track gets an `ended` listener → re-run selection instead of freezing.

Opportunistic (separate commits): `CameraService`/`CameraSettingsService` move to the object-literal-with-DI convention used by the rest of the services (removes the `vi.mock` requirement), and `CameraSettingsService` gets its first unit tests (corruption recovery, partial-settings merge, per-device update isolation).

## Section 4 — Independent fixes & honest REC

- **H5:** one promisified transaction helper (`oncomplete`/`onerror`/`onabort`) used by all six transaction sites in `SessionStorageService`. Aborted saves reject; the machine's stop path surfaces the error and recovers per Section 2.3. Refactor commit alongside: delete dead non-`WithBlob` variants (`saveSession`, `getAllSessions`, `deleteSession`, `deleteBlob`).
- **M2:** `try/catch` around `await CardDetectorService.detect(...)`; loop stays alive on error, error lands in state, Cards button shows failed state instead of ON.
- **M6:** `HandLandmarkerService.loadModel` checks `response.ok` (parity with CardDetector), error phase propagates, `useSmartZoom` exposes `modelError`, toggle shows failed state. No banner.
- **M5:** `ShareService.generateFilename` derives extension from `blob.type` (`video/mp4` → `.mp4`).
- **Honest REC (only UI change):** indicator driven by machine `isRecording`. Live-and-recording = small unobtrusive REC (as today). Live-but-NOT-recording = prominent, unmissable state with the reason (paused / storage failed / restarting). No toasts, no banners, no auto-dismiss logic.

## Section 5 — Refactor boundary (fenced)

**In** — each its own commit, only in files the sweep touches:

- `useLatest` helper replacing the 7× hand-rolled ref-mirroring in `useSessionRecorder.ts:105-142`.
- Extract `createModelLoader` + `useModelLoadingState` from the ~120 duplicated lines in `HandLandmarkerService`/`CardDetectorService` (both edited for error handling anyway); consuming hooks use the shared subscription.
- Camera services → object-literal DI convention.
- Dead-code deletion in touched files: `MediaRecorderService.ts:167-196` playback trio, dead storage variants above.

**Out** — CameraStage decomposition, SettingsModal 42-prop pipeline, `useReplayPlayer` split, `useSmartZoom` hands/no-hands dedup, `usePersistedState`, zoom dual-source-of-truth, `useVersionCheck` dedup, everything product-facing.

## Section 6 — Testing

- **Per-bug failing tests first.** Machine: extend `SessionRecorderMachine.test.ts` (generation-token re-entrancy, Pause→Resume during stop, dead-state escape, save-error resilience, `recorderFailed` recovery). Camera: `resolveCameraSelection` pure-function tests + `useCamera` race test with a controllable `enumerateDevices` promise + `OverconstrainedError` fallback test. Storage: transaction-helper abort test (injected fake, since fake-indexeddb can't simulate commit-time abort). Card detection: loop-survives-rejection test (fake rAF, modeled on `useSmartZoom.test.ts`).
- **New:** `CameraSettingsService.test.ts`.
- **E2E:** fix the undefined `stream` variable at `tests/magic-monitor.spec.ts:184` (mock always installed today; corrected pattern exists at `tests/session-recorder.spec.ts:172`), un-skip both recording tests, add the keystone test: load → record one block → open Sessions → assert a session exists **without** seeding.
- **Enabler:** include `tests/` in a tsconfig checked by `tsc -b` so Playwright specs are type-checked and the undefined-variable class can't recur.

## Section 7 — Delivery

Four PRs to `origin` (fork), dependency order, each green on `just test` (and E2E for PR1/PR2) before opening:

1. **PR1 — test foundation:** E2E mock fix, un-skip recording tests, keystone record→session test, `tests/` type-checking. Makes later PRs verifiable end-to-end.
2. **PR2 — recorder machine cluster:** H2, H3, M1, M8 + honest REC + `useLatest` refactor commit.
3. **PR3 — camera cluster:** H1, M3, H4 stream-change wiring + camera-service DI refactor commit + `CameraSettingsService` tests.
4. **PR4 — independents:** H5, M2, M5, M6 + model-loader dedup and dead-code commits.

## Review provenance

Full four-lens review findings (product, architecture, correctness, tests) archived at `~/tmp/agent/notes/2026-07-20-magic-monitor-big-review.md`. Items found but out of scope this round are listed there for the next planning session — notably the product improvements (one-tap instant replay ranked #1) and the architecture findings (CameraStage god component, dead 60fps refs).

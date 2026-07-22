# Reliability Sweep PR3: Camera Selection Cluster Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Camera selection becomes deterministic and self-healing: the auto-select race that pins the wrong camera (H1) is gone, a stale persisted device id recovers to the OS default with an accurate message instead of a bogus permissions error (M3), an unplugged camera re-selects instead of freezing (M3), and the camera services join the repo's object-literal DI convention with `CameraSettingsService` getting its first tests.

**Architecture:** Spec Section 3 (docs/superpowers/specs/2026-07-20-reliability-sweep-design.md). One production consumer (`CameraStage.tsx:164`, no-arg call). The two racing effects in `useCamera` (fire-and-forget `getDevices()` auto-select vs. stream-setup track adoption) become ONE sequenced cancellable path: enumerate → resolve → open → adopt. A pure `resolveCameraSelection` makes the pre-open constraint decision; post-open adoption is inline hook logic. H4 is NOT in this PR (landed in PR2 despite the spec's delivery table — documented deviation).

**Tech Stack:** TypeScript, Vitest (existing `useCamera.test.ts` harness with controllable service mocks), Playwright (existing camera E2E tests must stay green).

## Global Constraints

- Branch: `pr/reliability-camera` off `pr/reliability-recorder` (stacked: PR1 → PR2 → PR3). Never push to main. Never `--no-verify`. Never `git add -A` without reviewing `git status`.
- Pre-commit ~40s; confirm the `[branch sha]` line after each commit; re-stage and retry if absent.
- TDD per bug: failing test first, accurate RED/GREEN sequencing in reports (never smooth the narrative).
- CPU discipline: `nice -n 19 ionice -c 3` prefix on test runs; Playwright is `workers: 1` by config now.
- `useCamera`'s return shape (ten named keys) is frozen — `CameraStage.tsx:153-164` destructures all of them.
- These value exports must remain importable at their current paths (SettingsModal + CameraSettingsService import them by name): `RESOLUTION_PRESETS`, `Resolution`, `Orientation`, `CameraSettings`, `InsecureContextError` (must stay a real Error subclass — `instanceof` dispatch at useCamera catch).
- Authorized test rewrites (contract changes, justify in commit): `"selects first device if none selected"` (codifies H1's auto-select+persist — replaced by display-only fallback, no persist) — any OTHER failing test is a stop-and-investigate.
- E2E invariants that must survive: `select#camera-source` initially shows `mock-camera-1` (`tests/magic-monitor.spec.ts:529`) — the E2E mock's canvas tracks report NO deviceId in getSettings(), so the display fallback (first enumerated, NOT persisted) is what keeps this green; device switching test; per-device resolution persistence tests.
- Commits end with: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`

## Verification commands

- Focused unit: `nice -n 19 ionice -c 3 npx vitest run src/hooks/useCamera.test.ts` (substitute file)
- Full unit: `nice -n 19 ionice -c 3 npx vitest run` ; typecheck: `npx tsc -b`
- Camera E2E: `nice -n 19 ionice -c 3 npx playwright test --project=chromium tests/magic-monitor.spec.ts -g "Camera|camera|Settings" 2>&1 | tail -6` (port 5273 free first; BLOCKED with pid if occupied, never kill)

---

### Task 1: `resolveCameraSelection` pure resolver

**Files:**
- Modify: `src/services/CameraService.ts` (add top-level export near `RESOLUTION_PRESETS`)
- Create: `src/services/CameraService.test.ts` (new file — pure-function tests only)

**Interfaces:**
- Produces: `resolveCameraSelection({ persistedId, devices }): { deviceId: string | null }` — `deviceId` null means "no constraint, let the OS choose". Task 2 consumes it.

**Context:** Pre-permission, `enumerateDevices()` returns devices with EMPTY `deviceId` strings — validation is impossible then, so the resolver trusts the persisted id and lets the `OverconstrainedError` fallback (Task 3) be the real validator. The resolver never returns "first in the list" — that was H1's root cause.

- [ ] **Step 1: Write the failing tests** — `src/services/CameraService.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { resolveCameraSelection } from "./CameraService";

function device(deviceId: string): MediaDeviceInfo {
	return {
		deviceId,
		kind: "videoinput",
		label: deviceId ? `Camera ${deviceId}` : "",
		groupId: "g",
		toJSON: () => ({}),
	} as MediaDeviceInfo;
}

describe("resolveCameraSelection", () => {
	it("uses a persisted id that is present in the device list, without constraint to first device", () => {
		expect(
			resolveCameraSelection({
				persistedId: "cam-b",
				devices: [device("cam-a"), device("cam-b")],
			}),
		).toEqual({ deviceId: "cam-b" });
	});

	it("trusts the persisted id when the device list cannot be validated (pre-permission empty ids)", () => {
		expect(
			resolveCameraSelection({
				persistedId: "cam-b",
				devices: [device(""), device("")],
			}),
		).toEqual({ deviceId: "cam-b" });
	});

	it("falls back to the OS default when the persisted id is stale (validated absent)", () => {
		expect(
			resolveCameraSelection({
				persistedId: "gone",
				devices: [device("cam-a"), device("cam-b")],
			}),
		).toEqual({ deviceId: null });
	});

	it("uses the OS default when nothing is persisted — never first-in-list", () => {
		expect(
			resolveCameraSelection({
				persistedId: "",
				devices: [device("cam-a"), device("cam-b")],
			}),
		).toEqual({ deviceId: null });
	});

	it("uses the OS default with an empty device list", () => {
		expect(resolveCameraSelection({ persistedId: "", devices: [] })).toEqual({
			deviceId: null,
		});
	});
});
```

- [ ] **Step 2: Run — expect FAIL** (`resolveCameraSelection` not exported)

Run: `nice -n 19 ionice -c 3 npx vitest run src/services/CameraService.test.ts`

- [ ] **Step 3: Implement** — add to `src/services/CameraService.ts` (top level, after `RESOLUTION_PRESETS`):

```typescript
/**
 * Decide which device to request BEFORE opening a stream.
 * Pure policy: a persisted id wins when it is (or cannot be proven not to be)
 * a real device; otherwise the OS default. Never "first in the list" — that
 * silently overrides the camera the browser/OS actually chose.
 * Pre-permission enumeration yields empty deviceIds, making validation
 * impossible — then the persisted id is trusted and the
 * OverconstrainedError fallback in useCamera is the real validator.
 */
export function resolveCameraSelection({
	persistedId,
	devices,
}: {
	persistedId: string;
	devices: MediaDeviceInfo[];
}): { deviceId: string | null } {
	const validIds = devices.map((d) => d.deviceId).filter(Boolean);
	const canValidate = validIds.length > 0;
	if (persistedId && (!canValidate || validIds.includes(persistedId))) {
		return { deviceId: persistedId };
	}
	return { deviceId: null };
}
```

- [ ] **Step 4: Run — expect PASS (5/5)**

- [ ] **Step 5: Commit**

```bash
git add src/services/CameraService.ts src/services/CameraService.test.ts
git commit -m "feat: pure resolveCameraSelection policy - never first-in-list

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Sequenced startup in `useCamera` — kill the H1 race

**Files:**
- Modify: `src/hooks/useCamera.ts` (delete the auto-select block in `getDevices` lines 34-44; rewrite the stream effect lines 61-122)
- Modify: `src/hooks/useCamera.test.ts` (rewrite one codified-bug test; add the race test)

**Interfaces:**
- Consumes: `resolveCameraSelection` (Task 1).
- Produces: sequencing + `activeConfigRef` idempotence guard that Task 3's fallback path extends. Return shape unchanged.

**Context — the bug:** `setupCamera` fires `getDevices()` fire-and-forget (line 87), then syncs selection from the track (lines 89-99). The in-flight `getDevices` closed over `selectedDeviceId === ""`, so when it resolves it overwrites the browser-chosen selection with `videoDevices[0]` and PERSISTS it (lines 35-44). Wrong camera pinned forever whenever first-enumerated ≠ OS default.

- [ ] **Step 1: Rewrite the codified-bug test.** In `useCamera.test.ts`, replace `"selects first device if none selected"` (device-enumeration describe) with:

```typescript
		it("shows the first device for display but never persists an unchosen selection", async () => {
			vi.mocked(CameraService.getVideoDevices).mockResolvedValue([
				createMockDevice("device-1", "Camera 1"),
				createMockDevice("device-2", "Camera 2"),
			]);
			// Stream track reports NO deviceId (e.g. canvas/virtual source)
			const anonymousTrack = {
				kind: "video",
				stop: vi.fn(),
				getSettings: () => ({}),
			};
			vi.mocked(CameraService.start).mockResolvedValue({
				getTracks: () => [anonymousTrack],
				getVideoTracks: () => [anonymousTrack],
				getAudioTracks: () => [],
				active: true,
			} as unknown as MediaStream);

			const { result } = renderHook(() => useCamera());

			await waitFor(() => {
				expect(result.current.selectedDeviceId).toBe("device-1");
			});
			// Display-only fallback: nothing persisted (H1's poison was the persist)
			expect(DeviceService.setStorageItem).not.toHaveBeenCalledWith(
				"magic-monitor-camera-device-id",
				expect.anything(),
			);
		});
```

- [ ] **Step 2: Add the H1 race test** (same describe):

```typescript
		it("a slow device enumeration cannot override the browser-chosen device (H1)", async () => {
			// Enumeration is slow; the stream (OS-chosen device-os) resolves first
			let resolveDevices!: (d: MediaDeviceInfo[]) => void;
			vi.mocked(CameraService.getVideoDevices).mockReturnValue(
				new Promise((r) => {
					resolveDevices = r;
				}),
			);
			vi.mocked(CameraService.start).mockResolvedValue(
				createMockStream("device-os"),
			);

			const { result } = renderHook(() => useCamera());

			// Let enumeration resolve LATE, listing a different device first
			resolveDevices([
				createMockDevice("device-virtual", "OBS Virtual"),
				createMockDevice("device-os", "Built-in"),
			]);

			await waitFor(() => {
				expect(result.current.selectedDeviceId).toBe("device-os");
			});
			// The stale enumeration must not have pinned the virtual camera
			expect(DeviceService.setStorageItem).not.toHaveBeenCalledWith(
				"magic-monitor-camera-device-id",
				"device-virtual",
			);
		});
```

Note: with the sequenced rewrite, `getVideoDevices` is awaited INSIDE `setupCamera` before `start` — the mock's single pending promise serves both the pre-open enumeration and the post-open refresh; `mockReturnValue` (not Once) keeps both calls served. If the implementation calls it twice with separate promises needed, use `.mockReturnValueOnce(pending).mockResolvedValue([...])` and note it.

- [ ] **Step 3: Run — expect BOTH to FAIL against current code** (first: `setStorageItem` WAS called with device-1; second: selection ends "device-virtual" or persists it)

- [ ] **Step 4: Implement the sequenced rewrite** in `useCamera.ts`:

Replace `getDevices` (lines 30-45) with enumeration-only:

```typescript
	const getDevices = useCallback(async () => {
		const videoDevices = await CameraService.getVideoDevices();
		setDevices(videoDevices);
	}, []);
```

Add the idempotence guard ref next to `streamRef`:

```typescript
	// What the live stream was opened for — lets an adoption-driven state
	// update skip a needless (visible) stream restart.
	const activeConfigRef = useRef<{
		deviceId: string;
		resolution: Resolution;
		orientation: Orientation;
		retryCount: number;
	} | null>(null);
```

Replace the stream effect body (keep deps `[selectedDeviceId, resolution, orientation, getDevices, retryCount]`):

```typescript
	useEffect(() => {
		let isActive = true;

		async function setupCamera() {
			// Skip if the live stream already satisfies this exact request
			// (happens when adoption below writes selectedDeviceId for the
			// stream we just opened).
			const active = activeConfigRef.current;
			if (
				active &&
				streamRef.current &&
				active.deviceId === selectedDeviceId &&
				active.resolution === resolution &&
				active.orientation === orientation &&
				active.retryCount === retryCount
			) {
				return;
			}

			try {
				if (streamRef.current) {
					CameraService.stop(streamRef.current);
					streamRef.current = null;
				}

				// Sequenced: enumerate -> resolve -> open. No fire-and-forget
				// racing the selection (H1).
				const preDevices = await CameraService.getVideoDevices();
				if (!isActive) return;
				setDevices(preDevices);

				const resolved = resolveCameraSelection({
					persistedId: selectedDeviceId,
					devices: preDevices,
				});

				const newStream = await CameraService.start(
					resolved.deviceId ?? undefined,
					resolution,
					orientation,
				);

				if (!isActive) {
					CameraService.stop(newStream);
					return;
				}

				streamRef.current = newStream;
				setStream(newStream);
				setError(null);

				// Refresh device list to get labels after permission grant
				const postDevices = await CameraService.getVideoDevices();
				if (isActive) {
					setDevices(postDevices);
				}

				// Adopt the device the stream actually serves. If the track is
				// anonymous (no deviceId — virtual/canvas sources), fall back to
				// the first enumerated device for DISPLAY ONLY: persisting an
				// unchosen device was H1's root cause.
				const track = newStream.getVideoTracks()[0];
				const trackDeviceId = track?.getSettings().deviceId ?? null;
				const displayId =
					selectedDeviceId ||
					trackDeviceId ||
					postDevices.find((d) => d.deviceId)?.deviceId ||
					"";

				activeConfigRef.current = {
					deviceId: displayId,
					resolution,
					orientation,
					retryCount,
				};

				if (!selectedDeviceId && displayId && isActive) {
					setSelectedDeviceId(displayId);
					if (trackDeviceId) {
						// Only a device the browser actually opened gets persisted
						DeviceService.setStorageItem(DEVICE_ID_STORAGE_KEY, trackDeviceId);
					}
				}
			} catch (err) {
				if (isActive) {
					console.error("Error accessing camera:", err);
					if (err instanceof InsecureContextError) {
						setError(err.message);
					} else {
						setError("Could not access camera. Please allow permissions.");
					}
					setStream(null);
				}
			}
		}

		setupCamera();

		return () => {
			isActive = false;
			activeConfigRef.current = null;
			if (streamRef.current) {
				CameraService.stop(streamRef.current);
				streamRef.current = null;
			}
		};
	}, [selectedDeviceId, resolution, orientation, getDevices, retryCount]);
```

(The mount/devicechange effect at lines 48-58 stays — `getDevices` is now enumeration-only, so the listener just refreshes the list. Note the effect no longer calls `getDevices()` fire-and-forget inside `setupCamera` — the awaited calls replace it.)

- [ ] **Step 5: Run the file's full suite.** The two new tests GREEN. Walk any other failures carefully: tests asserting `start(deviceId, ...)` call shapes still pass (persisted id flows through the resolver unchanged); `"extracts device ID from stream when not set"` should still pass via the adoption branch (track HAS a deviceId in that test's mock). Any test failing because it depended on first-device PERSISTENCE is the H1 contract and may be rewritten with justification — anything else, stop and investigate.

- [ ] **Step 6: Full unit suite + camera E2E group green; commit**

```bash
git add src/hooks/useCamera.ts src/hooks/useCamera.test.ts
git commit -m "fix: sequenced camera startup - enumeration can no longer override the browser-chosen device (H1)

enumerate -> resolve -> open -> adopt in one cancellable path. The
fire-and-forget auto-select that persisted first-in-list is gone;
anonymous tracks get a display-only first-device fallback that is
never persisted. Rewrites the test that codified the auto-select.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: M3 — stale-id recovery + accurate errors + unplug detection

**Files:**
- Modify: `src/hooks/useCamera.ts` (fallback in the catch-free inner path; error mapping; track ended listener)
- Modify: `src/hooks/useCamera.test.ts` (three new tests)

**Interfaces:** none new externally. `retry` semantics improve for free (the fallback runs inside setup, so retry no longer loops a failing constraint).

- [ ] **Step 1: Failing tests** (error-handling describe):

```typescript
		it("falls back to the OS default and clears the stale persisted id on OverconstrainedError (M3)", async () => {
			vi.mocked(DeviceService.getStorageItem).mockReturnValue("stale-id");
			vi.mocked(CameraService.getVideoDevices).mockResolvedValue([]); // pre-permission: can't validate
			const overconstrained = new Error("device not found");
			overconstrained.name = "OverconstrainedError";
			vi.mocked(CameraService.start)
				.mockRejectedValueOnce(overconstrained) // exact constraint fails
				.mockResolvedValue(createMockStream("real-device")); // unconstrained succeeds

			const { result } = renderHook(() => useCamera());

			await waitFor(() => {
				expect(result.current.stream).not.toBeNull();
			});
			expect(result.current.error).toBeNull(); // recovery is silent - camera works
			// Second start call was unconstrained
			expect(vi.mocked(CameraService.start).mock.calls[1][0]).toBeUndefined();
			// Stale id replaced by the adopted real device
			expect(DeviceService.setStorageItem).toHaveBeenCalledWith(
				"magic-monitor-camera-device-id",
				"real-device",
			);
		});

		it("reports an accurate message when the selected camera is unavailable and fallback also fails (M3)", async () => {
			vi.mocked(DeviceService.getStorageItem).mockReturnValue("stale-id");
			const overconstrained = new Error("device not found");
			overconstrained.name = "OverconstrainedError";
			vi.mocked(CameraService.start).mockRejectedValue(overconstrained);

			const { result } = renderHook(() => useCamera());

			await waitFor(() => {
				expect(result.current.error).toBe(
					"Selected camera is unavailable. It may be unplugged.",
				);
			});
		});

		it("re-runs selection when the live track ends (unplug) instead of freezing (M3)", async () => {
			let endedHandler: (() => void) | null = null;
			const track = {
				kind: "video",
				stop: vi.fn(),
				getSettings: () => ({ deviceId: "device-1" }),
				addEventListener: vi.fn((event: string, cb: () => void) => {
					if (event === "ended") endedHandler = cb;
				}),
				removeEventListener: vi.fn(),
			};
			const stream1 = {
				getTracks: () => [track],
				getVideoTracks: () => [track],
				getAudioTracks: () => [],
				active: true,
			} as unknown as MediaStream;
			vi.mocked(CameraService.start)
				.mockResolvedValueOnce(stream1)
				.mockResolvedValue(createMockStream("device-2"));

			const { result } = renderHook(() => useCamera());
			await waitFor(() => {
				expect(result.current.stream).toBe(stream1);
			});
			expect(endedHandler).not.toBeNull();

			act(() => {
				endedHandler?.();
			});

			// Setup re-ran: a new stream replaced the dead one
			await waitFor(() => {
				expect(result.current.stream).not.toBe(stream1);
				expect(result.current.stream).not.toBeNull();
			});
		});
```

Note: `createMockStream`'s track has no `addEventListener` — the new listener code must tolerate tracks without it (optional call) OR extend `createMockStream`'s mock track with no-op `addEventListener`/`removeEventListener` (preferred: extend the helper, it's used everywhere).

- [ ] **Step 2: Run — expect all three to FAIL** (no fallback: generic permissions error; no message differentiation; no ended listener anywhere — grep confirms zero `"ended"` hits in src/)

- [ ] **Step 3: Implement in the Task 2 effect body:**

Replace the single `CameraService.start(...)` call with the fallback sequence:

```typescript
				let newStream: MediaStream;
				try {
					newStream = await CameraService.start(
						resolved.deviceId ?? undefined,
						resolution,
						orientation,
					);
				} catch (err) {
					const isOverconstrained =
						err instanceof Error && err.name === "OverconstrainedError";
					if (!isOverconstrained || !resolved.deviceId) throw err;
					// Stale persisted id (M3): drop it and fall back to the OS
					// default. The adoption step below persists what actually opens.
					DeviceService.setStorageItem(DEVICE_ID_STORAGE_KEY, "");
					newStream = await CameraService.start(
						undefined,
						resolution,
						orientation,
					);
				}
```

Extend the catch's error mapping (the outer catch):

```typescript
				if (err instanceof InsecureContextError) {
					setError(err.message);
				} else if (err instanceof Error && err.name === "OverconstrainedError") {
					setError("Selected camera is unavailable. It may be unplugged.");
				} else if (err instanceof Error && err.name === "NotAllowedError") {
					setError("Could not access camera. Please allow permissions.");
				} else {
					setError("Could not access camera. Please allow permissions.");
				}
```

Add the unplug listener after `streamRef.current = newStream;`:

```typescript
				// Unplug detection (M3): a dead track re-runs selection instead of
				// leaving a frozen frame.
				const liveTrack = newStream.getVideoTracks()[0];
				const onTrackEnded = () => {
					if (isActive) {
						setRetryCount((c) => c + 1);
					}
				};
				liveTrack?.addEventListener?.("ended", onTrackEnded);
```

And in the effect cleanup, before stopping the stream:

```typescript
			const cleanupTrack = streamRef.current?.getVideoTracks()[0];
			cleanupTrack?.removeEventListener?.("ended", onTrackEnded);
```

(`onTrackEnded` must be hoisted to the effect scope — declare `let onTrackEnded: (() => void) | undefined;` at the effect top and assign inside `setupCamera`, so the cleanup closure can reach it.)

Also extend `createMockStream`'s mock track in the test helper with `addEventListener: vi.fn(), removeEventListener: vi.fn()`.

Walkthrough for reviewers: unplug → `ended` → retryCount bump → setup re-runs → persisted id (possibly the dead device) → exact constraint fails with OverconstrainedError → fallback clears it and opens the OS default → adoption persists the working device. The pieces compose; no special orchestration.

- [ ] **Step 4: Run file suite — all green. Full unit + camera E2E group. Commit**

```bash
git add src/hooks/useCamera.ts src/hooks/useCamera.test.ts
git commit -m "fix: stale camera ids recover to OS default; unplug re-selects (M3)

OverconstrainedError falls back to an unconstrained open and clears the
stale persisted id (silent when recovery works, accurate message when it
does not - no more bogus permissions advice). The live track gets an
ended listener so an unplugged camera re-runs selection instead of
freezing.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: DI refactor — camera services join the object-literal convention

**Files:**
- Modify: `src/services/CameraService.ts`, `src/services/CameraSettingsService.ts`
- Modify: `src/hooks/useCamera.ts` (imports), `src/hooks/useCamera.test.ts` (mock shape)

**Context:** Convention per `DeviceService`/`TimerService`/`ShareService`: `export const XService = { ...methods }` + `export type XServiceType = typeof XService`. TYPES and pure/class exports stay top-level: `Resolution`, `Orientation`, `CameraSettings`, `RESOLUTION_PRESETS`, `InsecureContextError`, `resolveCameraSelection` — `SettingsModal.tsx:5` imports stay untouched. `updateSettingForDevice`'s three-part overload moves onto the object literal as method overloads (TS supports this in object literals via call-signature syntax — if the overload syntax fights the object-literal form, keep `updateSettingForDevice` as a top-level function that delegates to the object's get/save methods, and note it).

- [ ] **Step 1:** Reshape `CameraService.ts`: `isSecureContext`, `getVideoDevices`, `start`, `stop`, `addDeviceChangeListener` become methods of `export const CameraService = {...}` (sibling calls via `this.`); add `export type CameraServiceType = typeof CameraService;`. Top-level exports unchanged otherwise.
- [ ] **Step 2:** Reshape `CameraSettingsService.ts` the same way (`getSettingsForDevice`, `saveSettingsForDevice`, `updateSettingForDevice`, `getAllDeviceSettings`) + `CameraSettingsServiceType`.
- [ ] **Step 3:** Update `useCamera.ts`: `import * as CameraService` → `import { CameraService, InsecureContextError, resolveCameraSelection, type Orientation, type Resolution } from "../services/CameraService";` and `import * as CameraSettingsService` → named import. Call sites are textually identical (`CameraService.start(...)`).
- [ ] **Step 4:** Update `useCamera.test.ts`'s mock block to the DeviceService pattern:

```typescript
vi.mock("../services/CameraService", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../services/CameraService")>();
	return {
		...actual, // keeps resolveCameraSelection, types, RESOLUTION_PRESETS real
		CameraService: {
			getVideoDevices: vi.fn(),
			start: vi.fn(),
			stop: vi.fn(),
			addDeviceChangeListener: vi.fn(),
			isSecureContext: vi.fn().mockReturnValue(true),
		},
		InsecureContextError: actual.InsecureContextError,
	};
});
```

`vi.mocked(CameraService.X)` call sites become `vi.mocked(CameraService.CameraService.X)`? No — with the named import `import { CameraService } from ...` in the test file, `vi.mocked(CameraService.getVideoDevices)` stays textually identical. Verify each of the ~15 `vi.mocked` sites compiles.
- [ ] **Step 5:** `npx tsc -b` clean; full unit suite green (zero behavior change expected — any test failure is a refactor mistake, fix it, never adjust assertions).
- [ ] **Step 6: Commit**

```bash
git add src/services/CameraService.ts src/services/CameraSettingsService.ts src/hooks/useCamera.ts src/hooks/useCamera.test.ts
git commit -m "refactor: camera services join the object-literal DI convention

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: `CameraSettingsService.test.ts` — first coverage of real persistence logic

**Files:**
- Create: `src/services/CameraSettingsService.test.ts`

**Context:** mock `DeviceService` per the established pattern (`vi.mock` returning `{ DeviceService: { getStorageItem: vi.fn(), setStorageItem: vi.fn() } }`). Storage key: `"magic-monitor-camera-device-settings"`, JSON `Record<deviceId, CameraSettings>`. Defaults: `{ resolution: "4k", orientation: "landscape" }`. Known asymmetry, out of scope, do NOT fix: `getAllDeviceSettings` doesn't per-entry merge defaults.

- [ ] **Step 1: Write the tests** (these pass immediately — this is coverage of existing behavior, not TDD of new behavior; say so in the report):

```typescript
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DeviceService } from "./DeviceService";
import { CameraSettingsService } from "./CameraSettingsService";

vi.mock("./DeviceService", () => ({
	DeviceService: {
		getStorageItem: vi.fn(),
		setStorageItem: vi.fn(),
	},
}));

const KEY = "magic-monitor-camera-device-settings";

describe("CameraSettingsService", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(DeviceService.getStorageItem).mockReturnValue(null);
	});

	describe("getSettingsForDevice", () => {
		it("returns defaults when nothing is stored", () => {
			expect(CameraSettingsService.getSettingsForDevice("cam-1")).toEqual({
				resolution: "4k",
				orientation: "landscape",
			});
		});

		it("returns defaults for an empty deviceId", () => {
			expect(CameraSettingsService.getSettingsForDevice("")).toEqual({
				resolution: "4k",
				orientation: "landscape",
			});
			expect(DeviceService.getStorageItem).not.toHaveBeenCalled();
		});

		it("recovers to defaults on corrupt JSON", () => {
			vi.mocked(DeviceService.getStorageItem).mockReturnValue("{not json");
			expect(CameraSettingsService.getSettingsForDevice("cam-1")).toEqual({
				resolution: "4k",
				orientation: "landscape",
			});
		});

		it("merges partial stored settings over defaults", () => {
			vi.mocked(DeviceService.getStorageItem).mockReturnValue(
				JSON.stringify({ "cam-1": { resolution: "720p" } }),
			);
			expect(CameraSettingsService.getSettingsForDevice("cam-1")).toEqual({
				resolution: "720p",
				orientation: "landscape",
			});
		});
	});

	describe("updateSettingForDevice", () => {
		it("updates one key and preserves the other, per device", () => {
			vi.mocked(DeviceService.getStorageItem).mockReturnValue(
				JSON.stringify({
					"cam-1": { resolution: "1080p", orientation: "portrait" },
					"cam-2": { resolution: "4k", orientation: "landscape" },
				}),
			);
			CameraSettingsService.updateSettingForDevice("cam-1", "resolution", "720p");
			expect(DeviceService.setStorageItem).toHaveBeenCalledWith(
				KEY,
				JSON.stringify({
					"cam-1": { resolution: "720p", orientation: "portrait" },
					"cam-2": { resolution: "4k", orientation: "landscape" },
				}),
			);
		});

		it("no-ops on an empty deviceId", () => {
			CameraSettingsService.updateSettingForDevice("", "resolution", "720p");
			expect(DeviceService.setStorageItem).not.toHaveBeenCalled();
		});
	});

	describe("saveSettingsForDevice", () => {
		it("starts fresh when stored JSON is corrupt instead of throwing", () => {
			vi.mocked(DeviceService.getStorageItem).mockReturnValue("{not json");
			CameraSettingsService.saveSettingsForDevice("cam-1", {
				resolution: "1080p",
				orientation: "portrait",
			});
			expect(DeviceService.setStorageItem).toHaveBeenCalledWith(
				KEY,
				JSON.stringify({
					"cam-1": { resolution: "1080p", orientation: "portrait" },
				}),
			);
		});
	});
});
```

Note the exact-`JSON.stringify` assertions depend on key insertion order — `cam-1` first in both fixtures keeps them deterministic. If an assertion proves order-fragile, switch to `JSON.parse(mock.calls[0][1])` + `toEqual` and say so.

- [ ] **Step 2: Run — expect PASS.** If any test FAILS, the existing behavior differs from the documented contract — STOP, report the discrepancy, do not adjust the code silently.
- [ ] **Step 3: Commit**

```bash
git add src/services/CameraSettingsService.test.ts
git commit -m "test: first coverage for CameraSettingsService persistence logic

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Full verification + PR

- [ ] **Step 1:** `npx tsc -b` clean; `nice -n 19 ionice -c 3 npx vitest run` all green.
- [ ] **Step 2:** Full serial E2E: `nice -n 19 ionice -c 3 npx playwright test --project=chromium 2>&1 | tail -6` then `cat test-results/.last-run.json` — status MUST be "passed" (flaky-with-retry acceptable; the known wandering MediaPipe bug is tracked). The camera-specific tests (device select shows Mock Camera 1/2, switching, per-device resolution persistence) are the ones this PR could plausibly break — check them by name in the output if anything fails.
- [ ] **Step 3:** Commit this plan doc; push; open the PR:

```bash
git add docs/superpowers/plans/2026-07-21-reliability-pr3-camera.md
git commit -m "docs: PR3 camera-cluster implementation plan

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
git push -u origin pr/reliability-camera
gh pr create --title "fix: deterministic camera selection - race, stale ids, unplug (reliability sweep PR3)" --body "PR3 of 4 from the reliability sweep design (spec: PR #66). Stacked on PR #68 (recorder machine).

- H1: sequenced enumerate->resolve->open->adopt startup. The fire-and-forget auto-select that persisted first-in-list (silently pinning OBS/virtual cams over the OS-chosen camera) is gone; anonymous tracks get a display-only fallback that is never persisted.
- M3: OverconstrainedError falls back to the OS default and clears the stale persisted id - silent when recovery works, accurate message when it doesn't (no more bogus 'allow permissions' advice). Live track gets an ended listener: unplugging re-selects instead of freezing.
- resolveCameraSelection pure policy + tests; camera services join the object-literal DI convention; CameraSettingsService gets its first unit tests.
- H4 note: the spec's delivery table listed H4 stream-change wiring here; it landed in PR2 (all touched files were PR2 files).

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

Report any deviations/`test.fixme`s in the PR body.

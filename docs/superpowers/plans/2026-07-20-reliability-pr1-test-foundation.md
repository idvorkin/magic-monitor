# Reliability Sweep PR1: Test Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the recording E2E path real — fix the always-broken MediaRecorder mock, type-check `tests/`, un-skip the two recording tests, and add the keystone record→session-appears test that currently doesn't exist.

**Architecture:** Pure test-infrastructure PR (spec: `docs/superpowers/specs/2026-07-20-reliability-sweep-design.md`, Section 6 + PR1 in Section 7). No `src/` changes. Today every session E2E test seeds IndexedDB directly and both recording tests are skipped, so broken record→storage wiring would ship green. This PR makes later fix-PRs verifiable end-to-end.

**Tech Stack:** Playwright (`tests/`), TypeScript project references (`tsc -b`), Vitest (unit, untouched).

## Global Constraints

- Branch: `pr/reliability-tests` off `origin/main` (NOT off the spec branch). Never push to main. Never `--no-verify`. Never `git add -A` without reviewing `git status` first.
- Pre-commit runs Biome (tabs, double quotes) + unit tests automatically. If a hook reformats files, the commit silently no-ops — check for the `[branch sha]` confirmation line after every commit; if missing, re-stage and retry.
- Never delete or weaken a failing test. If a new test fails against current `main`, that is a finding: mark it `test.fixme` with a comment describing observed behavior, and report it in the final summary — do not delete it.
- Commit messages end with: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`
- E2E commands need the dev server config Playwright manages itself (`npx playwright test` boots it). Run desktop project only: `--project=chromium`.

---

### Task 1: Deterministic MockMediaRecorder installation

**Files:**
- Modify: `tests/magic-monitor.spec.ts:181-193`

**Interfaces:**
- Produces: `injectMockCamera(page)` unchanged signature; after this task `window.MediaRecorder` is ALWAYS `MockMediaRecorder` in `magic-monitor.spec.ts` tests (deterministic).

**Context:** Line 184 reads `new OriginalMediaRecorder(stream, ...)` but the variable in scope is `activeStream` (line 75) — `stream` is undefined, the `try` always throws, and the mock is always installed. The "prefer the real recorder" logic has never run. The comment at line 544 records that the real MediaRecorder is unreliable with canvas streams in headless Chrome, so the correct fix is to make the always-mock behavior intentional, not to resurrect the broken detection.

- [ ] **Step 1: Replace the broken try/catch with unconditional mock install**

In `tests/magic-monitor.spec.ts`, replace lines 181-192:

```ts
		// Only use mock if original doesn't work with our stream
		// Test if the original MediaRecorder works
		try {
			const testRecorder = new OriginalMediaRecorder(stream, { mimeType: "video/webm" });
			testRecorder.start();
			testRecorder.stop();
			console.log("Original MediaRecorder works with canvas stream");
		} catch {
			console.log("Original MediaRecorder failed, using mock");
			// @ts-expect-error - overriding MediaRecorder
			window.MediaRecorder = MockMediaRecorder;
		}
```

with:

```ts
		// Always install the mock: MediaRecorder with canvas streams is
		// unreliable in headless Chrome, and deterministic recording data
		// is what the recording tests depend on.
		// @ts-expect-error - overriding MediaRecorder
		window.MediaRecorder = MockMediaRecorder;
```

Then delete the now-unused `const OriginalMediaRecorder = window.MediaRecorder;` at line 108 (Biome will flag the unused variable otherwise).

- [ ] **Step 2: Verify existing E2E behavior is preserved**

Run: `npx playwright test --project=chromium tests/magic-monitor.spec.ts -g "App loads"`
Expected: PASS (mock was already always installed; this only removes the dead path).

- [ ] **Step 3: Commit**

```bash
git add tests/magic-monitor.spec.ts
git commit -m "test: install MockMediaRecorder deterministically in E2E

The real-recorder detection referenced an undefined variable (stream vs
activeStream), so the try always threw and the mock was always installed.
Make that behavior intentional; headless Chrome canvas-stream recording
is unreliable per the existing comment.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Type-check `tests/` under `tsc -b`

**Files:**
- Create: `tsconfig.test.json`
- Modify: `tsconfig.json` (add reference)
- Modify: `tests/session-recorder.spec.ts:64`

**Interfaces:**
- Produces: `npx tsc -b` (and therefore `just build` / `just test`) now type-checks `tests/`. The undefined-variable bug class that hid Task 1's target can't recur.

**Context:** `tsconfig.app.json` includes only `src`; `tsconfig.node.json` only `vite.config.ts`. Nothing checks `tests/`. A probe run found exactly two errors: the `stream` bug (fixed in Task 1) and one unsafe `window` cast.

- [ ] **Step 1: Create `tsconfig.test.json`**

```json
{
	"extends": "./tsconfig.node.json",
	"compilerOptions": {
		"tsBuildInfoFile": "./node_modules/.tmp/tsconfig.test.tsbuildinfo",
		"lib": ["ES2023", "DOM", "DOM.Iterable"]
	},
	"include": ["tests"]
}
```

(Extends the node config for module/strictness settings; adds DOM libs because init scripts run in the browser context.)

- [ ] **Step 2: Reference it from the root solution config**

In `tsconfig.json`, change:

```json
	"references": [
		{ "path": "./tsconfig.app.json" },
		{ "path": "./tsconfig.node.json" }
	]
```

to:

```json
	"references": [
		{ "path": "./tsconfig.app.json" },
		{ "path": "./tsconfig.node.json" },
		{ "path": "./tsconfig.test.json" }
	]
```

- [ ] **Step 3: Run the build to see the expected failure**

Run: `npx tsc -b 2>&1 | head -10`
Expected: FAIL with exactly one error:
`tests/session-recorder.spec.ts(64,4): error TS2352: Conversion of type 'Window & typeof globalThis' ... Property 'counterCamera' is missing`

(If the `stream` error also appears, Task 1 was not completed — stop and fix that first.)

- [ ] **Step 4: Fix the cast**

In `tests/session-recorder.spec.ts` line 64, change:

```ts
		(window as Window & { counterCamera: { getCounter: () => number; reset: () => void } }).counterCamera = {
```

to:

```ts
		(window as unknown as Window & { counterCamera: { getCounter: () => number; reset: () => void } }).counterCamera = {
```

- [ ] **Step 5: Verify clean build**

Run: `npx tsc -b`
Expected: exit 0, no output.

- [ ] **Step 6: Commit**

```bash
git add tsconfig.json tsconfig.test.json tests/session-recorder.spec.ts
git commit -m "test: type-check tests/ via tsc -b

Playwright specs were checked by nothing (tsconfig.app includes only src),
which is how an undefined-variable bug in the MediaRecorder mock went
unnoticed. Add tsconfig.test.json and fix the one cast error it surfaced.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Un-skip the two recording tests

**Files:**
- Modify: `tests/magic-monitor.spec.ts:544-576`

**Interfaces:**
- Consumes: deterministic MockMediaRecorder from Task 1 (emits a chunk every 1000ms while recording).
- Produces: two live E2E tests asserting the REC indicator and the duration readout.

**Context:** The skip comment ("MediaRecorder with canvas stream doesn't work reliably") is obsolete — the mock is now always installed. Test 1's `/REC|\d+:\d+/` regex matches the actual `● REC` span (`src/components/CameraStage.tsx:495`). Test 2 expects an `m:ss` duration, but the status bar actually renders `` {Math.floor(currentBlockDuration)}s | N sessions `` (`CameraStage.tsx:497-498`) — the test must be rewritten against the real UI, not un-skipped verbatim.

- [ ] **Step 1: Un-skip and update both tests**

Replace lines 544-576 with:

```ts
	test("Recording: Shows recording indicator when live", async ({ page }) => {
		// Wait for app to load and start recording
		const video = page.getByTestId("main-video");
		await expect(video).toBeVisible();

		// Recording indicator should show REC once video + storage are ready
		const recordingIndicator = page.getByText("● REC");
		await expect(recordingIndicator).toBeVisible({ timeout: 10000 });
	});

	test("Recording: Duration counter increases over time", async ({ page }) => {
		// Wait for app to load
		const video = page.getByTestId("main-video");
		await expect(video).toBeVisible();

		// Status bar shows "<seconds>s | <n> sessions" while live
		// (.first() — the regex also matches ancestor spans; match innermost deterministically)
		const statusReadout = page.getByText(/\d+s \|/).first();
		await expect(statusReadout).toBeVisible({ timeout: 10000 });

		const initialText = await statusReadout.textContent();

		// Wait for the block duration to tick up
		await expect(async () => {
			const newText = await statusReadout.textContent();
			expect(newText).not.toBe(initialText);
		}).toPass({ timeout: 5000 });
	});
```

- [ ] **Step 2: Run both tests**

Run: `npx playwright test --project=chromium tests/magic-monitor.spec.ts -g "Recording:"`
Expected: 2 passed.
If either fails: investigate against current `main` behavior. A genuine failure (e.g. REC never appears with the mock recorder) is a finding for the sweep — mark the test `test.fixme` with a comment describing what was observed and report it; do not delete.

- [ ] **Step 3: Commit**

```bash
git add tests/magic-monitor.spec.ts
git commit -m "test: un-skip recording indicator E2E tests

The skip reason (unreliable canvas-stream MediaRecorder) is obsolete now
that the mock is installed deterministically. Duration test rewritten to
match the actual status readout format (Ns | M sessions).

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Keystone test — recording produces a real session (no seeding)

**Files:**
- Modify: `tests/magic-monitor.spec.ts` (append inside the `test.describe("Magic Monitor E2E", ...)` block, after the duration test from Task 3)

**Interfaces:**
- Consumes: MockMediaRecorder chunks (Task 1); `● REC` indicator (Task 3).
- Produces: the only E2E test exercising record → stop → save → appears-in-picker without `seedSessionBuffer`.

**Context:** Opening the Sessions picker stops the current block and saves it (`CameraStage.tsx:235-241` → `stopCurrentBlock`), so a few seconds of recording then opening the picker must yield a Recent session. Every existing session test bypasses this via `tests/helpers/seedSessionBuffer.ts`. Picker selectors from existing tests: `page.getByRole("button", { name: "Sessions" })`, `page.getByRole("heading", { name: "Sessions" })`; empty state renders `No recent recordings` (`src/components/SessionPicker.tsx:250-253`).

- [ ] **Step 1: Add the test**

```ts
	test("Recording: A real recorded block appears in Sessions without seeding", async ({ page }) => {
		// Wait for recording to actually start
		await expect(page.getByTestId("main-video")).toBeVisible();
		await expect(page.getByText("● REC")).toBeVisible({ timeout: 10000 });

		// Let the mock recorder emit at least two 1s chunks
		await page.waitForTimeout(2500);

		// Opening the picker stops and saves the current block
		await page.getByRole("button", { name: "Sessions" }).click();
		await expect(page.getByRole("heading", { name: "Sessions" })).toBeVisible();

		// The just-recorded block must appear as a Recent session.
		// This is the only test covering record→storage→picker for real;
		// everything else seeds IndexedDB directly.
		await expect(page.getByText("No recent recordings")).toBeHidden({ timeout: 10000 });
	});
```

- [ ] **Step 2: Run it**

Run: `npx playwright test --project=chromium tests/magic-monitor.spec.ts -g "appears in Sessions"`
Expected: PASS.
If it fails with "No recent recordings" still visible: this is exactly the class of bug the sweep exists for (silent save failure / machine dead state). Mark `test.fixme` with the observed behavior and report it prominently — the fix lands in PR2, and this test becomes its acceptance criterion. Do not delete.

- [ ] **Step 3: Commit**

```bash
git add tests/magic-monitor.spec.ts
git commit -m "test: keystone E2E - recorded block appears in Sessions unseeded

First end-to-end coverage of record -> stop -> save -> picker. All other
session tests seed IndexedDB directly, so broken recording wiring would
ship green without this.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Full verification + PR

**Files:** none (verification only)

- [ ] **Step 1: Full desktop E2E suite**

Run: `npx playwright test --project=chromium`
Expected: all pass (4 skips maximum: the pre-existing `test.skip` zoom/pan tests; zero recording skips remain).

- [ ] **Step 2: Unit suite + type-check via the real pipeline**

Run: `just test`
Expected: `tsc -b` clean (now includes tests/), 568+ unit tests pass.

- [ ] **Step 3: Commit the plan doc, push, open PR**

```bash
git add docs/superpowers/plans/2026-07-20-reliability-pr1-test-foundation.md
git commit -m "docs: PR1 test-foundation implementation plan

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
git push -u origin pr/reliability-tests
gh pr create --title "test: recording E2E foundation (reliability sweep PR1)" --body "PR1 of 4 from the reliability sweep design (docs/superpowers/specs/2026-07-20-reliability-sweep-design.md).

- Fix the MediaRecorder mock that was silently always-on due to an undefined variable, and install it deterministically
- Type-check tests/ under tsc -b (the enabler that let that bug hide)
- Un-skip both recording indicator tests (duration test rewritten to match the real status readout)
- Add the keystone test: a real recorded block appears in Sessions without IndexedDB seeding

No src/ changes. Makes PR2-PR4 verifiable end-to-end.

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

Expected: PR URL printed. Report any `test.fixme` findings from Tasks 3-4 in the PR body and the session summary.

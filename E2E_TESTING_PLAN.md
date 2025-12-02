# E2E Testing with Playwright

A reusable guide for setting up comprehensive E2E testing with Playwright, including visual reporting, video recording, and trace debugging.

## Goal

**Eliminate manual testing through automated visual verification.**

E2E tests with video recording and screenshots serve as living documentation of application behavior. Instead of manually clicking through the app to verify features work, run tests and review the captured artifacts. The HTML report becomes your visual test evidence - watch videos of happy paths, inspect screenshots of UI states, and use trace viewer to debug failures.

---

## Playwright Setup

### 1. Install Playwright

```bash
npm install -D @playwright/test
npx playwright install chromium  # or: npx playwright install (all browsers)
```

### 2. playwright.config.ts

```typescript
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,

  // Reporters: console output + HTML report
  reporter: [
    ["list"],
    ["html", { outputFolder: "playwright-report" }],
  ],

  // Artifact capture settings
  use: {
    baseURL: "https://localhost:5173",  // Adjust to your dev server
    trace: "on",                         // Always capture traces
    video: "on",                         // Always record video
    screenshot: "on",                    // Always take screenshots
    ignoreHTTPSErrors: true,             // For self-signed certs
  },

  // Separate projects for desktop and mobile screen captures
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        headless: true,
      },
    },
    {
      name: "mobile",
      use: {
        ...devices["iPhone 14 Pro"],
        headless: true,
      },
    },
  ],

  // Optional: auto-start dev server (can be unreliable, consider manual start)
  // webServer: {
  //   command: "npm run dev",
  //   url: "https://localhost:5173",
  //   reuseExistingServer: true,
  //   timeout: 120 * 1000,
  // },
});
```

**Note**: With multiple projects, each test runs twice (desktop + mobile), generating separate videos and screenshots for each viewport. Use `--project=chromium` or `--project=mobile` to run only one.

### 3. Artifact Capture Options

| Option | Description |
|--------|-------------|
| `"on"` | Always capture |
| `"off"` | Never capture |
| `"retain-on-failure"` | Capture always, save only on failure |
| `"only-on-failure"` | Capture only when test fails |

**Recommendation**: Use `"on"` for development/debugging, `"retain-on-failure"` for CI to save storage.

### 4. Running Tests & Viewing Reports

```bash
# Run tests (start dev server manually first)
npm run dev &
npx playwright test

# View HTML report locally
npx playwright show-report

# Interactive UI mode for debugging
npx playwright test --ui

# View specific trace file
npx playwright show-trace path/to/trace.zip
```

### 5. Serving Reports on Tailscale / Remote Machines

By default, `playwright show-report` binds to `localhost`, which isn't accessible from other machines. To view reports remotely (e.g., when developing in a container or VM accessed via Tailscale):

```bash
# Bind to all interfaces so Tailscale can reach it
npx playwright show-report --host 0.0.0.0

# Report will be served on port 9323 by default
# Access via your Tailscale hostname:
# http://your-machine.tailnet-name.ts.net:9323
```

**Example**: If your Tailscale hostname is `c-5002.squeaker-teeth.ts.net`, access:
```
http://c-5002.squeaker-teeth.ts.net:9323
```

**Note**: The trace viewer and video playback work fully in the browser - no additional server configuration needed. All artifacts are served from the same report server.

### 6. Add to .gitignore

```
playwright-report/
test-results/
```

### 7. Add npm scripts (package.json)

```json
{
  "scripts": {
    "e2e": "playwright test",
    "e2e:ui": "playwright test --ui",
    "e2e:report": "playwright show-report"
  }
}
```

### 8. Justfile commands (if using just)

```just
# Run E2E tests (Playwright) - all projects
e2e:
    npx playwright test

# Run E2E tests - desktop only
e2e-desktop:
    npx playwright test --project=chromium

# Run E2E tests - mobile only
e2e-mobile:
    npx playwright test --project=mobile

# View E2E test report (Tailscale accessible)
e2e-report:
    npx playwright show-report --host 0.0.0.0

# Run E2E tests with interactive UI
e2e-ui:
    npx playwright test --ui
```

---

## Testing Strategy

### Phase 1: Core Functionality
Establish baseline coverage for critical user flows.

| Category | What to Test |
|----------|--------------|
| **Happy paths** | Primary user journeys work end-to-end |
| **Authentication** | Login, logout, session persistence |
| **CRUD operations** | Create, read, update, delete for main entities |
| **Navigation** | Routes, deep links, back/forward |
| **Forms** | Validation, submission, error display |

### Phase 2: Edge Cases & Error Handling

| Category | What to Test |
|----------|--------------|
| **Error states** | API failures, network errors, permission denied |
| **Empty states** | No data, first-time user experience |
| **Boundary conditions** | Max lengths, large datasets, special characters |
| **Concurrent actions** | Rapid clicks, race conditions |

### Phase 3: Cross-Platform & Visual

| Category | What to Test |
|----------|--------------|
| **Mobile viewports** | Touch interactions, responsive layouts |
| **Multi-browser** | Firefox, WebKit in addition to Chromium |
| **Visual regression** | Screenshot comparison for critical UI states |
| **Accessibility** | Keyboard navigation, screen reader basics |

### Phase 4: Performance & Stress

| Category | What to Test |
|----------|--------------|
| **Load times** | Page load, time to interactive |
| **Large data** | Pagination, infinite scroll, big lists |
| **Memory** | Long sessions, repeated operations |
| **Offline** | Service worker behavior, cached content |

---

## Advanced Patterns

### Smoke Test Tier
Add a fast smoke test suite (<30s) for quick feedback before full runs:

```typescript
// playwright.config.ts - add smoke project
projects: [
  {
    name: "smoke",
    testMatch: "**/smoke.spec.ts",
    use: { ...devices["Desktop Chrome"], headless: true },
  },
  {
    name: "chromium",
    testIgnore: "**/smoke.spec.ts",
    use: { ...devices["Desktop Chrome"], headless: true },
  },
  // ... other projects
]
```

```just
# Quick sanity check (<30s)
e2e-smoke:
    npx playwright test --project=smoke
```

### Test Tagging & Filtering
Use `test.describe` for selective test runs:

```typescript
test.describe("@critical", () => {
  test("login works", async ({ page }) => { ... });
});

test.describe("@slow", () => {
  test("export large file", async ({ page }) => { ... });
});
```

```bash
# Run only critical tests
npx playwright test --grep @critical

# Skip slow tests
npx playwright test --grep-invert @slow
```

### API Mocking
Intercept network requests for reliable, fast tests:

```typescript
test("shows error on API failure", async ({ page }) => {
  await page.route("**/api/users", (route) => {
    route.fulfill({ status: 500, json: { error: "Server error" } });
  });

  await page.goto("/users");
  await expect(page.getByText("Failed to load")).toBeVisible();
});

test("displays mock data", async ({ page }) => {
  await page.route("**/api/users", (route) => {
    route.fulfill({ json: [{ id: 1, name: "Test User" }] });
  });

  await page.goto("/users");
  await expect(page.getByText("Test User")).toBeVisible();
});
```

### Flaky Test Handling

```typescript
// Mark known flaky tests to skip
test.fixme("sometimes fails due to timing", async ({ page }) => { ... });

// Retry specific test group
test.describe("network-dependent tests", () => {
  test.describe.configure({ retries: 3 });

  test("fetches remote data", async ({ page }) => { ... });
});
```

### Global Setup/Teardown
For database seeding, auth tokens, or shared state:

```typescript
// playwright.config.ts
export default defineConfig({
  globalSetup: require.resolve("./tests/global-setup.ts"),
  globalTeardown: require.resolve("./tests/global-teardown.ts"),
  // ...
});
```

```typescript
// tests/global-setup.ts
export default async function globalSetup() {
  // Seed database, create auth tokens, etc.
  process.env.TEST_AUTH_TOKEN = await getAuthToken();
}
```

### Explicit Timeouts
Prevent hanging tests with explicit timeouts:

```typescript
// playwright.config.ts
export default defineConfig({
  timeout: 60000,              // Per-test timeout (60s)
  expect: {
    timeout: 5000,             // Assertion timeout (5s)
  },
  use: {
    actionTimeout: 10000,      // Per-action timeout (10s)
    navigationTimeout: 30000,  // Page load timeout (30s)
  },
});
```

### Test Isolation
**Important**: Each test must be independent. Never rely on test execution order.

```typescript
// ❌ Bad - tests depend on each other
test("create user", async ({ page }) => { ... });
test("edit user", async ({ page }) => { /* assumes user exists */ });

// ✅ Good - each test sets up its own state
test("edit user", async ({ page }) => {
  await seedUser({ id: 1, name: "Test" });  // Own setup
  await page.goto("/users/1/edit");
  // ...
});
```

---

## Test Infrastructure Patterns

### Common Helpers to Create

```
tests/helpers/
├── auth.ts              # Login/logout utilities
├── fixtures.ts          # Test data factories
├── mocks.ts             # API/service mocks
├── waitFor.ts           # Polling/timing utilities
└── mobile.ts            # Mobile viewport helpers
```

### Recommended Test Structure

```
tests/
├── helpers/             # Shared utilities
├── fixtures/            # Static test data (images, files)
├── auth.spec.ts         # Authentication tests
├── dashboard.spec.ts    # Feature-specific tests
└── smoke.spec.ts        # Quick sanity checks
```

---

## Why Playwright (vs Cypress)

| Feature | Playwright | Cypress |
|---------|------------|---------|
| Multi-browser | ✅ Chromium, Firefox, WebKit | ⚠️ Limited WebKit |
| Mobile emulation | ✅ Built-in | ⚠️ Viewport only |
| Parallel execution | ✅ Native | ⚠️ Paid feature |
| Trace viewer | ✅ Time-travel debugging | ❌ |
| Video recording | ✅ Built-in | ✅ Built-in |
| iframes | ✅ Full support | ⚠️ Limited |
| Multiple tabs | ✅ Supported | ❌ |

---

## Commands Reference

```bash
# Run all E2E tests
npx playwright test

# Run specific test file
npx playwright test tests/auth.spec.ts

# Run tests matching pattern
npx playwright test -g "login"

# View last report
npx playwright show-report

# Run with UI mode (interactive debugging)
npx playwright test --ui

# Update visual regression snapshots
npx playwright test --update-snapshots

# Run in headed mode (see browser)
npx playwright test --headed

# Debug a specific test
npx playwright test --debug -g "login"
```

---

## CI/CD Integration

### Best Practices
- Use `headless: true` (default) for CI environments
- Set `retries: 2` for CI to handle flaky tests
- Use `retain-on-failure` for artifacts to save storage
- Consider `workers: 1` on CI if tests have shared state
- Upload `playwright-report/` as CI artifact for debugging

### GitHub Actions Example

```yaml
name: E2E Tests

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  e2e:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: "npm"

      - name: Install dependencies
        run: npm ci

      - name: Install Playwright browsers
        run: npx playwright install --with-deps chromium

      - name: Build app
        run: npm run build

      - name: Run E2E tests
        run: npx playwright test
        env:
          CI: true

      - name: Upload report
        uses: actions/upload-artifact@v4
        if: always()
        with:
          name: playwright-report
          path: playwright-report/
          retention-days: 7

      - name: Upload test results
        uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: test-results
          path: test-results/
          retention-days: 7
```

---

# Appendix: Magic Monitor Project

Project-specific E2E testing details for the Magic Monitor application.

## Current State

### What We Have
- ✅ Playwright installed and configured (`@playwright/test`)
- ✅ Canvas-based mock camera in `tests/magic-monitor.spec.ts`
- ✅ Test fixtures (test-chunk.webm, test-preview.jpg)
- ✅ Helper for seeding IndexedDB (`tests/helpers/seedRewindBuffer.ts`)
- ✅ Basic E2E tests covering:
  - Camera initialization
  - Settings modal
  - Flash detection (skipped - timing issues)
  - Time machine (enter/exit replay, thumbnails, export)
  - Zoom and quality controls

### Configuration
- ✅ HTML reporter with interactive UI
- ✅ Video recording (`video: "on"`)
- ✅ Screenshots (`screenshot: "on"`)
- ✅ Trace recording (`trace: "on"`)
- ✅ HTTPS support with `ignoreHTTPSErrors: true`
- ✅ Headless mode enabled

## Testing Gaps to Address

### Phase 1: Fix & Stabilize
1. **Fix skipped flash detection test** (`tests/magic-monitor.spec.ts:121`)
   - Issue: Mock canvas stream and flash detector RAF loops don't sync reliably
   - Solution: Add better timing/polling mechanism
2. **Add missing core tests**
   - Mirror mode toggle
   - Camera device switching
   - Error states (no permission, no devices)

### Phase 2: Expand Coverage
3. **Smart Zoom & Hand Tracking**
   - Need video file-based mock (not just canvas)
   - Create fixtures with known hand positions
   - Test: hand detection, zoom follows movement, skeleton overlay
   - Test: pan boundary clamping (edge indicators)
4. **Mobile Testing**
   - Add mobile viewport configurations
   - Test touch interactions
   - Test filmstrip on mobile
   - Test safe area insets
5. **Bug Reporter & Shake Detection**
   - Test keyboard shortcut (Cmd/Ctrl+I)
   - Test shake detection permission flow
   - Test first-time modal

### Phase 3: Advanced Testing
6. **Visual Regression**
   - Screenshot comparison for critical UI states
   - Flash overlay appearance
   - Settings modal layout
   - Replay mode UI
7. **Performance & Stress**
   - Long recording sessions (30 chunks)
   - Memory usage during replay
   - Large buffer exports
   - Rapid zoom/pan operations
8. **Multi-browser**
   - Add Firefox and WebKit to playwright.config.ts
   - Test cross-browser compatibility

## Project-Specific Helpers

### Existing
```
tests/helpers/
├── seedRewindBuffer.ts       # Seeds IndexedDB with test video chunks
```

### To Create
```
tests/helpers/
├── mockVideoCamera.ts        # Video file-based mock for hand tracking
├── mockCanvas.ts             # Extract canvas mock from spec (refactor)
├── waitForCondition.ts       # Polling helper for flash detection
└── mobileViewport.ts         # Mobile testing utilities
```

### Fixtures
```
tests/fixtures/
├── test-chunk.webm           # ✅ Exists - test video chunk
├── test-preview.jpg          # ✅ Exists - thumbnail image
├── hand-tracking-test.webm   # NEW - pre-recorded hand movements
├── two-hands-test.webm       # NEW - multiple hands
└── edge-cases.webm           # NEW - edge of frame movements
```

## Project Commands

```bash
# Run all E2E tests (desktop + mobile)
just e2e

# Run desktop tests only
just e2e-desktop

# Run mobile tests only
just e2e-mobile

# View test report (Tailscale accessible)
just e2e-report

# Interactive UI mode
just e2e-ui

# Run specific test file
npx playwright test tests/magic-monitor.spec.ts

# Run single test by name
npx playwright test -g "Flash Detection"
```

## Configuration Files

- `playwright.config.ts` - Main Playwright configuration
- `tests/magic-monitor.spec.ts` - Current E2E test suite
- `tests/helpers/seedRewindBuffer.ts` - IndexedDB seeding utility

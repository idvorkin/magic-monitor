# Test Architecture

This document describes the testing strategy, patterns, and conventions used in Magic Monitor.

## Overview

Two-tier testing approach:

| Tier | Tool | Location | Purpose |
|------|------|----------|---------|
| Unit | Vitest | `src/**/*.test.ts` | Functions, hooks, services |
| E2E | Playwright | `tests/*.spec.ts` | User workflows, integration |

## Unit Testing (Vitest)

### Configuration

```typescript
// vite.config.ts
test: {
    environment: "jsdom",
    globals: true,
    exclude: ["tests/**", "node_modules/**"],
}
```

### Commands

```bash
just test        # Run unit tests
npm run test     # Same as above
```

### File Organization

```
src/
├── hooks/
│   ├── useSmartZoom.ts
│   └── useSmartZoom.test.ts     # Co-located test
├── services/
│   ├── SessionStorageService.ts
│   └── SessionStorageService.test.ts
│   ├── HandLandmarkerService.ts
│   └── HandLandmarkerService.test.ts
├── components/
│   ├── Timeline.tsx
│   └── Timeline.test.tsx
├── machines/
│   ├── SessionRecorderMachine.ts
│   └── SessionRecorderMachine.test.ts
├── smoothing/
│   ├── ema.ts
│   ├── kalman.ts
│   └── smoothing.test.ts        # Tests for entire module
└── utils/
    ├── bugReportFormatters.ts
    └── bugReportFormatters.test.ts
```

### Testing Patterns

#### 1. Pure Functions

Test pure functions directly. No mocking needed.

```typescript
// useFlashDetector.test.ts
describe("colorDistance", () => {
    it("should return 0 for identical colors", () => {
        const color = { r: 128, g: 64, b: 200 };
        expect(colorDistance(color, color)).toBe(0);
    });

    it("should calculate distance between black and white", () => {
        const black = { r: 0, g: 0, b: 0 };
        const white = { r: 255, g: 255, b: 255 };
        expect(colorDistance(black, white)).toBeCloseTo(MAX_COLOR_DISTANCE, 1);
    });
});
```

#### 2. Hook Testing

Use `renderHook` from @testing-library/react.

```typescript
import { act, renderHook } from "@testing-library/react";

describe("useSmartZoom", () => {
    it("should initialize with default zoom 1", async () => {
        const { result } = renderHook(() =>
            useSmartZoom({
                videoRef: { current: videoElement },
                enabled: true,
            }),
        );

        await act(async () => {
            await Promise.resolve();
        });

        expect(result.current.zoom).toBe(1);
    });
});
```

#### 3. Service Mocking (IndexedDB)

Use `fake-indexeddb/auto` for IndexedDB mocking.

```typescript
import "fake-indexeddb/auto";

describe("SessionStorageService", () => {
    beforeEach(async () => {
        await SessionStorageService.clear();
    });

    afterEach(() => {
        SessionStorageService.close();
    });

    it("should save a session and return an ID", async () => {
        const session = createTestSession();
        const blob = new Blob(["test"], { type: "video/webm" });
        const id = await SessionStorageService.saveSessionWithBlob(session, blob);

        expect(typeof id).toBe("string");
        expect(id.length).toBeGreaterThan(0);
    });
});
```

#### 4. Singleton Service Testing

Singleton services need reset between tests to avoid state leakage.

```typescript
// HandLandmarkerService.test.ts
import { HandLandmarkerService } from "./HandLandmarkerService";

// Track mock calls via closure (vi.mock hoisting workaround)
let mockCloseCalls = 0;

vi.mock("@mediapipe/tasks-vision", () => {
    return {
        FilesetResolver: {
            forVisionTasks: vi.fn().mockResolvedValue("mock-vision-source"),
        },
        HandLandmarker: {
            createFromOptions: vi.fn().mockImplementation(() => {
                return Promise.resolve({
                    detectForVideo: vi.fn().mockReturnValue({ landmarks: [] }),
                    close: vi.fn().mockImplementation(() => {
                        mockCloseCalls++;
                    }),
                });
            }),
        },
    };
});

describe("HandLandmarkerService", () => {
    beforeEach(() => {
        // Reset service first (might call close), then reset counters
        HandLandmarkerService._reset();
        mockCloseCalls = 0;
    });

    it("should load model and transition to ready", async () => {
        await HandLandmarkerService.load();
        expect(HandLandmarkerService.isReady()).toBe(true);
    });

    it("should return same model on subsequent calls", async () => {
        const model1 = await HandLandmarkerService.load();
        const model2 = await HandLandmarkerService.load();
        expect(model1).toBe(model2);
    });
});
```

#### 5. Timer Mocking

Use Vitest's fake timers for RAF-based code.

```typescript
beforeEach(() => {
    vi.useFakeTimers();

    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
        frameCallback = cb;
        return 1;
    });
});

afterEach(() => {
    vi.useRealTimers();
});

const advanceFrame = (timeDelta: number = 16) => {
    if (frameCallback) {
        act(() => {
            frameCallback(performance.now());
        });
    }
};
```

#### 6. State Machine Testing

Test XState machines by sending events and checking state.

```typescript
describe("SessionRecorderMachine", () => {
    it("should transition from idle to recording on START", () => {
        const actor = createActor(sessionRecorderMachine);
        actor.start();

        actor.send({ type: "START" });

        expect(actor.getSnapshot().value).toBe("recording");
    });
});
```

### Test Categories

| Category | What to Test | Example |
|----------|--------------|---------|
| Pure functions | Input/output correctness | `colorDistance()`, `emaStep()` |
| Hooks | State changes, side effects | `useSmartZoom`, `useCamera` |
| Services | CRUD operations, error handling | `SessionStorageService` |
| Singletons | Loading, caching, reset | `HandLandmarkerService` |
| Machines | State transitions, guards | `SessionRecorderMachine` |
| Algorithms | Convergence, edge cases | Kalman filter, EMA smoothing |

### Conventions

1. **Co-locate tests** - `foo.ts` → `foo.test.ts` in same directory
2. **Test helpers** - Extract common setup to helper functions
3. **Clean state** - Use `beforeEach`/`afterEach` to reset state
4. **Descriptive names** - `should [expected behavior] when [condition]`
5. **Test pure functions first** - Export pure functions from hooks for testability
6. **Reset singletons** - Call `_reset()` in beforeEach for singleton services

## E2E Testing (Playwright)

### Quick Reference

```bash
just e2e          # Run all E2E tests
just e2e-desktop  # Desktop only
just e2e-mobile   # Mobile only
just e2e-report   # View HTML report
just e2e-ui       # Interactive UI mode
```

### File Organization

```
tests/
├── helpers/
│   ├── seedRewindBuffer.ts    # IndexedDB seeding utility (legacy)
│   └── seedSessionBuffer.ts   # Session IndexedDB seeding
├── fixtures/
│   ├── test-chunk.webm        # Test video chunk
│   └── test-preview.jpg       # Thumbnail image
├── magic-monitor.spec.ts      # Main E2E test suite
├── dropdown-bug.spec.ts       # Dropdown interaction tests
└── session-recorder.spec.ts   # Session recording tests
```

### E2E Testing Patterns

#### Mock Camera

Canvas-based mock camera for deterministic testing:

```typescript
async function injectMockCamera(page: Page) {
    await page.addInitScript(() => {
        const canvas = document.createElement("canvas");
        canvas.width = 640;
        canvas.height = 480;
        const ctx = canvas.getContext("2d")!;
        ctx.fillStyle = "blue";
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        navigator.mediaDevices.getUserMedia = async () => {
            return canvas.captureStream(30);
        };
    });
}
```

#### IndexedDB Seeding

Pre-populate IndexedDB for replay tests:

```typescript
// tests/helpers/seedRewindBuffer.ts
export async function seedSessions(page: Page, sessions: SessionData[]) {
    await page.evaluate(async (data) => {
        const db = await openDB("sessions", 1);
        for (const session of data) {
            await db.put("sessions", session);
        }
    }, sessions);
}
```

#### Waiting for State

```typescript
async function waitForSessionsLoaded(page: Page, expectedCount: number) {
    await page.waitForFunction(
        (count) => {
            const db = indexedDB.open("sessions");
            // ... check session count
            return actualCount >= count;
        },
        expectedCount,
        { timeout: 10000 }
    );
}
```

## Testing Pyramid

```
         /\
        /  \
       / E2E \      ← Few, slow, high confidence
      /------\
     /  Hook  \     ← Moderate, medium speed
    /----------\
   / Pure Funcs \   ← Many, fast, focused
  /--------------\
```

### Distribution Guidelines

| Layer | Coverage Target | Speed | Mocking |
|-------|----------------|-------|---------|
| Pure functions | 90%+ | <1ms/test | None |
| Hooks | 70%+ | ~10ms/test | External APIs |
| Services | 80%+ | ~5ms/test | Browser APIs |
| E2E | Critical paths | ~5s/test | Camera only |

## What to Test

### Must Test

- Pure calculation functions (zoom, pan, color distance)
- State transitions in hooks
- Service CRUD operations
- Singleton loading and caching behavior
- State machine transitions
- Error handling and edge cases
- Critical user workflows (camera → zoom → replay)

### Skip Testing

- Third-party library internals (MediaPipe, React)
- Simple pass-through functions
- CSS styling (visual regression in E2E instead)
- TypeScript type correctness (compiler handles this)

## Test Quality Checklist

- [ ] Tests are independent (no shared state between tests)
- [ ] Tests clean up after themselves (beforeEach/afterEach)
- [ ] Tests have descriptive names explaining expected behavior
- [ ] Tests use appropriate assertions (`toBe`, `toBeCloseTo`, `toMatchObject`)
- [ ] Tests cover happy path AND edge cases
- [ ] Tests run fast (<100ms for unit, <30s for E2E suite)
- [ ] Tests don't flake (deterministic, no race conditions)
- [ ] Singletons are reset between tests

## Adding New Tests

### For a new hook

1. Export pure calculation functions separately
2. Write unit tests for pure functions first
3. Write hook tests using `renderHook`
4. Mock external dependencies (services, APIs)
5. Test state transitions, not implementation details

### For a new service

1. Create test file alongside service
2. Mock browser APIs (IndexedDB, localStorage, etc.)
3. Test all CRUD operations
4. Test error conditions
5. Ensure proper cleanup in `afterEach`

### For a singleton service

1. Add `_reset()` method for test cleanup
2. Reset in `beforeEach` before resetting any counters
3. Test loading, caching, and error states
4. Verify only one instance is created

### For a new user workflow

1. Add E2E test in `tests/` directory
2. Use existing helpers (mock camera, seeding)
3. Create new helpers if needed
4. Verify with `just e2e --headed` for debugging

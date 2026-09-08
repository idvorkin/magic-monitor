# Architecture

Magic Monitor is a React 19 + TypeScript + Vite PWA that turns webcams into magic practice mirrors with AI-powered hand tracking, instant replay, and smart zoom.

## Tech Stack

- **React 19** - UI framework
- **TypeScript** - Strict mode enabled
- **Vite** - Build tool with PWA plugin
- **Tailwind CSS** - Styling
- **MediaPipe** - Hand tracking ML model
- **IndexedDB** - Persistent video buffer storage
- **Vitest** - Unit testing
- **Playwright** - E2E testing

## Directory Structure

```
src/
├── components/          # React components
│   ├── CameraStage.tsx  # Main orchestrator (smart component)
│   ├── ReplayView.tsx   # Replay mode orchestrator
│   ├── StatusButton.tsx # Reusable button primitive
│   ├── ToggleSwitch.tsx # Reusable toggle primitive
│   ├── Timeline.tsx     # Scrubber with thumbnails
│   ├── ReplayControls.tsx
│   ├── SessionPicker.tsx
│   ├── SettingsModal.tsx
│   ├── AboutModal.tsx
│   ├── BugReportModal.tsx
│   ├── HandSkeleton.tsx # Debug overlay
│   ├── Minimap.tsx
│   ├── Thumbnail.tsx
│   ├── ThumbnailGrid.tsx
│   ├── SessionThumbnail.tsx
│   ├── SmartZoomToggle.tsx
│   ├── EdgeIndicator.tsx
│   ├── PreviewSizeSlider.tsx
│   ├── ErrorOverlay.tsx
│   ├── LoadingOverlay.tsx
│   ├── CrashFallback.tsx
│   └── VersionNotification.tsx
├── hooks/               # Custom React hooks (business logic)
│   ├── useCamera.ts
│   ├── useSmartZoom.ts
│   ├── useSessionRecorder.ts
│   ├── useReplayPlayer.ts
│   ├── useSessionList.ts
│   ├── useBlockRecorder.ts
│   ├── useBlockRotation.ts
│   ├── useFlashDetector.ts
│   ├── useBugReporter.ts
│   ├── useSettings.ts
│   ├── useZoomPan.ts
│   ├── useThumbnailCapture.ts
│   ├── useShakeDetector.ts
│   ├── useMobileDetection.ts
│   ├── useVersionCheck.ts
│   ├── useEscapeKey.ts
│   └── useFocusTrap.ts
├── services/            # Humble Objects (browser API wrappers)
│   ├── CameraService.ts
│   ├── CameraSettingsService.ts
│   ├── DeviceService.ts
│   ├── HandLandmarkerService.ts  # Singleton for MediaPipe model
│   ├── SessionStorageService.ts  # IndexedDB for video sessions
│   ├── MediaRecorderService.ts
│   ├── ThumbnailCaptureService.ts
│   ├── ShareService.ts
│   ├── TimerService.ts
│   └── VideoFixService.ts
├── machines/            # State machines
│   └── SessionRecorderMachine.ts
├── smoothing/           # Smoothing algorithms
│   ├── ema.ts
│   ├── kalman.ts
│   ├── types.ts
│   └── index.ts
├── constants/           # Shared constants
│   └── zoom.ts
├── types/               # TypeScript type definitions
│   ├── bugReport.ts
│   └── sessions.ts
├── utils/               # Pure utility functions
│   ├── bugReportFormatters.ts
│   ├── formatters.ts
│   ├── shakeDetection.ts
│   └── thumbnailSelection.ts
└── App.tsx
```

## Core Architectural Patterns

### 1. Humble Object Pattern

All browser API interactions are isolated into service classes. This makes the codebase highly testable by allowing complete mocking of external dependencies.

| Service | Wraps | Purpose |
|---------|-------|---------|
| CameraService | `navigator.mediaDevices` | Camera enumeration, stream management |
| DeviceService | `window`, `navigator`, `localStorage` | Screen dims, storage, clipboard, downloads |
| HandLandmarkerService | MediaPipe | Singleton model loader, shared across components |
| SessionStorageService | IndexedDB | Video session CRUD, export, pruning |
| MediaRecorderService | `MediaRecorder`, canvas | Recording streams, extracting previews |
| ThumbnailCaptureService | Canvas | Frame extraction for thumbnails |
| ShareService | Web Share API | Native sharing on mobile |
| VideoFixService | WebM duration fixing | Repair WebM metadata |

### 2. Hooks as Business Logic Containers

Business logic lives in custom hooks, not components. Each hook owns a specific domain:

| Hook | Responsibility |
|------|---------------|
| useCamera | Device enumeration, stream lifecycle, permission handling |
| useSmartZoom | Zoom/pan calculation, smoothing (consumes landmarks from `useHandLandmarks`) |
| useSessionRecorder | Recording sessions with blocks and rotation |
| useReplayPlayer | Playback controls, seeking, speed |
| useSessionList | List/delete sessions from IndexedDB |
| useBlockRecorder | Individual block recording within sessions |
| useBlockRotation | Auto-rotate through recording blocks |
| useFlashDetector | Real-time color detection from video frames |
| useBugReporter | Bug report formatting, GitHub issue URL building |
| useSettings | Persistent settings via localStorage |
| useZoomPan | Manual zoom/pan with mouse/touch |
| useThumbnailCapture | Extract thumbnails from video |
| useShakeDetector | Device shake detection for triggers |
| useMobileDetection | Detect mobile vs desktop |
| useVersionCheck | Service Worker registration, PWA updates |

### 3. Singleton Services

Some services maintain global state and should only be instantiated once:

**HandLandmarkerService** - The MediaPipe model takes 3-5 seconds to load. This singleton ensures:
- Model loads once on first use
- Shared across CameraStage (live) and ReplayView (replay)
- No re-download when switching views

### 4. Smart vs Dumb Components

**Smart Components** (orchestrators):
- `CameraStage` - Live camera view, coordinates all live-mode hooks
- `ReplayView` - Replay mode, coordinates playback hooks

**Dumb Components** (presentational):
- Everything else - receive props, render UI, emit events

## Data Flow

```
Camera Hardware
    ↓ (navigator.mediaDevices)
CameraService
    ↓ (MediaStream)
useCamera
    ↓ (stream)
CameraStage ──────────────────────────────────────┐
    │                                              │
    ├─→ <video> element (live feed)               │
    │                                              │
    ├─→ useSmartZoom                              │
    │   ├─→ HandLandmarkerService (singleton)     │
    │   ├─→ Bounding box calculation              │
    │   ├─→ Hysteresis (jitter prevention)        │
    │   └─→ Smoothing (EMA/Kalman)                │
    │                                              │
    ├─→ useSessionRecorder                        │
    │   ├─→ MediaRecorderService (WebM chunks)    │
    │   └─→ SessionStorageService (IndexedDB)     │
    │                                              │
    ├─→ useFlashDetector                          │
    │   └─→ Canvas pixel sampling                 │
    │                                              │
    └─→ Settings UI                               │
        └─→ DeviceService (localStorage) ─────────┘
```

## State Management

**Decentralized state with DeviceService as persistence layer.**

No Redux/Zustand/Context. Instead:

1. **Component State** - `useState` for local UI state
2. **Hook State** - Hooks manage their domain state internally
3. **Persistent State** - Via `DeviceService.getStorageItem()`/`setStorageItem()`
4. **State Machines** - XState for complex flows (SessionRecorderMachine)

This works because:
- No global state mutation complexity
- Each hook owns its domain
- localStorage persistence is explicit and traceable
- Easy to test by mocking DeviceService

## Key Features

### Smart Zoom

Multi-stage processing pipeline:

1. **Detection** - MediaPipe HandLandmarker detects hand landmarks
2. **Bounding Box** - Calculate min/max coordinates across all hand points
3. **Target Calculation** - Zoom and pan from normalized hand position
4. **Hysteresis** - Only update if delta exceeds threshold (prevents jitter)
5. **Smoothing** - Three algorithms available:
   - **EMA** - Exponential Moving Average (simple, default)
   - **Kalman Fast** - Velocity-aware, responsive
   - **Kalman Smooth** - Velocity-aware, very stable
6. **Speed Clamping** - Limit max movement per frame
7. **Pan Clamping** - Restrict pan to valid viewport bounds

See `/docs/SMART_ZOOM_SPEC.md` for details.

### Session Recording

Block-based recording for practice sessions:

- **Sessions** contain multiple **Blocks** (individual takes)
- **Auto-rotation** cycles through blocks automatically
- **IndexedDB storage** - Persists across page reloads
- **WebM codec selection** - VP9 if available, fallback to VP8
- **Thumbnail extraction** - For session picker and timeline

### Flash Detection

Real-time pixel analysis:

- Downsample video to 320x180 for performance
- Sample every 4th pixel
- Calculate RGB Euclidean distance from target color
- Trigger if >0.5% of sampled pixels match
- Visual feedback with red border

## Smoothing Algorithms

Three pluggable options with common interface:

```typescript
interface Smoother {
    update(measurement: Measurement): SmoothedPosition;
    getPosition(): SmoothedPosition;
    reset(): void;
}
```

| Algorithm | Characteristics |
|-----------|----------------|
| EMA | `current += (target - current) * smoothFactor`. Lightweight, good balance. |
| Kalman Fast | 6D state (position + velocity). Process noise favors fast response. |
| Kalman Smooth | 6D state. Process noise favors stability, slower response. |

Factory: `createSmoother(preset)` returns appropriate instance.

## Testing Strategy

**Multi-level approach:**

1. **Unit Tests** (Vitest) - Pure functions, service mocking, hook rendering
2. **E2E Tests** (Playwright) - User workflows, modal interactions, persistence
3. **Component Tests** - Limited, mostly integration-style for hooks

**Testability by design:**
- Humble Objects allow complete service mocking
- Hooks accept services via dependency injection
- Pure functions for all calculations

## Build & Deployment

```bash
just dev      # Development server (localhost:5173)
just build    # Production build (tsc -b && vite build)
just test     # Unit tests
just e2e      # E2E tests
just deploy   # Test → Build → Deploy to surge.sh
```

**PWA Configuration:**
- Workbox caching via vite-plugin-pwa
- 15MB max file size cache (for MediaPipe WASM models)
- Service worker auto-update strategy

## Design Decisions

### Why no global state management?

The app has orchestrator components (CameraStage, ReplayView) that coordinate hooks. Prop drilling is minimal, and each hook encapsulates its own state. Adding Redux/Zustand would add complexity without benefit.

### Why Humble Objects everywhere?

Browser APIs are notoriously hard to test. By wrapping them in thin service classes, we can:
- Mock entire service layer in tests
- Centralize error handling
- Add logging/analytics in one place
- Swap implementations (e.g., mock camera for demos)

### Why singleton for HandLandmarker?

The MediaPipe model takes 3-5 seconds to download and initialize. Without a singleton, switching between live and replay views would re-trigger this delay. The singleton ensures one load, shared everywhere.

### Why IndexedDB for session storage?

- Survives page reloads (unlike in-memory)
- Works on mobile (RAM constraints)
- Off main thread (non-blocking)
- Larger storage quota than localStorage

## Browser API Integrations

| API | Used For |
|-----|----------|
| MediaDevices | Camera access, device enumeration |
| MediaRecorder | Video chunk recording |
| IndexedDB | Persistent video storage |
| Service Worker | PWA offline support |
| DeviceMotion | Shake detection |
| Clipboard | Bug report copy |
| Canvas | Frame extraction, downsampling |
| Web Share | Native mobile sharing |

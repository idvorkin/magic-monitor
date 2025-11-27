# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Development Commands

```bash
just dev      # Run development server (npm run dev) - opens http://localhost:5173
just build    # Build for production (tsc -b && vite build)
just test     # Run unit tests (vitest run)
just e2e      # Run E2E tests (Playwright)
just deploy   # Run tests, build, then deploy to magic-monitor.surge.sh
```

Individual npm scripts:

- `npm run lint` - ESLint
- `npm run test` - Vitest unit tests (excludes tests/ directory which is Playwright)

## Code Quality

- **Biome** for formatting (tabs, double quotes) and linting - runs via pre-commit hook
- **ESLint** for React-specific rules
- **Vitest** for unit tests (jsdom environment, globals enabled)
- **Playwright** for E2E tests (in `tests/` directory)

Pre-commit runs Biome checks and unit tests automatically.

## Architecture

React 19 + TypeScript + Vite + Tailwind CSS application for real-time camera mirroring with special features.

### Core Components

**CameraStage** (`src/components/CameraStage.tsx`) - Main orchestrator component that:

- Manages zoom/pan state with mouse wheel and drag
- Coordinates all hooks (camera, smart zoom, time machine, flash detector)
- Renders video element for live feed and canvas for replay

### Custom Hooks (src/hooks/)

**useCamera** - Camera device management using CameraService

- Handles device enumeration, selection, and stream lifecycle
- Listens for device changes

**useTimeMachine** - Instant replay buffer

- Captures frames to ImageBitmap buffer at configurable FPS/quality
- Provides play/pause/seek controls and thumbnail extraction
- Memory-efficient pruning of old frames

**useSmartZoom** - AI-powered auto-zoom using MediaPipe HandLandmarker

- Tracks hands in video and calculates bounding box
- Applies hysteresis/deadband to prevent jitter
- Smooth interpolation (lerp) for stable transitions

**useFlashDetector** - Detects target color flashes in video frames

### Services (src/services/)

**CameraService** - Humble Object pattern for browser camera APIs

- `getVideoDevices()`, `start(deviceId)`, `stop(stream)`
- Isolates navigator.mediaDevices calls for testability

## Development Conventions

### Clean Code Principles

- Keep code DRY (Don't Repeat Yourself)
- Avoid nesting scopes, minimize telescoping
- Return early from functions when possible
- Use `const` whenever possible
- Use TypeScript types
- Use Humble Objects (services) when interacting with external systems for testability
- When finding bugs, add failing tests first, then fix

### Clean Commits

- Run `git status` before committing to review staged files
- Keep distinct changes in distinct commits
- Avoid mixing linting/formatting changes with feature changes
- Run pre-commit hooks before committing
- Never use `git add -A` without reviewing `git status` first

### Writing Code

- Make the smallest reasonable changes to achieve the desired outcome
- Prefer simple, clean, maintainable solutions over clever ones
- Work to reduce code duplication
- Match the style and formatting of surrounding code
- Fix broken things immediately when found

### Testing

- Follow TDD: write failing test → make it pass → refactor
- Tests must comprehensively cover functionality
- Never delete a failing test - fix the code or discuss
- Test output must be clean - capture and validate expected errors

### Debugging

1. Read error messages carefully
2. Reproduce consistently before investigating
3. Check recent changes (git diff)
4. Find working examples to compare against
5. Form a single hypothesis and test minimally
6. Never add multiple fixes at once

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Address your human partner as "Igor" at all times.

## Relationship Rules

- We're colleagues working together - no formal hierarchy
- Speak up immediately when you don't know something
- Call out bad ideas, unreasonable expectations, and mistakes - Igor depends on this
- Never be agreeable just to be nice - give honest technical judgment
- Never write "You're absolutely right!" - we're working together because Igor values your opinion
- Stop and ask for clarification rather than making assumptions
- When you disagree with an approach, push back with specific technical reasons (or gut feeling)
- Discuss architectural decisions together before implementation; routine fixes don't need discussion

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

**DeviceService** - Humble Object pattern for browser/device APIs

- Screen dimensions, device memory, touch detection
- localStorage access (`getStorageItem`, `setStorageItem`)
- Isolates window/navigator/localStorage calls for testability

### Reusable UI Components (src/components/)

**ToggleSwitch** - Consistent toggle switch for settings

- Props: `checked`, `onChange`, `disabled`, `color`, `size`
- Use instead of inline toggle button markup

**StatusButton** - Status indicator buttons for control bars

- Props: `children`, `onClick`, `active`, `disabled`, `color`, `title`, `warning`
- Use instead of inline conditional button styling

### CSS Conventions

- Use `clsx` for conditional class composition instead of template literals
- Extract repeated UI patterns into reusable components
- When you see 3+ similar inline class patterns, create a component

```tsx
// Avoid: complex template literals
className={`px-3 py-1.5 ${isActive ? "bg-green-600" : "bg-gray-700"} ${isDisabled ? "opacity-50" : ""}`}

// Prefer: clsx for conditionals
className={clsx("px-3 py-1.5", isActive ? "bg-green-600" : "bg-gray-700", isDisabled && "opacity-50")}

// Best: extract to component when pattern repeats
<StatusButton active={isActive} disabled={isDisabled} color="green">Label</StatusButton>
```

## Development Conventions

### Clean Code Principles

- Keep code DRY (Don't Repeat Yourself)
- Avoid nesting scopes, minimize telescoping
- Return early from functions when possible
- Use `const` whenever possible
- Use TypeScript types
- Use Humble Objects (services) when interacting with external systems for testability (browser APIs, localStorage, network, etc.)
- When finding bugs, add failing tests first, then fix

### Clean Commits

- **Never push directly to main** - always create a branch and open a PR
- **Never skip pre-commit hooks** - fix lint/format issues, don't bypass with `--no-verify`
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

### Naming Conventions

Names must tell what code does, not how it's implemented or its history.

**Never use in names:**

- Implementation details: `ZodValidator`, `MCPWrapper`, `JSONParser`
- Temporal/historical context: `NewAPI`, `LegacyHandler`, `ImprovedInterface`
- Pattern names (unless they add clarity): prefer `Tool` over `ToolFactory`

**Good names tell a story about the domain:**

- `Tool` not `AbstractToolInterface`
- `RemoteTool` not `MCPToolWrapper`
- `Registry` not `ToolRegistryManager`
- `execute()` not `executeToolWithValidation()`

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

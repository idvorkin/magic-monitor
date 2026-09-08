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

## Requires Explicit "YES" From User

- Pushing to **upstream** (idvorkin repo) - always needs PR + human approval
- Force pushing (`--force`, `-f`)
- Removing/deleting tests
- Any action that loses work (hard resets, deleting unmerged branches)

## Git Workflow

| Remote     | Repo                     | Who Can Merge             |
| ---------- | ------------------------ | ------------------------- |
| `origin`   | idvorkin-ai-tools (fork) | Agents directly           |
| `upstream` | idvorkin                 | Humans only (PR required) |

## Build & Development Commands

Use **Tailscale URLs** (e.g., `https://squeaker-teeth.ts.net:5173`), not localhost.

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

- Calculates bounding box from hand landmarks detected by `useHandLandmarks`
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

### rAF Pattern (requestAnimationFrame for High-Frequency Updates)

Use the **rAF ref-reading pattern** when data changes at 30-60fps but React re-renders would be too expensive. The producer writes to a `useRef`, the consumer reads it in a `requestAnimationFrame` loop — React never knows the value changed.

**When to use:**
- Visualizing data that changes every frame (landmarks, timing stats, waveforms)
- Overlays that track video/canvas coordinates
- Anything driven by `requestAnimationFrame` in a hook that would cause render storms via `useState`

**When NOT to use:**
- Data that changes < 10 times/sec — just use `useState`
- Data that other React components need to react to (conditional rendering, props)

**Pattern:**
```tsx
// Producer hook (e.g. useHandLandmarks)
const valueRef = useRef(0);
// In rAF loop:
valueRef.current = newValue;
// Expose ref, not state:
return { valueRef };

// Consumer component (e.g. DetectPerfOverlay, HandSkeleton)
function Overlay({ valueRef }: { valueRef: React.RefObject<number> }) {
  const domRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    let rafId: number;
    const update = () => {
      if (domRef.current) {
        domRef.current.textContent = `Value: ${valueRef.current}`;
      }
      rafId = requestAnimationFrame(update);
    };
    update();
    return () => cancelAnimationFrame(rafId);
  }, [valueRef]);

  return <span ref={domRef} />;
}
```

**Examples in codebase:**
- `HandSkeleton` reads `debugLandmarksRef` from useSmartZoom, draws to canvas at 60fps
- `DetectPerfOverlay` reads `detectTimeMsRef` from useSmartZoom, updates DOM text
- `useSmartZoom` throttles `useState` updates to ~10Hz but keeps refs at full frame rate

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

### Hook Dependency Anti-Pattern

**NEVER put hook return objects directly in dependency arrays.**

Hooks that return objects with mixed state + callbacks are dangerous:
```tsx
// ❌ BAD: Object identity changes on every state update
const recorder = useBlockRecorder(config);
useEffect(() => {
  // This re-runs whenever recorder.isRecording changes!
}, [recorder]);

// ✅ GOOD: Destructure stable callbacks
const recorder = useBlockRecorder(config);
const { startRecording, stopRecording, isRecording } = recorder;
useEffect(() => {
  // Callbacks have stable identity via useCallback
}, [startRecording, stopRecording]);
```

Why: Even though callbacks use `useCallback`, the containing object is recreated each render. When state inside the hook changes, the object reference changes, causing effects with that object in their deps to re-run → potential infinite loops.

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

- **Tests > Code** - Users should never find bugs tests could have caught
- Follow TDD: write failing test → make it pass → refactor
- Tests must comprehensively cover functionality
- Never delete a failing test - fix the code or discuss
- Test output must be clean - capture and validate expected errors

### Bug Investigation Protocol

Before fixing ANY bug:

1. **Spec**: Is this actually a bug? Ask if unclear.
2. **Test**: Add missing test BEFORE fixing.
3. **Arch**: Deeper problem? Discuss before patching.

### Debugging

1. Read error messages carefully
2. Reproduce consistently before investigating
3. Check recent changes (git diff)
4. Find working examples to compare against
5. Form a single hypothesis and test minimally
6. Never add multiple fixes at once

### Before Implementing

1. **Spec first** - Understand what success looks like
2. **Confirm understanding** - Ask if unsure
3. **Read existing code** - Understand context before changing

## Retros

Run weekly (or when user says "retro"). See [chop-conventions retros guide](https://github.com/idvorkin/chop-conventions/blob/main/dev-inner-loop/retros.md).

**Storage:** `retros/` directory at project root
- `_retro_state.json` - tracks last execution date
- `YYYY-MM-DD.md` - individual retro reports

**Process:**
1. Use subagents to analyze `~/.claude/history.jsonl` (avoid context overflow)
2. Look for friction moments - where user corrected the agent
3. Map patterns to CLAUDE.md improvements
4. Scan for secrets before committing

## CLI Tips

- Git output truncated: `git --no-pager diff`
- head/cat errors: `unset PAGER`
- Check justfile before writing new commands
- Open files for user in tmux split: `tmux split-window -h -l 66% "nvim /path/to/file"`
- See [chop-conventions/running-commands.md](https://github.com/idvorkin/chop-conventions/blob/main/dev-inner-loop/running-commands.md) for more

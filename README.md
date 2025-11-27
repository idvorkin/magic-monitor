# Magic Monitor 🪄

A smart mirror application designed for real-time feedback, featuring instant replay, AI-powered smart zoom, and flash detection.

## Architecture

### Component Hierarchy

```mermaid
graph TD
    App[App]
    App --> CS[CameraStage]
    CS --> SM[SettingsModal]
    CS --> MM[Minimap]
    CS --> TH[Thumbnail]
    CS --> Video[video element]
    CS --> Canvas[canvas element]
```

### Data Flow

```mermaid
flowchart LR
    subgraph Browser APIs
        CAM[Camera]
        MP[MediaPipe]
    end

    subgraph Hooks
        UC[useCamera]
        UTM[useTimeMachine]
        USZ[useSmartZoom]
        UFD[useFlashDetector]
    end

    subgraph Services
        SVC[CameraService]
    end

    CAM --> SVC --> UC
    UC -->|stream| Video[Video Element]
    Video --> UTM -->|frames| Buffer[(ImageBitmap Buffer)]
    Video --> USZ
    MP --> USZ -->|zoom/pan| Transform
    Video --> UFD -->|isFlashing| Alert
    Buffer -->|replay| Canvas[Canvas Element]
```

### Hook Responsibilities

```mermaid
graph TB
    subgraph useCamera
        A1[Device enumeration]
        A2[Stream lifecycle]
        A3[Device switching]
    end

    subgraph useTimeMachine
        B1[Frame capture at FPS]
        B2[Buffer management]
        B3[Playback controls]
        B4[Thumbnail extraction]
    end

    subgraph useSmartZoom
        C1[MediaPipe HandLandmarker]
        C2[Bounding box calculation]
        C3[Hysteresis/deadband]
        C4[Smooth interpolation]
    end
    click C1 "docs/SMART_ZOOM_SPEC.md" "Smart Zoom Specification"

    subgraph useFlashDetector
        D1[Color sampling]
        D2[Threshold comparison]
    end
```

## Features

- **Instant Replay**: Rewind and scrub through the last 60 seconds of video.
- **Smart Zoom**: AI-powered hand tracking automatically zooms and pans to keep you in frame.
- **Minimap**: Always-on context view showing your full field of view when zoomed in.
- **Flash Detection**: Visual alert when the screen flashes (e.g., for testing light sensors).
- **High Quality Mode**: Toggle between performance (LQ) and high-fidelity (HQ) replay buffers.

## Deployment

The application is deployed to Surge.sh.

**Live URL**: [https://magic-monitor.surge.sh](https://magic-monitor.surge.sh)

### How to Deploy

To deploy the latest version:

```bash
just deploy
```

This command builds the project and pushes it to Surge.

## Local Development

1.  Install dependencies:

    ```bash
    npm install
    ```

2.  Start the development server:

    ```bash
    npm run dev
    ```

3.  Open [http://localhost:5173](http://localhost:5173) in your browser.

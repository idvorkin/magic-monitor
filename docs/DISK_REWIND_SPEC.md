# Disk-Based Rewind Feature Specification

## Problem

Current rewind stores raw frames in memory: ~1GB RAM for 60 seconds, crashes mobile devices, requires downscaling to 35-50% resolution.

## Solution

Record compressed video chunks to IndexedDB instead of raw frames in memory.

## Benefits

| | Memory Mode | Disk Mode |
|--|-------------|-----------|
| RAM | ~1GB | ~15MB |
| Resolution | 35-50% downscaled | **Full resolution** |
| Mobile | Crashes | Works |

## Architecture

```
Video Stream → MediaRecorder (5s chunks) → IndexedDB
                     ↓
              First frame as JPEG preview (for scrubber)
                     ↓
              Playback via <video> element
```

## Implementation Plan

1. **DiskBufferService** - IndexedDB wrapper for chunk storage
   - `saveChunk(blob, preview, timestamp, duration)`
   - `getAllChunks()`, `getPreviewFrames()`
   - `pruneOldChunks(keepCount)` - circular buffer
   - `exportVideo()` - concatenate for download

2. **useDiskTimeMachine hook** - MediaRecorder + IndexedDB
   - Record 5-second WebM chunks
   - Extract first frame as JPEG preview for scrubber
   - Expose: `enterReplay`, `exitReplay`, `play`, `pause`, `seek`, `saveVideo`, `previews`

3. **CameraStage integration**
   - Add `useDiskRewind` toggle (default true)
   - Unified `timeMachine` interface switches between modes
   - `<video>` element for disk playback (vs canvas for memory)

4. **UI updates**
   - Save/download button in replay controls
   - Thumbnail component accepts `imageUrl` for disk previews
   - Status bar shows chunk count instead of RAM in disk mode

## Key Decisions

- **5 second chunks** - Balance between seek granularity and overhead
- **12 chunks max** - 60 seconds total buffer
- **First-frame previews** - One JPEG per chunk for scrubber thumbnails
- **WebM format** - Native MediaRecorder output, no transcoding needed

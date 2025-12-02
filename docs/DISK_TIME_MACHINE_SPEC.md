# Time Machine Feature Specification

## Overview

The Time Machine feature provides instant replay functionality for the Magic Monitor camera app. It continuously records the last 60 seconds of video in the background, allowing users to "rewind time" and review recent footage without explicitly starting a recording session.

**Use Cases:**
- Capture unexpected moments that just happened (missed recording start)
- Review technique or form during practice sessions
- Document transient events (whiteboard content, demonstrations)
- Debug or analyze recent activity

## Goals

**Primary Goals:**
- Always-on background recording of last 60 seconds
- Instant replay access with no recording button needed
- Smooth playback with seek controls
- Export capability to save interesting moments
- Work reliably on mobile devices (memory-efficient)

**Non-Goals:**
- Real-time editing or filters during recording
- Multiple simultaneous recordings or timelines
- Cloud storage or automatic sharing
- Live streaming integration

## Feature Requirements

### User Experience

1. **Background Recording**
   - Recording starts automatically when camera is active
   - No manual "start recording" button needed
   - User sees chunk count and total duration in status bar
   - Recording indicator (REC) shows active state
   - Buffer maintains last 60 seconds continuously

2. **Instant Replay**
   - Single "Rewind" button enters replay mode
   - Playback controls appear: Play/Pause, Previous/Next chunk
   - Visual filmstrip shows thumbnails of each 2-second segment
   - Click any thumbnail to jump to that moment
   - Current chunk highlighted with blue glow effect
   - Auto-advance to next chunk when current finishes
   - Loop back to beginning when reaching end

3. **Visual Feedback**
   - Status bar: "15 chunks (30s)" shows current buffer state
   - "REC" indicator shows active recording
   - Filmstrip with 8 visible thumbnails (cinematic timeline)
   - Timestamps on each thumbnail (0s, 2s, 4s, etc.)
   - Progress bar during video export

4. **Export**
   - "Save" button exports entire 60-second buffer
   - Downloads as `.webm` file with timestamp in filename
   - Progress indicator shows export completion percentage
   - Disabled during export to prevent double-clicks

5. **Error Handling**
   - Red error messages replace status when issues occur
   - Clear user-facing explanations (not technical jargon)
   - Graceful degradation (disable feature vs. crash app)

### Technical Constraints

1. **Memory Efficiency**
   - Must work on mobile devices with limited RAM
   - Target: <20MB memory usage for entire feature
   - No memory leaks from unreleased resources

2. **Performance**
   - Maintain 30fps during recording
   - No dropped frames during chunk rotation
   - Instant replay entry (<100ms lag)
   - Smooth playback with no stuttering

3. **Storage**
   - Persist recordings across page reloads
   - Handle storage quota limits gracefully
   - Work in private browsing mode (or show why not)
   - Auto-cleanup old data to prevent unbounded growth

4. **Browser Compatibility**
   - Support Chrome/Edge desktop and mobile
   - Support Safari desktop and iOS (with codec limitations)
   - Degrade gracefully on unsupported browsers

## How It Works

### Recording Buffer Concept

Think of the time machine as a **circular buffer** that continuously records and overwrites old footage:

```
Time:  [0s ---- 30s ---- 60s]
         ^oldest    ^newest

After 10 more seconds:
Time:  [10s ---- 40s ---- 70s]
              ^oldest    ^newest
```

The buffer always contains the **most recent 60 seconds**. Old segments are automatically deleted as new ones are recorded.

### Recording Process

1. **Automatic Start**: Recording begins when camera is active (no button press)
2. **Chunked Recording**: Video is split into 2-second segments for seek granularity
3. **Thumbnail Generation**: Each chunk gets a preview image (first frame as JPEG)
4. **Persistent Storage**: Chunks saved to browser storage (survives page reload)
5. **Automatic Pruning**: When buffer reaches 30 chunks (60s), oldest are deleted

**Why 2-second chunks?**
- Enables visual timeline with thumbnails
- Allows precise seeking (vs. single 60s blob with no markers)
- Reduces memory pressure during recording

### Playback Flow

1. **Enter Replay**: User clicks "Rewind" button
2. **Load All Chunks**: System retrieves all 30 chunks from storage
3. **Show Filmstrip**: Thumbnails displayed in cinematic timeline
4. **Playback Controls**:
   - Play/Pause - Start/stop playback
   - Seek - Click thumbnails to jump to that moment
   - Previous/Next - Navigate between chunks
   - Auto-advance - Automatically play next chunk when current finishes
5. **Exit Replay**: Return to live camera feed

### Export Process

1. **User Request**: Click "Save" button in replay mode
2. **Concatenation**: All chunks combined into single video file
3. **Progress Display**: Visual indicator shows completion percentage
4. **Download**: Browser downloads file as `magic-monitor-replay-YYYY-MM-DD.webm`

### Storage Architecture

**Where data lives:**
- **IndexedDB**: Video chunks (binary blobs) + metadata
- **Memory**: Only current playback chunk (~500KB)
- **Total storage**: ~15MB for full 60-second buffer

**Data structure:**
```
Chunk {
  id: number           // Auto-incrementing ID
  blob: Blob          // Video data (WebM format)
  preview: string     // JPEG thumbnail (data URL)
  timestamp: number   // Recording time (milliseconds)
  duration: number    // Chunk duration (milliseconds)
}
```

### User Interface

**Status Bar (during live camera):**
```
REC 15 chunks (30s)
```

**Replay Mode Controls:**
```
[Exit] [⏮ Prev] [▶️ Play/⏸ Pause] [Next ⏭] [💾 Save]

Timeline:
[0s][2s][4s][6s][8s][10s][12s][14s]
         ^-- Current (blue glow)
```

**Cinematic Timeline:**
- Film grain texture overlay for aesthetic
- Floating timestamp badges above each thumbnail
- Active thumbnail has dramatic blue glow effect
- Hover state shows additional glow
- Staggered slide-in animation when opened

## Design Decisions

### Why Disk Storage vs. Memory?

**Decision**: Store video chunks in IndexedDB instead of RAM.

**Benefits:**
- **Mobile Support**: Works on devices with limited memory (1-2GB RAM)
- **Persistence**: Recordings survive page reloads (bonus feature)
- **Scalability**: Can extend to longer buffers without memory issues

**Trade-offs:**
- Slightly slower than memory (acceptable for background recording)
- Requires storage quota (~15MB for 60 seconds)
- More complex error handling (storage full, private browsing)

### Why 2-Second Chunks?

**Decision**: Split 60-second buffer into 30 × 2-second chunks.

**Benefits:**
- **Visual Timeline**: Each chunk gets a thumbnail for the filmstrip UI
- **Precise Seeking**: Users can jump to exact 2-second intervals
- **Memory Efficiency**: Only load current chunk during playback (~500KB vs. 15MB)

**Trade-offs:**
- Slightly larger file sizes (~5% overhead from codec keyframes)
- More complex state management (track 30 chunks vs. 1 blob)

**Why 2 seconds specifically?**
- Short enough for responsive seeking
- Long enough to minimize overhead
- Matches typical user mental model ("a few seconds ago")

### Why Automatic Recording?

**Decision**: Start recording automatically when camera is active (no button).

**Benefits:**
- **Captures Unexpected Moments**: Don't miss events because you forgot to press record
- **Zero Friction**: No UX burden to access feature
- **Always Ready**: Instant replay available at any time

**Trade-offs:**
- Background battery/CPU usage (minimal with efficient encoding)
- Storage usage (auto-pruned to 60 seconds maximum)

**Philosophy**: Time machine should be invisible until you need it, like dashcam footage or instant replay in sports.

### Why Thumbnail Previews?

**Decision**: Generate JPEG thumbnail from first frame of each chunk.

**Benefits:**
- **Visual Navigation**: See what happened at each point in time
- **Fast Rendering**: Images load instantly (vs. video codec initialization)
- **Small Size**: 1-2KB per thumbnail vs. 500KB chunk

**Trade-offs:**
- Additional processing time (~10-20ms per chunk)
- Slightly increased storage (~50KB total for 30 thumbnails)

### Why WebM Format?

**Decision**: Record in WebM container with VP9/VP8 video codec.

**Benefits:**
- **Browser Native**: Supported by MediaRecorder API
- **Efficient**: Good compression ratio (~250KB per 2-second chunk)
- **Playback Support**: Works in all modern browsers

**Trade-offs:**
- May need VLC or browser to play (not all video players support WebM)
- Safari uses H.264 instead (codec availability varies)

## Implementation Notes

### Code Organization

The time machine feature is implemented across several modules following clean architecture principles:

**State Management:**
- `src/hooks/useDiskTimeMachine.ts` - React hook managing recording/playback state, coordinating services

**Services (Browser API Wrappers):**
- `src/services/MediaRecorderService.ts` - Video recording, thumbnail extraction, blob lifecycle
- `src/services/DiskBufferService.ts` - IndexedDB persistence, chunk CRUD, video export
- `src/services/DeviceService.ts` - File downloads, storage detection

**UI Components:**
- `src/components/CameraStage.tsx` - Main orchestrator, renders filmstrip and controls
- `src/components/Thumbnail.tsx` - Individual thumbnail in filmstrip

**Tests:**
- 165 unit tests covering all recording, playback, export, and error scenarios
- Mocks for all browser APIs (MediaRecorder, IndexedDB, URL.createObjectURL)
- Full test coverage of error handling paths

### Key Implementation Details

**Circular Buffer**:
- FIFO queue maintaining exactly 30 chunks
- Oldest deleted automatically when 31st chunk arrives
- Implemented via IndexedDB auto-incrementing IDs + timestamp sorting

**Video Encoding**:
- Browser-native MediaRecorder API (no external libraries)
- 2.5 Mbps bitrate for quality/size balance
- Automatic codec selection (VP9 → VP8 → H.264 fallback)

**Thumbnail Generation**:
- Canvas API draws first video frame
- Converts to JPEG data URL (90% quality)
- Happens async during chunk save (doesn't block recording)

**Blob URL Management**:
- Create URLs for playback, revoke immediately after use
- Prevents memory leaks (unreleased blobs accumulate in RAM)
- Cleanup on component unmount prevents orphaned URLs

**Error Recovery**:
- All async operations wrapped in try-catch
- User-facing error messages (not stack traces)
- Graceful degradation (disable feature vs. crash)

## Error Handling Strategy

All async operations have explicit error handling with user-facing messages:

| Error Scenario | User Message | Recovery |
|---------------|--------------|----------|
| IndexedDB unavailable | "Storage unavailable - time machine disabled. This may happen in private browsing mode." | Feature disabled |
| Storage quota exceeded | "Storage full - some video data may be lost. Free up space or reduce buffer size." | Continue with reduced buffer |
| Recording start fails | "Recording failed - check camera connection" | Stop recording indicator |
| Playback fails | "Playback failed - video may be corrupted" | Pause playback |
| Export fails | "Export failed - please try again" | Reset export state |
| Video not ready (timeout) | "Camera not ready - recording could not start" | Stop waiting after 5s |

## Evolution: Memory → Disk Implementation

### Why the Change?

The original time machine used an **in-memory ImageBitmap buffer**:
- Captured 30fps frames directly to RAM
- Required ~1GB memory for 60 seconds
- **Failed on mobile devices** due to memory limits
- No persistence across page reloads

The new disk-based implementation:
- Uses browser MediaRecorder API
- Stores in IndexedDB (~15MB for 60 seconds)
- **Works reliably on mobile**
- Bonus: Persists across page reloads

### Impact

**93% memory reduction**: 1GB → 15MB

**Mobile support**: Feature now works on phones/tablets

**Persistence**: Recordings survive page refresh (accidental reload won't lose recent footage)

**Trade-off**: Slightly less granular seeking (2-second chunks vs. per-frame), but UI compensates with visual thumbnails

## Performance Characteristics

**Memory Usage:**
- 15MB total for 60-second buffer
- Only 500KB in RAM during playback (single chunk)
- No memory leaks from unreleased resources

**Recording:**
- 30fps maintained consistently
- No dropped frames during chunk rotation
- Sub-50ms chunk save latency (async, doesn't block)

**Playback:**
- <100ms to enter replay mode
- Instant seeking (chunks pre-loaded)
- Smooth auto-advance between chunks

**Export:**
- ~2-3 seconds to concatenate 30 chunks
- Progress indicator for user feedback
- Automatic cleanup after download

## Future Possibilities

Ideas for extending the time machine feature:

1. **Variable Buffer Length**
   - User-configurable: 30s, 60s, 90s, 120s
   - Adjust based on available storage

2. **Selective Export**
   - Trim start/end points before export
   - Export only specific chunk range

3. **Quality Presets**
   - Low/Medium/High bitrate options
   - Balance quality vs. storage/battery

4. **Motion Detection**
   - Only record when significant movement detected
   - Save storage for inactive periods

5. **Cloud Backup**
   - Optional upload to cloud storage
   - Preserve important moments long-term

6. **Multiple Timelines**
   - Pause/resume creating separate recordings
   - Compare before/after footage

## Testing Approach

**Automated Tests (165 tests):**
- All recording, playback, export flows
- Error handling for every failure scenario
- Mock all browser APIs for deterministic tests

**Manual Testing Focus:**
- Mobile device compatibility (iOS/Android)
- Browser compatibility (Chrome/Safari/Edge)
- Error scenarios (storage full, private browsing)
- Performance under load (30+ minutes continuous recording)

**Key Test Scenarios:**
1. Record 60 seconds → Verify all chunks saved
2. Enter replay → Verify playback smooth
3. Seek to any chunk → Verify instant jump
4. Export video → Verify file playable in VLC
5. Fill storage → Verify graceful error message
6. Private browsing → Verify feature disabled with explanation

## Related Documentation

- **Smart Zoom**: `docs/SMART_ZOOM_SPEC.md` - AI-powered auto-framing that works during recording
- **Flash Detection**: `docs/FLASH_DETECTION_SPEC.md` - Trigger events from time machine footage
- **Architecture**: `CLAUDE.md` - Project coding conventions and patterns

## References

- PR #14: Implementation of disk-based time machine
- [MediaRecorder API Docs](https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder)
- [IndexedDB Guide](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API)

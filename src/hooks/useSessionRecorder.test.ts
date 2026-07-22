import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RecordingSession } from "../services/MediaRecorderService";
import type { PracticeSession } from "../types/sessions";
import { useSessionRecorder } from "./useSessionRecorder";

// Mock MediaStream for jsdom
class MockMediaStream {}
// @ts-expect-error - jsdom doesn't have MediaStream
globalThis.MediaStream = MockMediaStream;

// Mock ThumbnailCaptureService - jsdom has no real video decode/seek support,
// so the real captureAtTime() would hang until its internal 10s timeout.
vi.mock("../services/ThumbnailCaptureService", () => ({
	ThumbnailCaptureService: {
		captureFromVideo: vi.fn(),
		captureAtTime: vi
			.fn()
			.mockResolvedValue("data:image/jpeg;base64,firstframe"),
	},
}));

// Create mock services
function createMockSessionStorage() {
	return {
		init: vi.fn().mockResolvedValue(undefined),
		getRecentSessions: vi.fn().mockResolvedValue([]),
		getSavedSessions: vi.fn().mockResolvedValue([]),
		saveSession: vi.fn().mockResolvedValue("test-id"),
		saveSessionWithBlob: vi.fn().mockResolvedValue("test-id"),
		saveBlob: vi.fn().mockResolvedValue(undefined),
		pruneOldSessions: vi.fn().mockResolvedValue(0),
		getSession: vi.fn(),
		getBlob: vi.fn(),
		deleteSession: vi.fn(),
		deleteBlob: vi.fn(),
		deleteSessionWithBlob: vi.fn(),
		updateSession: vi.fn(),
		markAsSaved: vi.fn(),
		setTrimPoints: vi.fn(),
		getAllSessions: vi.fn(),
		getStorageUsage: vi.fn(),
		clear: vi.fn(),
		close: vi.fn(),
	};
}

function createMockMediaRecorder() {
	const mockSession: RecordingSession = {
		getState: vi.fn().mockReturnValue("recording"),
		start: vi.fn(),
		stop: vi.fn().mockResolvedValue({
			blob: new Blob(["test"], { type: "video/webm" }),
			duration: 5000,
		}),
	};

	return {
		isTypeSupported: vi.fn().mockReturnValue(true),
		isIOSSafari: vi.fn().mockReturnValue(false),
		getBestCodec: vi.fn().mockReturnValue("video/webm"),
		startRecording: vi.fn().mockReturnValue(mockSession),
	};
}

function createMockVideoFix() {
	return {
		fixDuration: vi
			.fn()
			.mockImplementation((blob) =>
				Promise.resolve({ blob, wasFixed: true }),
			),
		needsFix: vi.fn().mockReturnValue(true),
	};
}

function createMockTimerService() {
	const intervalCallbacks = new Map<number, () => void>();
	const timeoutCallbacks = new Map<number, () => void>();
	let idCounter = 1;

	return {
		now: vi.fn().mockReturnValue(Date.now()),
		setTimeout: vi.fn((cb: () => void) => {
			const id = idCounter++;
			timeoutCallbacks.set(id, cb);
			return id;
		}),
		setInterval: vi.fn((cb: () => void) => {
			const id = idCounter++;
			intervalCallbacks.set(id, cb);
			return id;
		}),
		clearTimeout: vi.fn((id: number) => {
			timeoutCallbacks.delete(id);
		}),
		clearInterval: vi.fn((id: number) => {
			intervalCallbacks.delete(id);
		}),
		performanceNow: vi.fn().mockReturnValue(performance.now()),
		// Test helpers
		_triggerInterval: (id: number) => intervalCallbacks.get(id)?.(),
		_triggerTimeout: (id: number) => timeoutCallbacks.get(id)?.(),
		_triggerAllIntervals: () => intervalCallbacks.forEach((cb) => cb()),
	};
}

function createMockStream() {
	const stream = new MediaStream();
	stream.clone = vi.fn(() => {
		const cloned = new MediaStream();
		Object.defineProperty(cloned, "active", { value: true });
		const mockTrack = { stop: vi.fn(), kind: "video", readyState: "live" } as unknown as MediaStreamTrack;
		cloned.getTracks = vi.fn(() => [mockTrack]);
		cloned.getVideoTracks = vi.fn(() => [mockTrack]);
		return cloned;
	});
	return stream;
}

function createMockVideoRef(ready = true) {
	return {
		current: {
			readyState: ready ? 4 : 0,
			srcObject: createMockStream(),
			videoWidth: 1920,
			videoHeight: 1080,
		} as unknown as HTMLVideoElement,
	};
}

describe("useSessionRecorder", () => {
	let mockStorage: ReturnType<typeof createMockSessionStorage>;
	let mockRecorder: ReturnType<typeof createMockMediaRecorder>;
	let mockVideoFix: ReturnType<typeof createMockVideoFix>;
	let mockTimer: ReturnType<typeof createMockTimerService>;

	beforeEach(() => {
		vi.clearAllMocks();
		vi.clearAllTimers();
		mockStorage = createMockSessionStorage();
		mockRecorder = createMockMediaRecorder();
		mockVideoFix = createMockVideoFix();
		mockTimer = createMockTimerService();
	});

	afterEach(() => {
		vi.clearAllTimers();
		vi.useRealTimers();
	});

	describe("initialization", () => {
		it("initializes with not recording state", () => {
			const videoRef = createMockVideoRef(false);

			const { result } = renderHook(() =>
				useSessionRecorder({
					videoRef,
					enabled: false,
					sessionStorageService: mockStorage,
					mediaRecorderService: mockRecorder,
					videoFixService: mockVideoFix,
					timerService: mockTimer,
				}),
			);

			expect(result.current.isRecording).toBe(false);
			expect(result.current.error).toBeNull();
		});

		it("loads sessions from storage on init", async () => {
			const mockSessions: PracticeSession[] = [
				{
					id: "1",
					createdAt: Date.now(),
					duration: 60,
					blobKey: "blob-1",
					thumbnail: "data:test",
					thumbnails: [],
					saved: false,
				},
			];
			mockStorage.getRecentSessions.mockResolvedValue(mockSessions);
			const videoRef = createMockVideoRef(false);

			const { result } = renderHook(() =>
				useSessionRecorder({
					videoRef,
					enabled: false,
					sessionStorageService: mockStorage,
					mediaRecorderService: mockRecorder,
					videoFixService: mockVideoFix,
					timerService: mockTimer,
				}),
			);

			await waitFor(() => {
				expect(result.current.recentSessions).toEqual(mockSessions);
			});
		});

		it("sets error state when storage init fails", async () => {
			mockStorage.init.mockRejectedValue(new Error("Storage unavailable"));
			const videoRef = createMockVideoRef(false);

			const { result } = renderHook(() =>
				useSessionRecorder({
					videoRef,
					enabled: false,
					sessionStorageService: mockStorage,
					mediaRecorderService: mockRecorder,
					videoFixService: mockVideoFix,
					timerService: mockTimer,
				}),
			);

			await waitFor(() => {
				expect(result.current.error).toBe("Storage unavailable - recording disabled");
			});
		});
	});

	describe("recording lifecycle", () => {
		it("does not start recording when disabled", () => {
			const videoRef = createMockVideoRef(true);

			const { result } = renderHook(() =>
				useSessionRecorder({
					videoRef,
					enabled: false,
					sessionStorageService: mockStorage,
					mediaRecorderService: mockRecorder,
					videoFixService: mockVideoFix,
					timerService: mockTimer,
				}),
			);

			expect(result.current.isRecording).toBe(false);
			expect(mockRecorder.startRecording).not.toHaveBeenCalled();
		});

		it("exposes stopCurrentBlock function", () => {
			const videoRef = createMockVideoRef(true);

			const { result } = renderHook(() =>
				useSessionRecorder({
					videoRef,
					enabled: false,
					sessionStorageService: mockStorage,
					mediaRecorderService: mockRecorder,
					videoFixService: mockVideoFix,
					timerService: mockTimer,
				}),
			);

			expect(typeof result.current.stopCurrentBlock).toBe("function");
		});
	});

	describe("save-failure resilience (M8)", () => {
		it("a failed block save does not permanently halt recording (M8)", async () => {
			const storage = createMockSessionStorage();
			storage.saveSessionWithBlob.mockRejectedValueOnce(new Error("disk full"));
			const videoRef = createMockVideoRef(true);

			const { result } = renderHook(() =>
				useSessionRecorder({
					videoRef,
					enabled: true,
					sessionStorageService: storage,
					mediaRecorderService: mockRecorder,
					videoFixService: mockVideoFix,
					timerService: mockTimer,
				}),
			);

			await waitFor(() => expect(result.current.isRecording).toBe(true));

			await act(async () => {
				await result.current.stopCurrentBlock();
			});

			// The block save failed (disk full), but that is not storage death:
			// recording should keep rotating rather than permanently halting.
			await waitFor(() => expect(result.current.isRecording).toBe(true));
		});
	});

	describe("camera switch (H4)", () => {
		it("stops and saves the current block when the video stream changes (H4)", async () => {
			const videoRef = createMockVideoRef(true);

			const { result } = renderHook(() =>
				useSessionRecorder({
					videoRef,
					enabled: true,
					sessionStorageService: mockStorage,
					mediaRecorderService: mockRecorder,
					videoFixService: mockVideoFix,
					timerService: mockTimer,
				}),
			);

			await waitFor(() => expect(result.current.isRecording).toBe(true));

			// Camera switch: the video element now points at a different stream.
			videoRef.current.srcObject = createMockStream();

			act(() => {
				mockTimer._triggerAllIntervals();
			});

			// The old block must be stopped and saved - the machine learns the
			// video went away and releases the old clone's tracks.
			await waitFor(() =>
				expect(mockStorage.saveSessionWithBlob).toHaveBeenCalledTimes(1),
			);

			act(() => {
				mockTimer._triggerAllIntervals();
			});

			// The next poll tick sees the new stream is ready and resumes.
			await waitFor(() => expect(result.current.isRecording).toBe(true));
		});
	});

	describe("refreshSessions", () => {
		it("exposes refreshSessions function", () => {
			const videoRef = createMockVideoRef(false);

			const { result } = renderHook(() =>
				useSessionRecorder({
					videoRef,
					enabled: false,
					sessionStorageService: mockStorage,
					mediaRecorderService: mockRecorder,
					videoFixService: mockVideoFix,
					timerService: mockTimer,
				}),
			);

			expect(typeof result.current.refreshSessions).toBe("function");
		});
	});

	describe("timer setup", () => {
		it("sets up video ready polling interval", () => {
			const videoRef = createMockVideoRef(true);

			renderHook(() =>
				useSessionRecorder({
					videoRef,
					enabled: true,
					sessionStorageService: mockStorage,
					mediaRecorderService: mockRecorder,
					videoFixService: mockVideoFix,
					timerService: mockTimer,
				}),
			);

			// Should set up video readiness polling
			expect(mockTimer.setInterval).toHaveBeenCalled();
		});
	});
});

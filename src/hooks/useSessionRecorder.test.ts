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

	describe("recorder park stickiness through the readiness poll (M1 bug fix)", () => {
		// A recorder whose startRecording() captures the onFailure callback so
		// the test can simulate a mid-block recorder death (the same path
		// MediaRecorder.onerror drives in production).
		function createFailingRecorder() {
			const captured: Array<
				(salvaged: { blob: Blob; duration: number } | null) => void
			> = [];
			const mockSession: RecordingSession = {
				getState: vi.fn().mockReturnValue("recording"),
				start: vi.fn(),
				stop: vi.fn().mockResolvedValue({
					blob: new Blob(["x"], { type: "video/webm" }),
					duration: 1000,
				}),
			};
			const recorder = {
				isTypeSupported: vi.fn().mockReturnValue(true),
				isIOSSafari: vi.fn().mockReturnValue(false),
				getBestCodec: vi.fn().mockReturnValue("video/webm"),
				startRecording: vi.fn().mockImplementation(
					(
						_stream: MediaStream,
						opts: {
							onFailure: (s: { blob: Blob; duration: number } | null) => void;
						},
					) => {
						captured.push(opts.onFailure);
						return mockSession;
					},
				),
			};
			return { recorder, captured };
		}

		it("a readyState dip+recovery does not un-stick the 3-strike park (hook-level)", async () => {
			const { recorder, captured } = createFailingRecorder();
			const videoRef = createMockVideoRef(true);

			const { result } = renderHook(() =>
				useSessionRecorder({
					videoRef,
					enabled: true,
					sessionStorageService: mockStorage,
					mediaRecorderService: recorder,
					videoFixService: mockVideoFix,
					timerService: mockTimer,
				}),
			);

			// Initial start (storage inits async, then recording begins).
			await waitFor(() => expect(result.current.isRecording).toBe(true));
			expect(recorder.startRecording).toHaveBeenCalledTimes(1);

			// 3 consecutive mid-block deaths. Failures 1 and 2 restart (and
			// capture a fresh onFailure each time); the 3rd parks in idle.
			await act(async () => {
				captured[captured.length - 1](null);
			});
			await waitFor(() => expect(result.current.isRecording).toBe(true));
			expect(recorder.startRecording).toHaveBeenCalledTimes(2);

			await act(async () => {
				captured[captured.length - 1](null);
			});
			await waitFor(() => expect(result.current.isRecording).toBe(true));
			expect(recorder.startRecording).toHaveBeenCalledTimes(3);

			await act(async () => {
				captured[captured.length - 1](null);
			});
			await waitFor(() => expect(result.current.isRecording).toBe(false));
			expect(result.current.notRecordingReason).toBe("recorder-error");
			expect(recorder.startRecording).toHaveBeenCalledTimes(3); // parked, no 4th start

			const startsAfterPark = recorder.startRecording.mock.calls.length;
			expect(startsAfterPark).toBe(3);

			// readyState dip: the 250ms poll fires videoNotReady().
			(videoRef.current as unknown as { readyState: number }).readyState = 1;
			act(() => {
				mockTimer._triggerAllIntervals();
			});

			// readyState recovery: the poll fires videoIsReady().
			(videoRef.current as unknown as { readyState: number }).readyState = 4;
			act(() => {
				mockTimer._triggerAllIntervals();
			});

			// The park must hold: no spurious restart, indicator stays
			// recorder-error, and no extra MediaRecorder was created.
			expect(result.current.isRecording).toBe(false);
			expect(result.current.notRecordingReason).toBe("recorder-error");
			expect(recorder.startRecording.mock.calls.length).toBe(startsAfterPark);
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

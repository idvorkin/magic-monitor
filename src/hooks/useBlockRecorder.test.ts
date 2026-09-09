import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RecordingSession } from "../services/MediaRecorderService";
import { useBlockRecorder } from "./useBlockRecorder";

// Mock MediaStream for jsdom with stream health properties
class MockMediaStream {
	active = true;
	getVideoTracks() {
		return [{ readyState: "live" }];
	}
	getAudioTracks() {
		return [];
	}
}
// @ts-expect-error - jsdom doesn't have MediaStream
globalThis.MediaStream = MockMediaStream;

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

function createMockTimerService() {
	return {
		now: vi.fn().mockReturnValue(Date.now()),
		setTimeout: vi.fn(),
		setInterval: vi.fn(),
		clearTimeout: vi.fn(),
		clearInterval: vi.fn(),
		performanceNow: vi.fn(),
	};
}

function createMockStream() {
	const stream = new MediaStream();
	// Add clone method that returns a new stream with same tracks
	stream.clone = vi.fn(() => {
		const cloned = new MediaStream();
		// Mock getTracks for cleanup verification
		cloned.getTracks = vi.fn(() => [
			{ stop: vi.fn(), kind: "video" } as unknown as MediaStreamTrack,
		]);
		return cloned;
	});
	return stream;
}

function createMockVideoRef(hasStream = true) {
	return {
		current: {
			readyState: 4,
			srcObject: hasStream ? createMockStream() : null,
			videoWidth: 1920,
			videoHeight: 1080,
		} as unknown as HTMLVideoElement,
	};
}

// Variant of createMockStream whose cloned track's stop() is observable via
// `stopSpy`. Used to assert the clone is released on startRecording failure
// paths.
function createMockStreamWithStopSpy(stopSpy: ReturnType<typeof vi.fn>) {
	const stream = new MediaStream();
	stream.clone = vi.fn(() => {
		const cloned = new MediaStream();
		cloned.getTracks = vi.fn(() => [
			{ stop: stopSpy, kind: "video" } as unknown as MediaStreamTrack,
		]);
		return cloned;
	});
	return stream;
}

function createMockVideoRefWithStream(stream: MediaStream) {
	return {
		current: {
			readyState: 4,
			srcObject: stream,
			videoWidth: 1920,
			videoHeight: 1080,
		} as unknown as HTMLVideoElement,
	} as unknown as React.RefObject<HTMLVideoElement | null>;
}

describe("useBlockRecorder", () => {
	let mockRecorder: ReturnType<typeof createMockMediaRecorder>;
	let mockTimer: ReturnType<typeof createMockTimerService>;

	beforeEach(() => {
		vi.clearAllMocks();
		mockRecorder = createMockMediaRecorder();
		mockTimer = createMockTimerService();
	});

	it("starts not recording", () => {
		const videoRef = createMockVideoRef();
		const { result } = renderHook(() =>
			useBlockRecorder({
				videoRef,
				mediaRecorderService: mockRecorder,
				timerService: mockTimer,
			}),
		);

		expect(result.current.isRecording).toBe(false);
		expect(result.current.getState()).toBe("inactive");
	});

	it("starts recording when startRecording is called", () => {
		const videoRef = createMockVideoRef();
		const { result } = renderHook(() =>
			useBlockRecorder({
				videoRef,
				mediaRecorderService: mockRecorder,
				timerService: mockTimer,
			}),
		);

		act(() => {
			result.current.startRecording();
		});

		expect(mockRecorder.startRecording).toHaveBeenCalled();
		expect(result.current.isRecording).toBe(true);
	});

	it("sets error when camera not available", () => {
		const videoRef = createMockVideoRef(false);
		const { result } = renderHook(() =>
			useBlockRecorder({
				videoRef,
				mediaRecorderService: mockRecorder,
				timerService: mockTimer,
			}),
		);

		act(() => {
			result.current.startRecording();
		});

		expect(result.current.error).toBe("Camera not available");
		expect(result.current.isRecording).toBe(false);
	});

	it("handles MediaRecorder.start() failure", () => {
		const videoRef = createMockVideoRef();
		const mockSession = mockRecorder.startRecording(
			new MediaStream(),
			{},
		) as RecordingSession;
		(mockSession.start as ReturnType<typeof vi.fn>).mockImplementation(() => {
			throw new Error("MediaRecorder start failed");
		});

		const { result } = renderHook(() =>
			useBlockRecorder({
				videoRef,
				mediaRecorderService: mockRecorder,
				timerService: mockTimer,
			}),
		);

		act(() => {
			result.current.startRecording();
		});

		expect(result.current.error).toBe("MediaRecorder start failed");
		expect(result.current.isRecording).toBe(false);
	});

	it("stops recording and returns result", async () => {
		const videoRef = createMockVideoRef();
		const { result } = renderHook(() =>
			useBlockRecorder({
				videoRef,
				mediaRecorderService: mockRecorder,
				timerService: mockTimer,
			}),
		);

		act(() => {
			result.current.startRecording();
		});
		expect(result.current.isRecording).toBe(true);

		let stopResult: Awaited<ReturnType<typeof result.current.stopRecording>>;
		await act(async () => {
			stopResult = await result.current.stopRecording();
		});

		expect(result.current.isRecording).toBe(false);
		expect(stopResult!).not.toBeNull();
		expect(stopResult!.blob).toBeInstanceOf(Blob);
		expect(stopResult!.duration).toBe(5000);
	});

	it("returns null when stopping while not recording", async () => {
		const videoRef = createMockVideoRef();
		const { result } = renderHook(() =>
			useBlockRecorder({
				videoRef,
				mediaRecorderService: mockRecorder,
				timerService: mockTimer,
			}),
		);

		const stopResult = await result.current.stopRecording();

		expect(stopResult).toBeNull();
	});

	it("handles stop errors gracefully", async () => {
		const videoRef = createMockVideoRef();
		const mockSession = mockRecorder.startRecording(
			new MediaStream(),
			{},
		) as RecordingSession;
		(mockSession.stop as ReturnType<typeof vi.fn>).mockRejectedValue(
			new Error("Stop failed"),
		);

		const { result } = renderHook(() =>
			useBlockRecorder({
				videoRef,
				mediaRecorderService: mockRecorder,
				timerService: mockTimer,
			}),
		);

		act(() => {
			result.current.startRecording();
		});

		let stopResult: Awaited<ReturnType<typeof result.current.stopRecording>>;
		await act(async () => {
			stopResult = await result.current.stopRecording();
		});

		expect(stopResult!).toBeNull();
		expect(result.current.isRecording).toBe(false);
		expect(result.current.error).toBe(
			"Recording may have been lost - please try again",
		);
	});

	it("a stale stop does not clobber a newer recording session", async () => {
		let resolveStopA!: (v: { blob: Blob; duration: number }) => void;
		const sessionA = {
			start: vi.fn(),
			getState: vi.fn().mockReturnValue("recording"),
			stop: vi.fn().mockReturnValue(
				new Promise<{ blob: Blob; duration: number }>((r) => {
					resolveStopA = r;
				}),
			),
		};
		const sessionB = {
			start: vi.fn(),
			getState: vi.fn().mockReturnValue("recording"),
			stop: vi.fn().mockResolvedValue({
				blob: new Blob(["b"], { type: "video/webm" }),
				duration: 1000,
			}),
		};
		mockRecorder.startRecording
			.mockReturnValueOnce(sessionA)
			.mockReturnValueOnce(sessionB);

		const videoRef = createMockVideoRef();
		const { result } = renderHook(() =>
			useBlockRecorder({
				videoRef,
				mediaRecorderService: mockRecorder,
				timerService: mockTimer,
			}),
		);

		act(() => {
			result.current.startRecording(); // block A
		});
		let stalePromise!: Promise<{ blob: Blob; duration: number } | null>;
		act(() => {
			stalePromise = result.current.stopRecording(); // A's stop, held open
		});
		act(() => {
			result.current.startRecording(); // block B starts while A's stop is in flight
		});
		resolveStopA({ blob: new Blob(["a"], { type: "video/webm" }), duration: 500 });
		await act(async () => {
			await stalePromise;
		});

		// The stale stop must NOT null out B's session: getState reads the live ref.
		expect(result.current.getState()).toBe("recording");
	});

	it("a startRecording that fails validation does not advance the generation - a stale stop from the prior block still cleans up", async () => {
		let resolveStopA!: (v: { blob: Blob; duration: number }) => void;
		const sessionA = {
			start: vi.fn(),
			getState: vi.fn().mockReturnValue("recording"),
			stop: vi.fn().mockReturnValue(
				new Promise<{ blob: Blob; duration: number }>((r) => {
					resolveStopA = r;
				}),
			),
		};
		mockRecorder.startRecording.mockReturnValueOnce(sessionA);

		const videoRef = createMockVideoRef();
		const { result } = renderHook(() =>
			useBlockRecorder({
				videoRef,
				mediaRecorderService: mockRecorder,
				timerService: mockTimer,
			}),
		);

		act(() => {
			result.current.startRecording(); // block A
		});
		expect(result.current.isRecording).toBe(true);

		let stalePromise!: Promise<{ blob: Blob; duration: number } | null>;
		act(() => {
			stalePromise = result.current.stopRecording(); // A's stop, held open
		});

		// Camera goes away before a next block can start - startRecording bails
		// on validation before ever touching the generation counter.
		if (videoRef.current) {
			videoRef.current.srcObject = null;
		}
		act(() => {
			result.current.startRecording(); // fails validation: "Camera not available"
		});
		expect(result.current.error).toBe("Camera not available");

		resolveStopA({ blob: new Blob(["a"], { type: "video/webm" }), duration: 500 });
		await act(async () => {
			await stalePromise;
		});

		// The stale stop's cleanup must still run: a startRecording call that
		// bails on validation must NOT have advanced the generation counter.
		// (If the generation were bumped at call-entry instead of at
		// session-establishment time, this stop would see a generation
		// mismatch, skip cleanup, and leave isRecording stuck true / getState
		// stuck "recording".)
		expect(result.current.getState()).toBe("inactive");
		expect(result.current.isRecording).toBe(false);
	});

	describe("cloned stream cleanup on start failure", () => {
		it("stops cloned tracks immediately when session.start() throws", () => {
			const stopSpy = vi.fn();
			const videoRef = createMockVideoRefWithStream(
				createMockStreamWithStopSpy(stopSpy),
			);
			const mockSession = mockRecorder.startRecording(
				new MediaStream(),
				{},
			) as RecordingSession;
			(mockSession.start as ReturnType<typeof vi.fn>).mockImplementation(() => {
				throw new Error("MediaRecorder start failed");
			});

			const { result } = renderHook(() =>
				useBlockRecorder({
					videoRef,
					mediaRecorderService: mockRecorder,
					timerService: mockTimer,
				}),
			);

			act(() => {
				result.current.startRecording();
			});

			expect(result.current.error).toBe("MediaRecorder start failed");
			expect(result.current.isRecording).toBe(false);
			expect(stopSpy).toHaveBeenCalledTimes(1);
		});

		it("stops cloned tracks immediately when MediaRecorder construction throws", () => {
			const stopSpy = vi.fn();
			const videoRef = createMockVideoRefWithStream(
				createMockStreamWithStopSpy(stopSpy),
			);
			mockRecorder.startRecording.mockImplementation(() => {
				throw new Error("Unsupported MIME type");
			});

			const { result } = renderHook(() =>
				useBlockRecorder({
					videoRef,
					mediaRecorderService: mockRecorder,
					timerService: mockTimer,
				}),
			);

			act(() => {
				result.current.startRecording();
			});

			expect(result.current.error).toBe(
				"Recording failed - check camera connection",
			);
			expect(result.current.isRecording).toBe(false);
			expect(stopSpy).toHaveBeenCalledTimes(1);
		});

		it("does not double-clean at the block boundary after a failed start", async () => {
			const stopSpy = vi.fn();
			const videoRef = createMockVideoRefWithStream(
				createMockStreamWithStopSpy(stopSpy),
			);
			const mockSession = mockRecorder.startRecording(
				new MediaStream(),
				{},
			) as RecordingSession;
			(mockSession.start as ReturnType<typeof vi.fn>).mockImplementation(() => {
				throw new Error("MediaRecorder start failed");
			});

			const { result } = renderHook(() =>
				useBlockRecorder({
					videoRef,
					mediaRecorderService: mockRecorder,
					timerService: mockTimer,
				}),
			);

			act(() => {
				result.current.startRecording();
			});
			expect(stopSpy).toHaveBeenCalledTimes(1);

			let stopResult: Awaited<ReturnType<typeof result.current.stopRecording>>;
			await act(async () => {
				stopResult = await result.current.stopRecording();
			});

			expect(stopResult!).toBeNull();
			// The failed start already released the clone (stop called once);
			// the block-boundary stop's !session guard must not call stop again.
			expect(stopSpy).toHaveBeenCalledTimes(1);
		});
	});
});

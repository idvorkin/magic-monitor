import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CameraService, InsecureContextError } from "../services/CameraService";
import { DeviceService } from "../services/DeviceService";
import { useCamera } from "./useCamera";

// Mock CameraService (resolveCameraSelection is real - it's a pure policy
// function and the effect under test depends on its actual behavior)
vi.mock("../services/CameraService", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("../services/CameraService")>();
	return {
		...actual, // keeps resolveCameraSelection, types, RESOLUTION_PRESETS real
		CameraService: {
			getVideoDevices: vi.fn(),
			start: vi.fn(),
			stop: vi.fn(),
			addDeviceChangeListener: vi.fn(),
			isSecureContext: vi.fn().mockReturnValue(true),
		},
		InsecureContextError: actual.InsecureContextError,
	};
});

// Mock DeviceService
vi.mock("../services/DeviceService", () => ({
	DeviceService: {
		getStorageItem: vi.fn(),
		setStorageItem: vi.fn(),
	},
}));

// Helper to create mock MediaStream
function createMockStream(deviceId = "device-1"): MediaStream {
	const mockTrack = {
		kind: "video",
		stop: vi.fn(),
		getSettings: () => ({ deviceId }),
		addEventListener: vi.fn(),
		removeEventListener: vi.fn(),
	};
	return {
		getTracks: () => [mockTrack],
		getVideoTracks: () => [mockTrack],
		getAudioTracks: () => [],
		active: true,
	} as unknown as MediaStream;
}

// Helper to create mock device
function createMockDevice(id: string, label: string): MediaDeviceInfo {
	return {
		deviceId: id,
		kind: "videoinput",
		label,
		groupId: "group-1",
		toJSON: () => ({}),
	};
}

describe("useCamera", () => {
	let deviceChangeCallback: (() => void) | null = null;

	beforeEach(() => {
		vi.clearAllMocks();
		deviceChangeCallback = null;

		// Default mock implementations
		vi.mocked(CameraService.getVideoDevices).mockResolvedValue([]);
		vi.mocked(CameraService.start).mockResolvedValue(createMockStream());
		vi.mocked(CameraService.stop).mockImplementation(() => {});
		vi.mocked(CameraService.addDeviceChangeListener).mockImplementation(
			(cb) => {
				deviceChangeCallback = cb;
				return () => {
					deviceChangeCallback = null;
				};
			},
		);
		vi.mocked(DeviceService.getStorageItem).mockReturnValue(null);
		vi.mocked(DeviceService.setStorageItem).mockImplementation(() => {});
	});

	afterEach(() => {
		deviceChangeCallback = null;
	});

	describe("initialization", () => {
		it("starts with null stream and no error", async () => {
			const { result } = renderHook(() => useCamera());

			// Initial state before effects run
			expect(result.current.stream).toBeNull();
			expect(result.current.error).toBeNull();
		});

		it("uses initialDeviceId if provided", async () => {
			renderHook(() => useCamera("initial-device"));

			await waitFor(() => {
				expect(CameraService.start).toHaveBeenCalledWith(
					"initial-device",
					"4k",
					"landscape",
				);
			});
		});

		it("uses stored device ID from DeviceService", async () => {
			vi.mocked(DeviceService.getStorageItem).mockReturnValue("stored-device");

			renderHook(() => useCamera());

			await waitFor(() => {
				expect(CameraService.start).toHaveBeenCalledWith(
					"stored-device",
					"4k",
					"landscape",
				);
			});
		});

		it("prefers initialDeviceId over stored value", async () => {
			vi.mocked(DeviceService.getStorageItem).mockReturnValue("stored-device");

			renderHook(() => useCamera("initial-device"));

			await waitFor(() => {
				expect(CameraService.start).toHaveBeenCalledWith(
					"initial-device",
					"4k",
					"landscape",
				);
			});
		});
	});

	describe("device enumeration", () => {
		it("fetches devices on mount", async () => {
			const devices = [
				createMockDevice("device-1", "Camera 1"),
				createMockDevice("device-2", "Camera 2"),
			];
			vi.mocked(CameraService.getVideoDevices).mockResolvedValue(devices);

			const { result } = renderHook(() => useCamera());

			await waitFor(() => {
				expect(result.current.devices).toEqual(devices);
			});
		});

		it("shows the first device for display but never persists an unchosen selection", async () => {
			vi.mocked(CameraService.getVideoDevices).mockResolvedValue([
				createMockDevice("device-1", "Camera 1"),
				createMockDevice("device-2", "Camera 2"),
			]);
			// Stream track reports NO deviceId (e.g. canvas/virtual source)
			const anonymousTrack = {
				kind: "video",
				stop: vi.fn(),
				getSettings: () => ({}),
			};
			vi.mocked(CameraService.start).mockResolvedValue({
				getTracks: () => [anonymousTrack],
				getVideoTracks: () => [anonymousTrack],
				getAudioTracks: () => [],
				active: true,
			} as unknown as MediaStream);

			const { result } = renderHook(() => useCamera());

			await waitFor(() => {
				expect(result.current.selectedDeviceId).toBe("device-1");
			});
			// Display-only fallback: nothing persisted (H1's poison was the persist)
			expect(DeviceService.setStorageItem).not.toHaveBeenCalledWith(
				"magic-monitor-camera-device-id",
				expect.anything(),
			);
		});

		it("a slow device enumeration cannot override the browser-chosen device (H1)", async () => {
			// Enumeration is slow; the stream (OS-chosen device-os) resolves first
			let resolveDevices!: (d: MediaDeviceInfo[]) => void;
			vi.mocked(CameraService.getVideoDevices).mockReturnValue(
				new Promise((r) => {
					resolveDevices = r;
				}),
			);
			vi.mocked(CameraService.start).mockResolvedValue(
				createMockStream("device-os"),
			);

			const { result } = renderHook(() => useCamera());

			// Let enumeration resolve LATE, listing a different device first
			resolveDevices([
				createMockDevice("device-virtual", "OBS Virtual"),
				createMockDevice("device-os", "Built-in"),
			]);

			await waitFor(() => {
				expect(result.current.selectedDeviceId).toBe("device-os");
			});
			// The stale enumeration must not have pinned the virtual camera
			expect(DeviceService.setStorageItem).not.toHaveBeenCalledWith(
				"magic-monitor-camera-device-id",
				"device-virtual",
			);
		});

		it("registers device change listener", async () => {
			renderHook(() => useCamera());

			await waitFor(() => {
				expect(CameraService.addDeviceChangeListener).toHaveBeenCalled();
			});
		});

		it("refreshes devices when device change event fires", async () => {
			const initialDevices = [createMockDevice("device-1", "Camera 1")];
			vi.mocked(CameraService.getVideoDevices).mockResolvedValue(
				initialDevices,
			);

			const { result } = renderHook(() => useCamera("device-1"));

			await waitFor(() => {
				expect(result.current.devices).toHaveLength(1);
			});

			// Simulate device change
			const newDevices = [
				createMockDevice("device-1", "Camera 1"),
				createMockDevice("device-2", "Camera 2"),
			];
			vi.mocked(CameraService.getVideoDevices).mockResolvedValue(newDevices);

			act(() => {
				deviceChangeCallback?.();
			});

			await waitFor(() => {
				expect(result.current.devices).toHaveLength(2);
			});
		});

		it("cleans up device change listener on unmount", async () => {
			const cleanup = vi.fn();
			vi.mocked(CameraService.addDeviceChangeListener).mockReturnValue(cleanup);

			const { unmount } = renderHook(() => useCamera());

			await waitFor(() => {
				expect(CameraService.addDeviceChangeListener).toHaveBeenCalled();
			});

			unmount();

			expect(cleanup).toHaveBeenCalled();
		});
	});

	describe("stream management", () => {
		it("starts camera stream", async () => {
			const mockStream = createMockStream();
			vi.mocked(CameraService.start).mockResolvedValue(mockStream);

			const { result } = renderHook(() => useCamera());

			await waitFor(() => {
				expect(result.current.stream).toBe(mockStream);
			});
		});

		it("adopting the opened device does not restart the stream", async () => {
			vi.mocked(CameraService.getVideoDevices).mockResolvedValue([
				createMockDevice("device-1", "Camera 1"),
			]);
			vi.mocked(CameraService.start).mockResolvedValue(
				createMockStream("device-1"),
			);

			const { result } = renderHook(() => useCamera());

			await waitFor(() => {
				expect(result.current.selectedDeviceId).toBe("device-1");
			});
			// The adoption state write must not have torn down and reopened
			expect(CameraService.start).toHaveBeenCalledTimes(1);
			expect(CameraService.stop).not.toHaveBeenCalled();
		});

		it("stops previous stream when device changes", async () => {
			const stream1 = createMockStream("device-1");
			const stream2 = createMockStream("device-2");

			// Set up devices so hook doesn't auto-detect and trigger extra re-renders
			vi.mocked(CameraService.getVideoDevices).mockResolvedValue([
				createMockDevice("device-1", "Camera 1"),
				createMockDevice("device-2", "Camera 2"),
			]);

			vi.mocked(CameraService.start)
				.mockResolvedValueOnce(stream1)
				.mockResolvedValueOnce(stream2);

			const { result } = renderHook(() => useCamera("device-1"));

			await waitFor(() => {
				expect(result.current.stream).toBe(stream1);
			});

			// Change device which triggers effect re-run
			act(() => {
				result.current.setSelectedDeviceId("device-2");
			});

			await waitFor(() => {
				expect(result.current.stream).toBe(stream2);
			});

			// Stream1 should have been stopped (either in cleanup or setupCamera)
			expect(CameraService.stop).toHaveBeenCalledWith(stream1);
		});

		it("stops stream on unmount", async () => {
			const mockStream = createMockStream();
			vi.mocked(CameraService.start).mockResolvedValue(mockStream);

			const { result, unmount } = renderHook(() => useCamera());

			await waitFor(() => {
				expect(result.current.stream).toBe(mockStream);
			});

			unmount();

			expect(CameraService.stop).toHaveBeenCalledWith(mockStream);
		});
	});

	describe("error handling", () => {
		it("sets generic error on camera failure", async () => {
			vi.mocked(CameraService.start).mockRejectedValue(
				new Error("Permission denied"),
			);

			const { result } = renderHook(() => useCamera());

			await waitFor(() => {
				expect(result.current.error).toBe(
					"Could not access camera. Please allow permissions.",
				);
			});
			expect(result.current.stream).toBeNull();
		});

		it("sets specific error for InsecureContextError", async () => {
			vi.mocked(CameraService.start).mockRejectedValue(
				new InsecureContextError(),
			);

			const { result } = renderHook(() => useCamera());

			await waitFor(() => {
				expect(result.current.error).toBe(
					"Camera requires HTTPS. Access this page via localhost or a secure connection.",
				);
			});
		});

		it("falls back to the OS default and clears the stale persisted id on OverconstrainedError (M3)", async () => {
			vi.mocked(DeviceService.getStorageItem).mockReturnValue("stale-id");
			vi.mocked(CameraService.getVideoDevices).mockResolvedValue([]); // pre-permission: can't validate
			const overconstrained = new Error("device not found");
			overconstrained.name = "OverconstrainedError";
			vi.mocked(CameraService.start)
				.mockRejectedValueOnce(overconstrained) // exact constraint fails
				.mockResolvedValue(createMockStream("real-device")); // unconstrained succeeds

			const { result } = renderHook(() => useCamera());

			await waitFor(() => {
				expect(result.current.stream).not.toBeNull();
			});
			expect(result.current.error).toBeNull(); // recovery is silent - camera works
			// Second start call was unconstrained
			expect(vi.mocked(CameraService.start).mock.calls[1][0]).toBeUndefined();
			// Stale id replaced by the adopted real device
			expect(DeviceService.setStorageItem).toHaveBeenCalledWith(
				"magic-monitor-camera-device-id",
				"real-device",
			);
			// No extra stream restart beyond the exact + fallback attempt
			expect(vi.mocked(CameraService.start)).toHaveBeenCalledTimes(2);
		});

		it("reports an accurate message when the selected camera is unavailable and fallback also fails (M3)", async () => {
			vi.mocked(DeviceService.getStorageItem).mockReturnValue("stale-id");
			const overconstrained = new Error("device not found");
			overconstrained.name = "OverconstrainedError";
			vi.mocked(CameraService.start).mockRejectedValue(overconstrained);

			const { result } = renderHook(() => useCamera());

			await waitFor(() => {
				expect(result.current.error).toBe(
					"Selected camera is unavailable. It may be unplugged.",
				);
			});
		});

		it("a cancelled run's OverconstrainedError cannot clear the user's persisted choice", async () => {
			// Run A opens the stale persisted id but its start() hangs (real
			// window: Chrome shows the permission prompt before rejecting).
			vi.mocked(DeviceService.getStorageItem).mockReturnValue("stale-id");
			let rejectFirstStart!: (err: Error) => void;
			vi.mocked(CameraService.start)
				.mockImplementationOnce(
					() =>
						new Promise((_, reject) => {
							rejectFirstStart = reject;
						}),
				)
				.mockResolvedValue(createMockStream("cam-2"));

			const { result } = renderHook(() => useCamera());
			await waitFor(() => {
				expect(CameraService.start).toHaveBeenCalledWith(
					"stale-id",
					"4k",
					"landscape",
				);
			});

			// User explicitly picks cam-2: persists it and cancels run A
			act(() => {
				result.current.setSelectedDeviceId("cam-2");
			});
			await waitFor(() => {
				expect(result.current.stream).not.toBeNull();
			});

			// Run A's suspended start finally rejects
			const overconstrained = new Error("device not found");
			overconstrained.name = "OverconstrainedError";
			await act(async () => {
				rejectFirstStart(overconstrained);
			});

			// The dead run must not have clobbered the user's choice...
			expect(DeviceService.setStorageItem).not.toHaveBeenCalledWith(
				"magic-monitor-camera-device-id",
				"",
			);
			// ...nor opened a fallback camera (no unconstrained start call)
			const startCalls = vi.mocked(CameraService.start).mock.calls;
			expect(startCalls.some((call) => call[0] === undefined)).toBe(false);
		});

		it("re-runs selection when the live track ends (unplug) instead of freezing (M3)", async () => {
			let endedHandler: (() => void) | null = null;
			const track = {
				kind: "video",
				stop: vi.fn(),
				getSettings: () => ({ deviceId: "device-1" }),
				addEventListener: vi.fn((event: string, cb: () => void) => {
					if (event === "ended") endedHandler = cb;
				}),
				removeEventListener: vi.fn(),
			};
			const stream1 = {
				getTracks: () => [track],
				getVideoTracks: () => [track],
				getAudioTracks: () => [],
				active: true,
			} as unknown as MediaStream;
			vi.mocked(CameraService.start)
				.mockResolvedValueOnce(stream1)
				.mockResolvedValue(createMockStream("device-2"));

			const { result } = renderHook(() => useCamera());
			await waitFor(() => {
				expect(result.current.stream).toBe(stream1);
			});
			expect(endedHandler).not.toBeNull();

			act(() => {
				endedHandler?.();
			});

			// Setup re-ran: a new stream replaced the dead one
			await waitFor(() => {
				expect(result.current.stream).not.toBe(stream1);
				expect(result.current.stream).not.toBeNull();
			});
		});
	});

	describe("retry", () => {
		it("clears error and retries on retry()", async () => {
			vi.mocked(CameraService.start)
				.mockRejectedValueOnce(new Error("Failed"))
				.mockResolvedValueOnce(createMockStream());

			const { result } = renderHook(() => useCamera());

			await waitFor(() => {
				expect(result.current.error).not.toBeNull();
			});

			act(() => {
				result.current.retry();
			});

			await waitFor(() => {
				expect(result.current.error).toBeNull();
				expect(result.current.stream).not.toBeNull();
			});
		});
	});

	describe("device selection", () => {
		it("persists device selection to storage", async () => {
			const { result } = renderHook(() => useCamera());

			await waitFor(() => {
				expect(CameraService.start).toHaveBeenCalled();
			});

			act(() => {
				result.current.setSelectedDeviceId("new-device");
			});

			expect(DeviceService.setStorageItem).toHaveBeenCalledWith(
				"magic-monitor-camera-device-id",
				"new-device",
			);
		});

		it("updates selectedDeviceId state", async () => {
			const { result } = renderHook(() => useCamera());

			await waitFor(() => {
				expect(CameraService.start).toHaveBeenCalled();
			});

			act(() => {
				result.current.setSelectedDeviceId("new-device");
			});

			expect(result.current.selectedDeviceId).toBe("new-device");
		});

		it("extracts device ID from stream when not set", async () => {
			const mockStream = createMockStream("auto-detected-device");
			vi.mocked(CameraService.start).mockResolvedValue(mockStream);

			const { result } = renderHook(() => useCamera());

			await waitFor(() => {
				expect(result.current.selectedDeviceId).toBe("auto-detected-device");
			});

			expect(DeviceService.setStorageItem).toHaveBeenCalledWith(
				"magic-monitor-camera-device-id",
				"auto-detected-device",
			);
		});
	});

	describe("resolution handling", () => {
		it("starts with default 4k resolution", async () => {
			// Set up devices to avoid auto-selection triggering extra renders
			vi.mocked(CameraService.getVideoDevices).mockResolvedValue([
				createMockDevice("device-1", "Camera 1"),
			]);

			const { result } = renderHook(() => useCamera("device-1"));

			await waitFor(() => {
				expect(CameraService.start).toHaveBeenCalled();
			});

			expect(result.current.resolution).toBe("4k");
		});

		it("passes resolution to CameraService.start", async () => {
			vi.mocked(CameraService.getVideoDevices).mockResolvedValue([
				createMockDevice("device-1", "Camera 1"),
			]);

			renderHook(() => useCamera("device-1"));

			await waitFor(() => {
				expect(CameraService.start).toHaveBeenCalledWith(
					"device-1",
					"4k",
					"landscape",
				);
			});
		});

		it("restarts stream when resolution changes", async () => {
			const stream1 = createMockStream("device-1");
			const stream2 = createMockStream("device-1");

			vi.mocked(CameraService.getVideoDevices).mockResolvedValue([
				createMockDevice("device-1", "Camera 1"),
			]);
			vi.mocked(CameraService.start)
				.mockResolvedValueOnce(stream1)
				.mockResolvedValueOnce(stream2);

			const { result } = renderHook(() => useCamera("device-1"));

			await waitFor(() => {
				expect(result.current.stream).toBe(stream1);
			});

			act(() => {
				result.current.setResolution("1080p");
			});

			await waitFor(() => {
				expect(result.current.stream).toBe(stream2);
			});

			// Verify CameraService.start was called with new resolution
			expect(CameraService.start).toHaveBeenCalledWith(
				"device-1",
				"1080p",
				"landscape",
			);
		});

		it("updates resolution state when setResolution is called", async () => {
			vi.mocked(CameraService.getVideoDevices).mockResolvedValue([
				createMockDevice("device-1", "Camera 1"),
			]);

			const { result } = renderHook(() => useCamera("device-1"));

			await waitFor(() => {
				expect(CameraService.start).toHaveBeenCalled();
			});

			act(() => {
				result.current.setResolution("720p");
			});

			expect(result.current.resolution).toBe("720p");
		});

		it("stops previous stream when resolution changes", async () => {
			const stream1 = createMockStream("device-1");
			const stream2 = createMockStream("device-1");

			vi.mocked(CameraService.getVideoDevices).mockResolvedValue([
				createMockDevice("device-1", "Camera 1"),
			]);
			vi.mocked(CameraService.start)
				.mockResolvedValueOnce(stream1)
				.mockResolvedValueOnce(stream2);

			const { result } = renderHook(() => useCamera("device-1"));

			await waitFor(() => {
				expect(result.current.stream).toBe(stream1);
			});

			act(() => {
				result.current.setResolution("1080p");
			});

			await waitFor(() => {
				expect(result.current.stream).toBe(stream2);
			});

			expect(CameraService.stop).toHaveBeenCalledWith(stream1);
		});
	});

	describe("orientation handling", () => {
		it("starts with default landscape orientation", async () => {
			vi.mocked(CameraService.getVideoDevices).mockResolvedValue([
				createMockDevice("device-1", "Camera 1"),
			]);

			const { result } = renderHook(() => useCamera("device-1"));

			await waitFor(() => {
				expect(CameraService.start).toHaveBeenCalled();
			});

			expect(result.current.orientation).toBe("landscape");
		});

		it("restarts stream when orientation changes", async () => {
			const stream1 = createMockStream("device-1");
			const stream2 = createMockStream("device-1");

			vi.mocked(CameraService.getVideoDevices).mockResolvedValue([
				createMockDevice("device-1", "Camera 1"),
			]);
			vi.mocked(CameraService.start)
				.mockResolvedValueOnce(stream1)
				.mockResolvedValueOnce(stream2);

			const { result } = renderHook(() => useCamera("device-1"));

			await waitFor(() => {
				expect(result.current.stream).toBe(stream1);
			});

			act(() => {
				result.current.setOrientation("portrait");
			});

			await waitFor(() => {
				expect(result.current.stream).toBe(stream2);
			});

			// Verify CameraService.start was called with new orientation
			expect(CameraService.start).toHaveBeenCalledWith(
				"device-1",
				"4k",
				"portrait",
			);
		});

		it("updates orientation state when setOrientation is called", async () => {
			vi.mocked(CameraService.getVideoDevices).mockResolvedValue([
				createMockDevice("device-1", "Camera 1"),
			]);

			const { result } = renderHook(() => useCamera("device-1"));

			await waitFor(() => {
				expect(CameraService.start).toHaveBeenCalled();
			});

			act(() => {
				result.current.setOrientation("portrait");
			});

			expect(result.current.orientation).toBe("portrait");
		});
	});
});

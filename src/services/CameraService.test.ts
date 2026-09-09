import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	CameraService,
	type Orientation,
	RESOLUTION_PRESETS,
	type Resolution,
	resolveCameraSelection,
} from "./CameraService";

function device(deviceId: string): MediaDeviceInfo {
	return {
		deviceId,
		kind: "videoinput",
		label: deviceId ? `Camera ${deviceId}` : "",
		groupId: "g",
		toJSON: () => ({}),
	} as MediaDeviceInfo;
}

describe("resolveCameraSelection", () => {
	it("uses a persisted id that is present in the device list, without constraint to first device", () => {
		expect(
			resolveCameraSelection({
				persistedId: "cam-b",
				devices: [device("cam-a"), device("cam-b")],
			}),
		).toEqual({ deviceId: "cam-b" });
	});

	it("trusts the persisted id when the device list cannot be validated (pre-permission empty ids)", () => {
		expect(
			resolveCameraSelection({
				persistedId: "cam-b",
				devices: [device(""), device("")],
			}),
		).toEqual({ deviceId: "cam-b" });
	});

	it("falls back to the OS default when the persisted id is stale (validated absent)", () => {
		expect(
			resolveCameraSelection({
				persistedId: "gone",
				devices: [device("cam-a"), device("cam-b")],
			}),
		).toEqual({ deviceId: null });
	});

	it("uses the OS default when nothing is persisted — never first-in-list", () => {
		expect(
			resolveCameraSelection({
				persistedId: "",
				devices: [device("cam-a"), device("cam-b")],
			}),
		).toEqual({ deviceId: null });
	});

	it("uses the OS default with an empty device list", () => {
		expect(resolveCameraSelection({ persistedId: "", devices: [] })).toEqual({
			deviceId: null,
		});
	});
});

function mockMediaStream(): MediaStream {
	return {
		getTracks: () => [],
		getVideoTracks: () => [],
		getAudioTracks: () => [],
		active: true,
	} as unknown as MediaStream;
}

describe("CameraService.start constraints", () => {
	let getUserMedia: ReturnType<typeof vi.fn>;
	let originalMediaDevices: MediaDevices | undefined;

	beforeEach(() => {
		originalMediaDevices = navigator.mediaDevices;
		getUserMedia = vi.fn(async () => mockMediaStream());
		Object.defineProperty(navigator, "mediaDevices", {
			value: {
				getUserMedia,
				enumerateDevices: vi.fn(async () => []),
				addEventListener: vi.fn(),
				removeEventListener: vi.fn(),
			},
			configurable: true,
			writable: true,
		});
	});

	afterEach(() => {
		// Restore the previous (jsdom: undefined) mediaDevices so other
		// suites that rely on isSecureContext() being false are unaffected.
		Object.defineProperty(navigator, "mediaDevices", {
			value: originalMediaDevices,
			configurable: true,
			writable: true,
		});
	});

	function lastConstraints(): MediaStreamConstraints {
		expect(getUserMedia).toHaveBeenCalled();
		return getUserMedia.mock.calls[0][0] as MediaStreamConstraints;
	}

	function videoConstraints(
		orientation: Orientation,
		resolution: Resolution = "4k",
		deviceId?: string,
	) {
		return CameraService.start(deviceId, resolution, orientation).then(
			lastConstraints,
		);
	}

	it("requests the preset width and height as `ideal` for landscape", async () => {
		const video = (await videoConstraints("landscape", "1080p"))
			.video as MediaTrackConstraints;
		expect(video.width).toEqual({
			ideal: RESOLUTION_PRESETS["1080p"].width,
		});
		expect(video.height).toEqual({
			ideal: RESOLUTION_PRESETS["1080p"].height,
		});
	});

	it("swaps width/height so a portrait shape (height > width) is requested", async () => {
		const video = (await videoConstraints("portrait", "1080p"))
			.video as MediaTrackConstraints;
		expect(video.width).toEqual({
			ideal: RESOLUTION_PRESETS["1080p"].height,
		});
		expect(video.height).toEqual({
			ideal: RESOLUTION_PRESETS["1080p"].width,
		});
		// The portrait signal: requested height exceeds requested width.
		expect((video.height as ConstrainULongRange).ideal).toBeGreaterThan(
			(video.width as ConstrainULongRange).ideal as number,
		);
	});

	it("requests a height constraint for portrait so a portrait shape is signalled to the camera", async () => {
		const video = (await videoConstraints("portrait", "4k"))
			.video as MediaTrackConstraints;
		expect(video.height).toBeDefined();
		expect((video.height as ConstrainULongRange).ideal).toBe(
			RESOLUTION_PRESETS["4k"].width,
		);
	});

	it("uses `ideal` (not `exact`) for both dimensions so the camera may fall back to its native aspect ratio", async () => {
		const video = (await videoConstraints("portrait", "720p"))
			.video as MediaTrackConstraints;
		expect(video.width).toMatchObject({ ideal: expect.any(Number) });
		expect(video.width).not.toMatchObject({ exact: expect.any(Number) });
		expect(video.height).toMatchObject({ ideal: expect.any(Number) });
		expect(video.height).not.toMatchObject({ exact: expect.any(Number) });
	});
});

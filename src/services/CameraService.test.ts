import { describe, expect, it } from "vitest";
import { resolveCameraSelection } from "./CameraService";

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

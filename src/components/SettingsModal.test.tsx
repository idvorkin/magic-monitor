import "@testing-library/jest-dom";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SettingsModal } from "./SettingsModal";

// Default props for testing
function createDefaultProps(overrides: Partial<Parameters<typeof SettingsModal>[0]> = {}) {
	return {
		isOpen: true,
		onClose: vi.fn(),
		devices: [
			{ deviceId: "device-1", kind: "videoinput" as const, label: "Camera 1", groupId: "group1", toJSON: () => ({}) },
			{ deviceId: "device-2", kind: "videoinput" as const, label: "Camera 2", groupId: "group1", toJSON: () => ({}) },
		],
		selectedDeviceId: "device-1",
		onDeviceChange: vi.fn(),
		resolution: "4k" as const,
		onResolutionChange: vi.fn(),
		orientation: "landscape" as const,
		onOrientationChange: vi.fn(),
		videoWidth: 3840,
		videoHeight: 2160,
		isMirror: false,
		onMirrorChange: vi.fn(),
		isSmartZoom: false,
		isModelLoading: false,
		smartZoomModelError: null,
		onSmartZoomChange: vi.fn(),
		smoothingPreset: "ema" as const,
		onSmoothingPresetChange: vi.fn(),
		showHandSkeleton: false,
		onShowHandSkeletonChange: vi.fn(),
		cardDetectionEnabled: false,
		cardModelLoading: false,
		cardModelError: null,
		onCardDetectionChange: vi.fn(),
		cardConfidenceThreshold: 0.5,
		onCardConfidenceChange: vi.fn(),
		cardShowBoxes: true,
		onCardShowBoxesChange: vi.fn(),
		cardShowList: true,
		onCardShowListChange: vi.fn(),
		flashEnabled: false,
		onFlashEnabledChange: vi.fn(),
		threshold: 25,
		onThresholdChange: vi.fn(),
		isPickingColor: false,
		onPickColorClick: vi.fn(),
		targetColor: null,
		updateAvailable: false,
		isCheckingUpdate: false,
		lastCheckTime: null,
		onCheckForUpdate: vi.fn(),
		onReloadForUpdate: vi.fn(),
		shakeEnabled: false,
		onShakeEnabledChange: vi.fn(),
		isShakeSupported: false,
		onOpenAbout: vi.fn(),
		...overrides,
	};
}

describe("SettingsModal", () => {
	describe("rendering", () => {
		it("renders when isOpen is true", () => {
			render(<SettingsModal {...createDefaultProps()} />);
			expect(screen.getByText("Settings")).toBeInTheDocument();
		});

		it("does not render when isOpen is false", () => {
			render(<SettingsModal {...createDefaultProps({ isOpen: false })} />);
			expect(screen.queryByText("Settings")).not.toBeInTheDocument();
		});
	});

	describe("resolution dropdown", () => {
		it("displays all resolution options", () => {
			render(<SettingsModal {...createDefaultProps()} />);

			const resolutionSelect = screen.getByLabelText("Resolution");
			expect(resolutionSelect).toBeInTheDocument();

			// Check all options are present
			const options = resolutionSelect.querySelectorAll("option");
			expect(options).toHaveLength(3);
			expect(options[0]).toHaveTextContent("1280 wide (720p)");
			expect(options[1]).toHaveTextContent("1920 wide (1080p)");
			expect(options[2]).toHaveTextContent("3840 wide (4k)");
		});

		it("shows current resolution as selected", () => {
			render(<SettingsModal {...createDefaultProps({ resolution: "1080p" })} />);

			const resolutionSelect = screen.getByLabelText("Resolution") as HTMLSelectElement;
			expect(resolutionSelect.value).toBe("1080p");
		});

		it("calls onResolutionChange when resolution is changed", () => {
			const onResolutionChange = vi.fn();
			render(<SettingsModal {...createDefaultProps({ onResolutionChange })} />);

			const resolutionSelect = screen.getByLabelText("Resolution");
			fireEvent.change(resolutionSelect, { target: { value: "720p" } });

			expect(onResolutionChange).toHaveBeenCalledWith("720p");
		});

		it("displays actual video dimensions when provided", () => {
			render(<SettingsModal {...createDefaultProps({ videoWidth: 1920, videoHeight: 1080 })} />);

			expect(screen.getByText("Actual: 1920×1080")).toBeInTheDocument();
		});

		it("does not display actual dimensions when not provided", () => {
			render(<SettingsModal {...createDefaultProps({ videoWidth: undefined, videoHeight: undefined })} />);

			expect(screen.queryByText(/Actual:/)).not.toBeInTheDocument();
		});
	});

	describe("orientation toggle", () => {
		it("shows landscape as active by default", () => {
			render(<SettingsModal {...createDefaultProps({ orientation: "landscape" })} />);

			const landscapeButton = screen.getByTitle("Landscape");
			const portraitButton = screen.getByTitle("Portrait");

			expect(landscapeButton).toHaveClass("bg-blue-600");
			expect(portraitButton).not.toHaveClass("bg-blue-600");
		});

		it("shows portrait as active when orientation is portrait", () => {
			render(<SettingsModal {...createDefaultProps({ orientation: "portrait" })} />);

			const landscapeButton = screen.getByTitle("Landscape");
			const portraitButton = screen.getByTitle("Portrait");

			expect(landscapeButton).not.toHaveClass("bg-blue-600");
			expect(portraitButton).toHaveClass("bg-blue-600");
		});

		it("calls onOrientationChange when portrait is clicked", () => {
			const onOrientationChange = vi.fn();
			render(<SettingsModal {...createDefaultProps({ onOrientationChange })} />);

			fireEvent.click(screen.getByTitle("Portrait"));

			expect(onOrientationChange).toHaveBeenCalledWith("portrait");
		});

		it("calls onOrientationChange when landscape is clicked", () => {
			const onOrientationChange = vi.fn();
			render(<SettingsModal {...createDefaultProps({ orientation: "portrait", onOrientationChange })} />);

			fireEvent.click(screen.getByTitle("Landscape"));

			expect(onOrientationChange).toHaveBeenCalledWith("landscape");
		});
	});

	describe("camera source dropdown", () => {
		it("displays all camera devices", () => {
			render(<SettingsModal {...createDefaultProps()} />);

			const cameraSelect = screen.getByLabelText("Camera Source");
			const options = cameraSelect.querySelectorAll("option");

			expect(options).toHaveLength(2);
			expect(options[0]).toHaveTextContent("Camera 1");
			expect(options[1]).toHaveTextContent("Camera 2");
		});

		it("shows current device as selected", () => {
			render(<SettingsModal {...createDefaultProps({ selectedDeviceId: "device-2" })} />);

			const cameraSelect = screen.getByLabelText("Camera Source") as HTMLSelectElement;
			expect(cameraSelect.value).toBe("device-2");
		});

		it("calls onDeviceChange when device is changed", () => {
			const onDeviceChange = vi.fn();
			render(<SettingsModal {...createDefaultProps({ onDeviceChange })} />);

			const cameraSelect = screen.getByLabelText("Camera Source");
			fireEvent.change(cameraSelect, { target: { value: "device-2" } });

			expect(onDeviceChange).toHaveBeenCalledWith("device-2");
		});

		it("uses fallback label when device has no label", () => {
			const devicesWithoutLabels = [
				{ deviceId: "device-1", kind: "videoinput" as const, label: "", groupId: "group1", toJSON: () => ({}) },
				{ deviceId: "device-2", kind: "videoinput" as const, label: "", groupId: "group1", toJSON: () => ({}) },
			];
			render(<SettingsModal {...createDefaultProps({ devices: devicesWithoutLabels })} />);

			const cameraSelect = screen.getByLabelText("Camera Source");
			const options = cameraSelect.querySelectorAll("option");

			expect(options[0]).toHaveTextContent("Camera 1");
			expect(options[1]).toHaveTextContent("Camera 2");
		});
	});

	describe("close button", () => {
		it("calls onClose when close button is clicked", () => {
			const onClose = vi.fn();
			render(<SettingsModal {...createDefaultProps({ onClose })} />);

			fireEvent.click(screen.getByLabelText("Close settings"));

			expect(onClose).toHaveBeenCalled();
		});

		it("calls onClose when clicking outside modal", () => {
			const onClose = vi.fn();
			render(<SettingsModal {...createDefaultProps({ onClose })} />);

			// Click on the backdrop (the outermost div)
			const backdrop = screen.getByText("Settings").parentElement?.parentElement?.parentElement;
			if (backdrop) {
				fireEvent.click(backdrop);
				expect(onClose).toHaveBeenCalled();
			}
		});
	});
});

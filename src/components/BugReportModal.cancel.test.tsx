import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BugReportData } from "../hooks/useBugReporter";
import { DeviceService } from "../services/DeviceService";
import { BugReportModal } from "./BugReportModal";

// DeviceService.captureScreenshot() drives the screen-share picker; the
// `getDisplayMedia` API it relies on is unavailable in jsdom so the whole
// module must be mocked. `isMobileDevice` returns false so the desktop
// capture UI (Capture/Recapture button + preview) renders.
vi.mock("../services/DeviceService", () => ({
	DeviceService: {
		captureScreenshot: vi.fn(),
		isMobileDevice: () => false,
	},
}));

const captureSpy = vi.mocked(DeviceService.captureScreenshot);

// Default props for testing. Mirrors the prop shape wired up in CameraStage.
function createDefaultProps(
	overrides: Partial<Parameters<typeof BugReportModal>[0]> = {},
) {
	return {
		isOpen: true,
		onClose: vi.fn(),
		onOpen: vi.fn(),
		onSubmit: vi.fn().mockResolvedValue({ success: true }),
		isSubmitting: false,
		defaultData: {
			title: "Default title",
			description: "Default description",
			includeMetadata: true,
		} satisfies BugReportData,
		shakeEnabled: false,
		onShakeEnabledChange: vi.fn(),
		isShakeSupported: false,
		onRequestShakePermission: vi.fn().mockResolvedValue(true),
		isFirstTime: false,
		onFirstTimeShown: vi.fn(),
		shortcut: "Ctrl+I",
		...overrides,
	};
}

describe("BugReportModal screenshot capture cancellation", () => {
	beforeEach(() => {
		captureSpy.mockReset();
	});

	it("keeps the existing screenshot when the user cancels a recapture", async () => {
		captureSpy.mockResolvedValueOnce("data:image/png;base64,FIRSTSCREENSHOT"); // first capture succeeds
		captureSpy.mockResolvedValueOnce(null); // recapture cancelled

		render(<BugReportModal {...createDefaultProps()} />);

		fireEvent.click(screen.getByText("Capture"));
		await waitFor(() =>
			expect(screen.getByAltText("Screenshot preview")).toBeInTheDocument(),
		);
		expect(screen.getByAltText("Screenshot preview")).toHaveAttribute(
			"src",
			"data:image/png;base64,FIRSTSCREENSHOT",
		);

		fireEvent.click(screen.getByText("Recapture")); // user cancels the picker
		await waitFor(() => expect(captureSpy).toHaveBeenCalledTimes(2));

		// Expected: original screenshot still present.
		// Actual (buggy): setScreenshot(null) wiped it -> getByAltText throws "not in document".
		expect(screen.getByAltText("Screenshot preview")).toBeInTheDocument();
		expect(screen.getByAltText("Screenshot preview")).toHaveAttribute(
			"src",
			"data:image/png;base64,FIRSTSCREENSHOT",
		);
	});

	it("does not show a screenshot preview after a cancelled initial capture", async () => {
		captureSpy.mockResolvedValueOnce(null); // initial capture cancelled

		render(<BugReportModal {...createDefaultProps()} />);

		fireEvent.click(screen.getByText("Capture"));
		await waitFor(() => expect(captureSpy).toHaveBeenCalledTimes(1));

		// Nothing to lose on a first capture, so cancelling just leaves the
		// empty state: no preview, and the button still reads "Capture".
		expect(screen.queryByAltText("Screenshot preview")).not.toBeInTheDocument();
		expect(screen.getByText("Capture")).toBeInTheDocument();
		expect(screen.queryByText("Recapture")).not.toBeInTheDocument();
	});

	it("replaces the existing screenshot when a recapture succeeds", async () => {
		captureSpy.mockResolvedValueOnce("data:image/png;base64,FIRSTSCREENSHOT"); // first capture
		captureSpy.mockResolvedValueOnce("data:image/png;base64,SECONDSCREENSHOT"); // recapture succeeds

		render(<BugReportModal {...createDefaultProps()} />);

		fireEvent.click(screen.getByText("Capture"));
		await waitFor(() =>
			expect(screen.getByAltText("Screenshot preview")).toHaveAttribute(
				"src",
				"data:image/png;base64,FIRSTSCREENSHOT",
			),
		);

		fireEvent.click(screen.getByText("Recapture"));
		await waitFor(() => expect(captureSpy).toHaveBeenCalledTimes(2));

		// A successful recapture must still replace the previous frame.
		expect(screen.getByAltText("Screenshot preview")).toHaveAttribute(
			"src",
			"data:image/png;base64,SECONDSCREENSHOT",
		);
		expect(screen.getByText("Recapture")).toBeInTheDocument();
	});
});

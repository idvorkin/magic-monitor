import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DeviceService } from "../services/DeviceService";
import { useBugReporter } from "./useBugReporter";

vi.mock("../services/DeviceService", () => ({
	DeviceService: {
		getStorageItem: vi.fn(() => null),
		setStorageItem: vi.fn(),
		isMobileDevice: vi.fn(() => false),
		getCurrentRoute: vi.fn(() => "/"),
		getUserAgent: vi.fn(() => "test-ua"),
		getScreenWidth: vi.fn(() => 1920),
		getScreenHeight: vi.fn(() => 1080),
		getDevicePixelRatio: vi.fn(() => 1),
		getDeviceMemoryGB: vi.fn(() => 8),
		getHardwareConcurrency: vi.fn(() => 4),
		isOnline: vi.fn(() => true),
		getConnectionType: vi.fn(() => "4g"),
		getDisplayMode: vi.fn(() => "browser"),
		isTouchDevice: vi.fn(() => false),
		copyImageToClipboard: vi.fn(),
		copyToClipboard: vi.fn(),
		openInNewTab: vi.fn(),
	},
}));

const SCREENSHOT_DATA_URL = "data:image/png;base64,AAAA";

type SubmitResult = {
	success: boolean;
	hasScreenshotOnClipboard?: boolean;
	error?: unknown;
};

function bodyFromIssueUrl(url: string): string {
	return new URL(url).searchParams.get("body") ?? "";
}

function openedIssueUrl(): string {
	return vi.mocked(DeviceService.openInNewTab).mock.calls[0][0] as string;
}

function copiedClipboardText(): string {
	return vi.mocked(DeviceService.copyToClipboard).mock.calls[0][0] as string;
}

describe("useBugReporter.submit clipboard note", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		// Defaults: desktop device, successful image copy, successful text copy.
		vi.mocked(DeviceService.isMobileDevice).mockReturnValue(false);
		vi.mocked(DeviceService.copyImageToClipboard).mockResolvedValue(true);
		vi.mocked(DeviceService.copyToClipboard).mockResolvedValue(true);
	});

	it("omits the clipboard note when copyImageToClipboard fails on desktop", async () => {
		vi.mocked(DeviceService.copyImageToClipboard).mockResolvedValue(false);

		const { result } = renderHook(() => useBugReporter());
		let submitResult: SubmitResult = { success: false };
		await act(async () => {
			submitResult = await result.current.submit({
				title: "My Bug",
				description: "desc",
				includeMetadata: false,
				screenshot: SCREENSHOT_DATA_URL,
			});
		});

		expect(vi.mocked(DeviceService.copyImageToClipboard)).toHaveBeenCalledTimes(
			1,
		);
		expect(vi.mocked(DeviceService.copyImageToClipboard)).toHaveBeenCalledWith(
			SCREENSHOT_DATA_URL,
		);
		expect(vi.mocked(DeviceService.copyToClipboard)).toHaveBeenCalledTimes(1);
		expect(vi.mocked(DeviceService.openInNewTab)).toHaveBeenCalledTimes(1);

		const body = bodyFromIssueUrl(openedIssueUrl());
		expect(body).not.toContain("Screenshot is on your clipboard");
		expect(body).not.toContain("**Screenshot**");

		expect(copiedClipboardText()).not.toContain(
			"Screenshot is on your clipboard",
		);

		expect(submitResult).toEqual({
			success: true,
			hasScreenshotOnClipboard: false,
		});
	});

	it("includes the clipboard note and skips text fallback when copyImageToClipboard succeeds", async () => {
		const { result } = renderHook(() => useBugReporter());
		let submitResult: SubmitResult = { success: false };
		await act(async () => {
			submitResult = await result.current.submit({
				title: "My Bug",
				description: "desc",
				includeMetadata: false,
				screenshot: SCREENSHOT_DATA_URL,
			});
		});

		expect(vi.mocked(DeviceService.copyImageToClipboard)).toHaveBeenCalledTimes(
			1,
		);
		expect(vi.mocked(DeviceService.copyImageToClipboard)).toHaveBeenCalledWith(
			SCREENSHOT_DATA_URL,
		);
		expect(vi.mocked(DeviceService.copyToClipboard)).not.toHaveBeenCalled();
		expect(vi.mocked(DeviceService.openInNewTab)).toHaveBeenCalledTimes(1);

		const body = bodyFromIssueUrl(openedIssueUrl());
		expect(body).toContain("**Screenshot**");
		expect(body).toContain("Screenshot is on your clipboard");

		expect(submitResult).toEqual({
			success: true,
			hasScreenshotOnClipboard: true,
		});
	});

	it("never attempts image copy on mobile and omits the note from text fallback", async () => {
		vi.mocked(DeviceService.isMobileDevice).mockReturnValue(true);

		const { result } = renderHook(() => useBugReporter());
		let submitResult: SubmitResult = { success: false };
		await act(async () => {
			submitResult = await result.current.submit({
				title: "My Bug",
				description: "desc",
				includeMetadata: false,
				screenshot: SCREENSHOT_DATA_URL,
			});
		});

		expect(
			vi.mocked(DeviceService.copyImageToClipboard),
		).not.toHaveBeenCalled();
		expect(vi.mocked(DeviceService.copyToClipboard)).toHaveBeenCalledTimes(1);
		expect(vi.mocked(DeviceService.openInNewTab)).toHaveBeenCalledTimes(1);

		const body = bodyFromIssueUrl(openedIssueUrl());
		expect(body).not.toContain("Screenshot is on your clipboard");
		expect(body).not.toContain("**Screenshot**");

		expect(copiedClipboardText()).not.toContain(
			"Screenshot is on your clipboard",
		);

		expect(submitResult).toEqual({
			success: true,
			hasScreenshotOnClipboard: false,
		});
	});
});

import { expect, test } from "@playwright/test";

// Reusable mock injection function
async function injectMockCamera(page: import("@playwright/test").Page) {
	await page.addInitScript(() => {
		const canvas = document.createElement("canvas");
		canvas.width = 1920;
		canvas.height = 1080;
		const ctx = canvas.getContext("2d");
		if (ctx) {
			ctx.fillStyle = "#111";
			ctx.fillRect(0, 0, 1920, 1080);
		}

		function createMockStream() {
			return canvas.captureStream(30);
		}

		if (!navigator.mediaDevices) {
			// @ts-expect-error - navigator.mediaDevices is read-only but we need to mock it
			navigator.mediaDevices = {};
		}

		navigator.mediaDevices.getUserMedia = async () => createMockStream();
		navigator.mediaDevices.enumerateDevices = async () =>
			[
				{
					deviceId: "mock-camera-1",
					kind: "videoinput",
					label: "Mock Camera 1",
					groupId: "group1",
				},
				{
					deviceId: "mock-camera-2",
					kind: "videoinput",
					label: "Mock Camera 2",
					groupId: "group1",
				},
			] as MediaDeviceInfo[];
	});
}

test.describe("Dropdown Bug Investigation", () => {
	test.beforeEach(async ({ page }) => {
		await injectMockCamera(page);
		await page.addInitScript(() => {
			localStorage.clear();
		});
		await page.goto("/");
	});

	test("Resolution dropdown should stay open when clicked", async ({ page }) => {
		// Open settings
		await page.getByTitle("Settings").click();
		await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();

		// Click on the resolution dropdown
		const resolutionSelect = page.locator("select#resolution");
		await expect(resolutionSelect).toBeVisible();

		// Try to interact with the dropdown
		await resolutionSelect.click();

		// Wait a bit to see if modal closes
		await page.waitForTimeout(300);

		// The settings modal should still be visible
		const settingsHeading = page.getByRole("heading", { name: "Settings" });
		const isStillVisible = await settingsHeading.isVisible();

		console.log("Settings modal visible after clicking dropdown:", isStillVisible);

		// This should pass - dropdown click shouldn't close the modal
		await expect(settingsHeading).toBeVisible();

		// Now try selecting an option
		await resolutionSelect.selectOption("1080p");

		// Modal should still be visible after selection
		await expect(settingsHeading).toBeVisible();

		// Verify selection changed
		const value = await resolutionSelect.inputValue();
		expect(value).toBe("1080p");
	});

	// Regression guard: useSmartZoom/useCardDetection used to run detect() before
	// loadedmetadata; a 0x0 frame crashed MediaPipe/ONNX WASM and the error boundary
	// tore down the whole UI. Both detection loops now skip frames with
	// readyState < 2 or videoWidth === 0 (see useSmartZoom.ts / useCardDetection.ts).
	test("Camera source dropdown should stay open when clicked", async ({ page }) => {
		// Open settings
		await page.getByTitle("Settings").click();
		await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();

		// Click on the camera source dropdown
		const cameraSelect = page.locator("select#camera-source");
		await expect(cameraSelect).toBeVisible();

		// Try to interact with the dropdown
		await cameraSelect.click();

		// Wait a bit to see if modal closes
		await page.waitForTimeout(300);

		// The settings modal should still be visible
		const settingsHeading = page.getByRole("heading", { name: "Settings" });
		await expect(settingsHeading).toBeVisible();
	});
});

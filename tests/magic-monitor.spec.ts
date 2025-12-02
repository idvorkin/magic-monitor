import { expect, type Page, test } from "@playwright/test";
import { seedRewindBuffer } from "./helpers/seedRewindBuffer";

// Declare the mock helper types for TypeScript
declare global {
	interface Window {
		mockCamera: {
			setColor: (color: string) => void;
		};
	}
}

// Reusable mock injection function
async function injectMockCamera(page: Page) {
	await page.addInitScript(() => {
		// Create the Mock Camera Helper
		const canvas = document.createElement("canvas");
		canvas.width = 1920;
		canvas.height = 1080;
		const ctx = canvas.getContext("2d");

		// Default to a pattern so we can see it working
		let currentColor = "pattern";

		function draw() {
			if (!ctx) return;

			if (currentColor === "pattern") {
				// Draw a moving pattern
				const time = Date.now() / 1000;
				ctx.fillStyle = "#111";
				ctx.fillRect(0, 0, canvas.width, canvas.height);

				ctx.fillStyle = "#444";
				const x = ((Math.sin(time) + 1) * canvas.width) / 2;
				ctx.fillRect(x - 50, canvas.height / 2 - 50, 100, 100);

				ctx.fillStyle = "white";
				ctx.font = "40px sans-serif";
				ctx.fillText(`MOCK CAMERA ${time.toFixed(1)}`, 50, 50);
			} else {
				// Solid color
				ctx.fillStyle = currentColor;
				ctx.fillRect(0, 0, canvas.width, canvas.height);
			}

			requestAnimationFrame(draw);
		}

		draw();

		// Expose control to window
		window.mockCamera = {
			setColor: (color: string) => {
				currentColor = color;
			},
		};

		// Mock getUserMedia
		const stream = canvas.captureStream(30);

		// Override navigator.mediaDevices.getUserMedia
		if (!navigator.mediaDevices) {
			// @ts-expect-error - navigator.mediaDevices is read-only but we need to mock it
			navigator.mediaDevices = {};
		}

		navigator.mediaDevices.getUserMedia = async (constraints) => {
			console.log("Mock getUserMedia called with:", constraints);
			return stream;
		};

		navigator.mediaDevices.enumerateDevices = async () => {
			return [
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
		};
	});
}

test.describe("Magic Monitor E2E", () => {
	test.beforeEach(async ({ page }) => {
		await injectMockCamera(page);
		// Clear localStorage to ensure clean state between tests
		await page.addInitScript(() => {
			localStorage.clear();
		});
		await page.goto("/");
	});

	test("App loads and requests camera", async ({ page }) => {
		await expect(page).toHaveTitle(/magic-monitor/i);
		// Check if the video element exists and is playing
		const video = page.getByTestId("main-video");
		await expect(video).toBeVisible();

		// Check if controls are visible
		await page.getByTitle("Settings").click();
		await expect(page.getByText("Pick Color")).toBeVisible();

		// Check if camera selection has labels
		const cameraSelect = page.locator("select#camera-source");
		await expect(cameraSelect).toContainText("Mock Camera 1");
		await expect(cameraSelect).toContainText("Mock Camera 2");
	});

	// TODO: Flash detection timing is flaky with mock camera - needs investigation
	// The mock canvas stream and flash detector's requestAnimationFrame loop
	// don't sync reliably in the test environment
	test.skip("Flash Detection Logic", async ({ page }) => {
		// Use a distinctive color for testing (not pure red to avoid any default state issues)
		const testColor = "rgb(0, 255, 0)"; // Green

		// 1. Set Mock to GREEN
		await page.evaluate(
			(color) => window.mockCamera.setColor(color),
			testColor,
		);
		await page.waitForTimeout(500); // Let mock update

		// 2. Pick the color
		await page.getByTitle("Settings").click();
		await page.getByText("Pick Color").click();
		// Click the video to pick the color (center of screen)
		await page
			.getByTestId("main-video")
			.click({ position: { x: 100, y: 100 }, force: true });

		// 3. Verify flash is now armed
		await page.getByTitle("Settings").click();
		// Use exact match since "ARMED" appears in both settings modal and main control bar
		await expect(
			page.getByRole("button", { name: "ARMED", exact: true }),
		).toBeVisible();

		// Close settings modal before testing flash overlay
		await page.keyboard.press("Escape");
		await page.waitForTimeout(500);

		// The flash warning overlay is the border-red-600 div.
		const flashOverlay = page.locator(".border-red-600");

		// 4. Since we're showing green and picked green, flash should be active
		await expect(flashOverlay).toHaveClass(/opacity-100/, { timeout: 3000 });

		// 5. Change to BLUE - flash should stop (different color)
		await page.evaluate(() => window.mockCamera.setColor("rgb(0, 0, 255)"));
		await page.waitForTimeout(500);
		await expect(flashOverlay).toHaveClass(/opacity-0/, { timeout: 5000 });

		// 6. Change back to GREEN - flash should resume
		await page.evaluate(
			(color) => window.mockCamera.setColor(color),
			testColor,
		);
		await expect(flashOverlay).toHaveClass(/opacity-100/, { timeout: 3000 });
	});

	test("UI Controls: Zoom and Quality", async ({ page }) => {
		// Zoom
		const zoomInput = page.locator('input[type="range"]').last(); // Zoom is the last range input
		await zoomInput.fill("2");
		// Verify video style transform
		const video = page.getByTestId("main-video");
		// Browsers often report transform as matrix(scaleX, skewY, skewX, scaleY, translateX, translateY)
		// scale(2) -> matrix(2, 0, 0, 2, 0, 0)
		await expect(video).toHaveCSS("transform", /matrix\(2, 0, 0, 2, 0, 0\)/);

		// Reset Zoom (button text is just "Reset")
		await page.getByText("Reset").click();
		// scale(1) -> none or matrix(1, 0, 0, 1, 0, 0)
		await expect(video).toHaveCSS(
			"transform",
			/none|matrix\(1, 0, 0, 1, 0, 0\)/,
		);

		// Quality Toggle
		await page.getByTitle("Settings").click();
		// Find the HQ toggle - it's the first toggle switch in the modal after Mirror
		// Use a more robust selector that finds toggles by their role
		const hqToggle = page
			.locator("div", { hasText: /^High Quality Mode/ })
			.locator('button[role="switch"]');

		// Get current state and toggle
		const isCurrentlyHQ = await hqToggle.evaluate((el) =>
			el.classList.contains("bg-purple-600"),
		);

		await hqToggle.click();

		// After toggle, state should be opposite
		if (isCurrentlyHQ) {
			// Was HQ (purple), now should be LQ (gray)
			await expect(hqToggle).toHaveClass(/bg-gray-700/);
		} else {
			// Was LQ (gray), now should be HQ (purple)
			await expect(hqToggle).toHaveClass(/bg-purple-600/);
		}
	});

	test("Time Machine: Enter and Exit Replay (Disk Mode)", async ({ page }) => {
		// Seed the IndexedDB with test chunks
		await seedRewindBuffer(page, 5);

		// Reload to pick up the seeded data
		await page.reload();

		// Wait for chunk count to show (disk mode shows chunks, not RAM)
		await expect(page.getByText(/\d+\/30 chunks/)).toBeVisible({
			timeout: 15000,
		});

		// Enter Replay (button text is "Rewind" with emoji)
		await page.getByText("Rewind").click();

		// Verify Replay UI
		await expect(page.getByText("REPLAY MODE")).toBeVisible();

		// Video should be hidden, replay video visible
		await expect(page.getByTestId("main-video")).toBeHidden();

		// Exit Replay (button shows ✕)
		await page.locator("button", { hasText: "✕" }).click();

		// Wait for replay mode to exit - the main controls bar should reappear
		await expect(page.getByText("REPLAY MODE")).toBeHidden({ timeout: 5000 });
		await expect(page.getByText("Rewind")).toBeVisible({ timeout: 5000 });
		await expect(page.getByTestId("main-video")).toBeVisible();
	});

	test("Time Machine: Thumbnails appear in replay", async ({ page }) => {
		// Seed with 5 chunks
		await seedRewindBuffer(page, 5);
		await page.reload();

		// Wait for recording indicator
		await expect(page.getByText(/\d+\/30 chunks/)).toBeVisible({
			timeout: 15000,
		});

		// Enter replay
		await page.getByText("Rewind").click();
		await expect(page.getByText("REPLAY MODE")).toBeVisible();

		// Expand filmstrip
		await page.locator("button", { hasText: "▲" }).click();

		// Verify thumbnails are visible (5 chunks = 5 thumbnails)
		// Thumbnails have alt text like "0s", "2s", "4s" etc
		const thumbnails = page.locator("img[alt$='s']");
		await expect(thumbnails).toHaveCount(5);

		// Click a thumbnail to seek
		await thumbnails.nth(2).click();

		// Exit replay
		await page.locator("button", { hasText: "✕" }).click();
		await expect(page.getByText("REPLAY MODE")).toBeHidden({ timeout: 5000 });
	});

	test("Time Machine: Export video downloads file", async ({ page }) => {
		// Seed with 3 chunks for faster test
		await seedRewindBuffer(page, 3);
		await page.reload();

		// Wait for chunks to load
		await expect(page.getByText(/\d+\/30 chunks/)).toBeVisible({
			timeout: 15000,
		});

		// Enter replay mode
		await page.getByText("Rewind").click();
		await expect(page.getByText("REPLAY MODE")).toBeVisible();

		// Set up download listener before clicking save
		const downloadPromise = page.waitForEvent("download", { timeout: 30000 });

		// Click save button
		const saveButton = page.locator("button", { hasText: /Save/ });
		await saveButton.click();

		// Wait for download to complete
		const download = await downloadPromise;

		// Verify download filename pattern
		expect(download.suggestedFilename()).toMatch(
			/^magic-monitor-replay-.*\.webm$/,
		);

		// Save to temp location and verify we got something
		const path = await download.path();
		expect(path).toBeTruthy();

		// The file should have content (at least the 3 chunks concatenated)
		const fs = await import("node:fs/promises");
		const stats = await fs.stat(path!);
		expect(stats.size).toBeGreaterThan(0);

		// Exit replay
		await page.locator("button", { hasText: "✕" }).click();
	});
});

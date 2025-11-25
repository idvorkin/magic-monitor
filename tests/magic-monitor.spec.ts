import { expect, type Page, test } from "@playwright/test";

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
	});
}

test.describe("Magic Monitor E2E", () => {
	test.beforeEach(async ({ page }) => {
		await injectMockCamera(page);
		await page.goto("/");
	});

	test("App loads and requests camera", async ({ page }) => {
		await expect(page).toHaveTitle(/magic-monitor/i);
		// Check if the video element exists and is playing
		const video = page.getByTestId("main-video");
		await expect(video).toBeVisible();

		// Check if controls are visible
		await expect(page.getByText("Pick Color")).toBeVisible();
	});

	test("Flash Detection Logic", async ({ page }) => {
		// 1. Set Mock to RED
		await page.evaluate(() => window.mockCamera.setColor("rgb(255, 0, 0)"));

		// 2. Pick the color
		await page.getByText("Pick Color").click();
		// Click the video to pick the color (center of screen)
		await page
			.getByTestId("main-video")
			.click({ position: { x: 400, y: 300 } });

		// 3. Verify color picked (Warning border might flash briefly if threshold met, but we are solid red)
		// The App automatically enables flash after picking.
		// Check if "ARMED" button is present (it toggles from "OFF" to "ARMED" automatically)
		await expect(page.getByText("ARMED")).toBeVisible();

		// 4. Set Mock to BLUE (Should NOT trigger flash)
		await page.evaluate(() => window.mockCamera.setColor("rgb(0, 0, 255)"));
		// The flash warning overlay is the border-red-600 div.
		// It has `opacity-0` when not flashing and `opacity-100` when flashing.
		const flashOverlay = page.locator(".border-red-600");
		await expect(flashOverlay).toHaveClass(/opacity-0/);

		// 5. Set Mock to RED (Should TRIGGER flash)
		await page.evaluate(() => window.mockCamera.setColor("rgb(255, 0, 0)"));
		await expect(flashOverlay).toHaveClass(/opacity-100/);
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

		// Reset Zoom
		await page.getByText("Reset Zoom").click();
		// scale(1) -> none or matrix(1, 0, 0, 1, 0, 0)
		await expect(video).toHaveCSS(
			"transform",
			/none|matrix\(1, 0, 0, 1, 0, 0\)/,
		);

		// Quality Toggle
		const hqBtn = page.getByTitle("High Quality Mode");
		await expect(hqBtn).toHaveText("LQ");
		await hqBtn.click();
		await expect(hqBtn).toHaveText("HQ");
	});

	test("Time Machine: Enter and Exit Replay", async ({ page }) => {
		// Wait a bit for "buffer" to fill (simulated)
		await page.waitForTimeout(1000);

		// Enter Replay
		await page.getByText("REWIND").click();

		// Verify Replay UI
		await expect(page.getByText("REPLAY MODE")).toBeVisible();
		await expect(page.getByText("EXIT REPLAY")).toBeVisible();

		// Video should be hidden, Canvas visible
		await expect(page.getByTestId("main-video")).toBeHidden();
		await expect(page.locator("canvas").first()).toBeVisible();

		// Exit Replay
		await page.getByText("EXIT REPLAY").click();
		await expect(page.getByText("REWIND")).toBeVisible();
		await expect(page.getByTestId("main-video")).toBeVisible();
	});
});

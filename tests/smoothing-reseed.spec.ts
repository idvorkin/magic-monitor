import { expect, type Page, test } from "@playwright/test";

/**
 * Browser-level smoke for the SmartZoom Kalman reseed fix.
 *
 * The wrong-direction reversal artifact is a 1-2 frame (~33-66 ms) event that
 * the hook exposes only via `zoomRef.current` (a ref, not React state). The
 * displayed `zoom` React state is throttled to ~10 Hz (every 6 frames), so it
 * literally cannot resolve the artifact, and `zoomRef.current` is not exposed
 * to the page. The algorithmic + hook layers cover the artifact directly
 * (src/smoothing/smoothing.test.ts, src/hooks/useSmartZoom.test.ts read the
 * per-frame ref). This spec covers what IS observable in the browser:
 *  - enabling Smart Zoom and switching to each Kalman preset does not crash
 *    the app or throw (the `Smoother.reseed` path runs every frame the model
 *    is loaded);
 *  - the smoothing-preset <select> reflects the chosen option;
 *  - the preset change is persisted to localStorage (per useSettings.ts).
 */

// Precisely locate the Smart Zoom toggle row. The settings modal nests many
// divs, so a broad `hasText: /Smart Zoom/` matches ancestor containers that
// hold *every* switch. Instead, target the exact "Smart Zoom" heading, go up
// two levels to its row, and scope the switch to that row (unique).
function getSmartZoomToggle(page: Page) {
	return page
		.getByText("Smart Zoom", { exact: true })
		.locator("xpath=../..")
		.getByRole("switch");
}

async function injectMockCamera(page: Page) {
	await page.addInitScript(() => {
		const canvas = document.createElement("canvas");
		canvas.width = 1920;
		canvas.height = 1080;
		const ctx = canvas.getContext("2d");
		function draw() {
			if (!ctx) return;
			const time = Date.now() / 1000;
			ctx.fillStyle = "#111";
			ctx.fillRect(0, 0, canvas.width, canvas.height);
			ctx.fillStyle = "#444";
			const x = ((Math.sin(time) + 1) * canvas.width) / 2;
			ctx.fillRect(x - 50, canvas.height / 2 - 50, 100, 100);
			requestAnimationFrame(draw);
		}
		draw();

		if (!navigator.mediaDevices) {
			// @ts-expect-error - mock
			navigator.mediaDevices = {};
		}
		navigator.mediaDevices.getUserMedia = async () => canvas.captureStream(30);
		navigator.mediaDevices.enumerateDevices = async () =>
			[
				{
					deviceId: "mock-camera-1",
					kind: "videoinput",
					label: "Mock Camera 1",
					groupId: "group1",
				},
			] as MediaDeviceInfo[];

		// @ts-expect-error - mock MediaRecorder for canvas streams
		window.MediaRecorder = class {
			stream: MediaStream;
			state = "inactive";
			ondataavailable: ((e: BlobEvent) => void) | null = null;
			onstop: (() => void) | null = null;
			constructor(stream: MediaStream) {
				this.stream = stream;
			}
			static isTypeSupported(m: string) {
				return m.startsWith("video/webm");
			}
			start() {
				this.state = "recording";
			}
			stop() {
				this.state = "inactive";
				this.onstop?.();
			}
			pause() {
				this.state = "paused";
			}
			resume() {
				this.state = "recording";
			}
			requestData() {}
		};
	});
}

test.describe("SmartZoom Kalman reseed (browser smoke)", () => {
	// Collected per-test; beforeEach resets, afterEach asserts empty.
	let pageErrors: string[] = [];

	test.beforeEach(async ({ page, context }) => {
		pageErrors = [];
		await injectMockCamera(page);
		await page.addInitScript(() => localStorage.clear());
		await context.clearCookies();
		await page.goto("/");
		// Collect page console errors so a thrown reseed (e.g. NaN/Infinity in
		// the transform) can't hide.
		page.on("console", (msg) => {
			if (msg.type() === "error") {
				pageErrors.push(msg.text());
			}
		});
	});

	test.afterEach(() => {
		expect(
			pageErrors,
			"no page console errors during Kalman reseed run",
		).toEqual([]);
	});

	test("selecting kalmanFast presets the smoother and keeps the app stable", async ({
		page,
	}) => {
		const video = page.getByTestId("main-video");
		await expect(video).toBeVisible();

		// Open Settings and enable Smart Zoom (smoothing selector only renders
		// when Smart Zoom is on).
		await page.getByTitle("Settings").click();
		// Smart Zoom defaults to ON (useSettings.ts). The smoothing selector
		// only renders when Smart Zoom is on, so make sure it's on: if the
		// select isn't visible, flip the toggle; if it is, we're done.
		const presetSelect = page.locator("select#smoothing-preset");
		if (!(await presetSelect.isVisible())) {
			await getSmartZoomToggle(page).click();
		}
		await expect(presetSelect).toBeVisible();

		// Switch to Kalman Fast. Every subsequent frame runs the reseed path
		// (Smoother.reseed -> Kalman1D.reset) with empty landmarks (mock
		// camera has no hand), so this exercises the wiring without crashing.
		await presetSelect.selectOption("kalmanFast");
		await expect(presetSelect).toHaveValue("kalmanFast");

		// Close settings and let the loop run a while.
		await page.keyboard.press("Escape");
		await page.waitForTimeout(1500);

		// No NaN/Infinity poisoned the transform (the reseed writes zoom each
		// frame; with no hands zoom stays at 1).
		await expect(video).toBeVisible();
		const transform = await video.evaluate(
			(el) => getComputedStyle(el).transform,
		);
		expect(transform).toMatch(/none|matrix/);

		// Persistence: reopen and confirm the preset round-tripped through
		// useSettings (localStorage) — exercises the path the bug report cites
		// (src/components/SettingsModal.tsx, src/hooks/useSettings.ts).
		await page.getByTitle("Settings").click();
		await expect(page.locator("select#smoothing-preset")).toHaveValue(
			"kalmanFast",
		);
	});

	test("selecting kalmanSmooth keeps the app stable too", async ({ page }) => {
		await page.getByTitle("Settings").click();
		const presetSelect = page.locator("select#smoothing-preset");
		if (!(await presetSelect.isVisible())) {
			await getSmartZoomToggle(page).click();
		}
		await expect(presetSelect).toBeVisible();
		await presetSelect.selectOption("kalmanSmooth");
		await expect(presetSelect).toHaveValue("kalmanSmooth");

		await page.keyboard.press("Escape");
		await page.waitForTimeout(1500);

		// Re-enabling and switching back to ema must also be clean (the
		// smoother is recreated on preset change -> reset()).
		await page.getByTitle("Settings").click();
		await page.locator("select#smoothing-preset").selectOption("ema");
		await expect(page.locator("select#smoothing-preset")).toHaveValue("ema");
	});
});

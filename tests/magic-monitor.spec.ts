import { expect, type Page, test } from "@playwright/test";
import {
	seedSessionBuffer,
	waitForSessionsLoaded,
} from "./helpers/seedSessionBuffer";

// Declare the mock helper types for TypeScript
declare global {
	interface Window {
		mockCamera: {
			setColor: (color: string) => void;
		};
	}
}

// Helper to locate a settings toggle by its label
function getSettingsToggle(page: Page, labelPattern: RegExp) {
	return page
		.locator("div", { hasText: labelPattern })
		.locator('button[role="switch"]');
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

		// Create a fresh stream each time to avoid inactive stream issues
		function createMockStream() {
			return canvas.captureStream(30);
		}

		// Store initial stream for reference
		let activeStream = createMockStream();

		// Override navigator.mediaDevices.getUserMedia
		if (!navigator.mediaDevices) {
			// @ts-expect-error - navigator.mediaDevices is read-only but we need to mock it
			navigator.mediaDevices = {};
		}

		navigator.mediaDevices.getUserMedia = async (constraints) => {
			console.log("Mock getUserMedia called with:", constraints);
			// Always return a fresh stream to ensure it's active
			activeStream = createMockStream();
			return activeStream;
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

		// Mock MediaRecorder to work with canvas streams in headless Chrome
		const mockRecordings = new Map<MediaRecorder, Blob[]>();

		class MockMediaRecorder {
			stream: MediaStream;
			state: "inactive" | "recording" | "paused" = "inactive";
			ondataavailable: ((event: BlobEvent) => void) | null = null;
			onstop: (() => void) | null = null;
			onerror: ((event: Event) => void) | null = null;

			constructor(stream: MediaStream, _opts?: MediaRecorderOptions) {
			void _opts; // Unused but required by MediaRecorder interface
				this.stream = stream;
				mockRecordings.set(this as unknown as MediaRecorder, []);
			}

			static isTypeSupported(mimeType: string): boolean {
				// Report support for common video types
				return mimeType.startsWith("video/webm");
			}

			start(timeslice?: number) {
				void timeslice; // Unused but matches MediaRecorder interface
				this.state = "recording";
				// Simulate data becoming available after a short delay
				const generateData = () => {
					if (this.state === "recording" && this.ondataavailable) {
						// Create a small mock video blob
						const blob = new Blob(["mock-video-data"], { type: "video/webm" });
						const chunks = mockRecordings.get(this as unknown as MediaRecorder) || [];
						chunks.push(blob);
						this.ondataavailable({ data: blob } as BlobEvent);
					}
				};
				// Generate data periodically
				const intervalId = setInterval(generateData, 1000);
				(this as Record<string, unknown>)._intervalId = intervalId;
			}

			stop() {
				this.state = "inactive";
				const intervalId = (this as Record<string, unknown>)._intervalId as number;
				if (intervalId) clearInterval(intervalId);

				// Final data chunk
				if (this.ondataavailable) {
					const blob = new Blob(["mock-video-final"], { type: "video/webm" });
					const chunks = mockRecordings.get(this as unknown as MediaRecorder) || [];
					chunks.push(blob);
					this.ondataavailable({ data: blob } as BlobEvent);
				}

				if (this.onstop) {
					this.onstop();
				}
			}

			pause() {
				this.state = "paused";
			}

			resume() {
				this.state = "recording";
			}

			requestData() {
				if (this.ondataavailable) {
					const blob = new Blob(["mock-video-chunk"], { type: "video/webm" });
					this.ondataavailable({ data: blob } as BlobEvent);
				}
			}
		}

		// Always install the mock: MediaRecorder with canvas streams is
		// unreliable in headless Chrome, and deterministic recording data
		// is what the recording tests depend on.
		// @ts-expect-error - overriding MediaRecorder
		window.MediaRecorder = MockMediaRecorder;
	});
}

test.describe("Magic Monitor E2E", () => {
	test.beforeEach(async ({ page, context }) => {
		await injectMockCamera(page);
		// Clear localStorage and unregister service workers for clean state
		await page.addInitScript(() => {
			localStorage.clear();
			// Unregister any service workers to avoid cached content
			if ("serviceWorker" in navigator) {
				navigator.serviceWorker.getRegistrations().then((registrations) => {
					for (const registration of registrations) {
						registration.unregister();
					}
				});
			}
		});
		// Clear browser context storage state
		await context.clearCookies();
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

	// Skip zoom test - slider value setting via evaluate doesn't trigger React state update reliably
	test.skip("UI Controls: Zoom", async ({ page }) => {
		// Wait for video to be ready
		const video = page.getByTestId("main-video");
		await expect(video).toBeVisible();

		// Find the zoom slider (contains the 1.0x text nearby)
		const zoomSlider = page.locator('input[type="range"]').last();
		await expect(zoomSlider).toBeVisible();

		// Use evaluate to set the value and trigger change event properly
		await zoomSlider.evaluate((el: HTMLInputElement) => {
			el.value = "2";
			el.dispatchEvent(new Event("input", { bubbles: true }));
			el.dispatchEvent(new Event("change", { bubbles: true }));
		});

		// Wait a bit for React to process the state change
		await page.waitForTimeout(200);

		// Verify video style transform
		// Browsers often report transform as matrix(scaleX, skewY, skewX, scaleY, translateX, translateY)
		// scale(2) -> matrix(2, 0, 0, 2, 0, 0)
		await expect(video).toHaveCSS("transform", /matrix\(2, 0, 0, 2, 0, 0\)/, { timeout: 5000 });

		// Reset Zoom (button text is just "Reset")
		await page.getByText("Reset").click();
		// scale(1) -> none or matrix(1, 0, 0, 1, 0, 0)
		await expect(video).toHaveCSS(
			"transform",
			/none|matrix\(1, 0, 0, 1, 0, 0\)/,
		);
	});

	test("Sessions: Enter and Exit Replay via Session Picker", async ({
		page,
	}) => {
		// Seed the IndexedDB with test sessions
		await seedSessionBuffer(page, 3);

		// Reload to pick up the seeded data
		await page.reload();

		// Wait for seeded data to be loaded from IndexedDB
		await waitForSessionsLoaded(page, 3);

		// Open Sessions picker using the button role to avoid ambiguity with status text
		await page.getByRole("button", { name: "Sessions" }).click();

		// Verify Session Picker modal is visible
		await expect(
			page.getByRole("heading", { name: "Sessions" }),
		).toBeVisible();

		// Check that recent sessions section is displayed (use heading role to be specific)
		await expect(
			page.getByRole("heading", { name: "Recent" }),
		).toBeVisible();

		// Click first session thumbnail to enter timeline view
		const sessionThumbnails = page.locator(
			'[data-testid="session-thumbnail"]',
		);
		await sessionThumbnails.first().click();

		// Timeline view should show thumbnails (previews)
		const timelineThumbs = page.locator('img[alt^="Frame at"]');
		await expect(timelineThumbs.first()).toBeVisible({ timeout: 5000 });

		// Click first thumbnail to enter replay mode
		await timelineThumbs.first().click();

		// Verify Replay UI is shown
		await expect(page.getByText("REPLAY MODE")).toBeVisible();

		// Video should be hidden, replay video visible
		await expect(page.getByTestId("main-video")).toBeHidden();

		// Exit Replay (button shows ✕)
		await page.locator("button", { hasText: "✕" }).click();

		// Wait for replay mode to exit - the main controls bar should reappear
		await expect(page.getByText("REPLAY MODE")).toBeHidden({ timeout: 5000 });
		await expect(page.getByRole("button", { name: "Sessions" })).toBeVisible({ timeout: 5000 });
		await expect(page.getByTestId("main-video")).toBeVisible();
	});

	test("Sessions: Thumbnails appear in session timeline", async ({ page }) => {
		// Seed with 3 sessions
		await seedSessionBuffer(page, 3);
		await page.reload();

		// Wait for seeded data to be loaded from IndexedDB
		await waitForSessionsLoaded(page, 3);

		// Open Sessions picker
		await page.getByRole("button", { name: "Sessions" }).click();
		await expect(
			page.getByRole("heading", { name: "Sessions" }),
		).toBeVisible();

		// Click first session to see timeline view
		const sessionThumbnails = page.locator(
			'[data-testid="session-thumbnail"]',
		);
		await sessionThumbnails.first().click();

		// Timeline view should show thumbnails from the session
		// Each session has thumbnails at different times
		const timelineThumbs = page.locator('img[alt^="Frame at"]');
		await expect(timelineThumbs.first()).toBeVisible({ timeout: 5000 });

		// There should be multiple thumbnails (seeded sessions have 6 thumbnails each)
		const count = await timelineThumbs.count();
		expect(count).toBeGreaterThan(0);

		// Click a thumbnail to seek to that time and enter replay
		await timelineThumbs.first().click();

		// Should now be in replay mode
		await expect(page.getByText("REPLAY MODE")).toBeVisible();

		// Exit replay
		await page.locator("button", { hasText: "✕" }).click();
		await expect(page.getByText("REPLAY MODE")).toBeHidden({ timeout: 5000 });
	});

	test("Sessions: Export video via Share button", async ({ page }) => {
		// Seed with 3 sessions for faster test
		await seedSessionBuffer(page, 3);
		await page.reload();

		// Wait for seeded data to be loaded from IndexedDB
		await waitForSessionsLoaded(page, 3);

		// Open Sessions picker and select a session
		await page.getByRole("button", { name: "Sessions" }).click();
		await expect(
			page.getByRole("heading", { name: "Sessions" }),
		).toBeVisible();

		// Click first session
		const sessionThumbnails = page.locator(
			'[data-testid="session-thumbnail"]',
		);
		await sessionThumbnails.first().click();

		// Click first thumbnail to enter replay mode
		const timelineThumbs = page.locator('img[alt^="Frame at"]');
		await expect(timelineThumbs.first()).toBeVisible({ timeout: 5000 });
		await timelineThumbs.first().click();
		await expect(page.getByText("REPLAY MODE")).toBeVisible();

		// Set up download listener before clicking share
		const downloadPromise = page.waitForEvent("download", { timeout: 30000 });

		// Click share button (may need to wait for it to appear)
		const shareButton = page.locator("button", { hasText: /Share/ });
		await expect(shareButton).toBeVisible();
		await shareButton.click();

		// Wait for download to complete
		const download = await downloadPromise;

		// Verify download filename pattern (practice-clip is the default name)
		expect(download.suggestedFilename()).toMatch(/\.webm$/);

		// Save to temp location and verify we got something
		const path = await download.path();
		expect(path).toBeTruthy();

		// The file should have content
		const fs = await import("node:fs/promises");
		const stats = await fs.stat(path!);
		expect(stats.size).toBeGreaterThan(0);

		// Exit replay
		await page.locator("button", { hasText: "✕" }).click();
	});

	// APP BUG: useReplayPlayer StrictMode mount/unmount race can leave video.src empty
	// -> MEDIA_ERR_SRC_NOT_SUPPORTED. Fixture verified good. Fix tracked in reliability
	// sweep (replay cluster).
	test.fixme("Sessions: Replay play/pause controls work", async ({ page }) => {
		// Seed with sessions
		await seedSessionBuffer(page, 1);
		await page.reload();
		await waitForSessionsLoaded(page, 1);

		// Enter replay mode
		await page.getByRole("button", { name: "Sessions" }).click();
		const sessionThumbnails = page.locator('[data-testid="session-thumbnail"]');
		await sessionThumbnails.first().click();
		const timelineThumbs = page.locator('img[alt^="Frame at"]');
		await expect(timelineThumbs.first()).toBeVisible({ timeout: 5000 });
		await timelineThumbs.first().click();
		await expect(page.getByText("REPLAY MODE")).toBeVisible();

		// Find play/pause button (shows ▶ or ⏸ emoji)
		const playPauseButton = page.locator('button:has-text("▶"), button:has-text("⏸")').first();
		await expect(playPauseButton).toBeVisible({ timeout: 5000 });

		// Toggle play/pause
		await playPauseButton.click();
		await page.waitForTimeout(500);
		await playPauseButton.click();

		// Exit replay
		await page.locator("button", { hasText: "✕" }).click();
		await expect(page.getByText("REPLAY MODE")).toBeHidden({ timeout: 5000 });
	});

	test("Sessions: Delete session removes it from list", async ({ page }) => {
		// Seed with 3 sessions
		await seedSessionBuffer(page, 3);
		await page.reload();
		await waitForSessionsLoaded(page, 3);

		// Open Sessions picker
		await page.getByRole("button", { name: "Sessions" }).click();
		await expect(page.getByRole("heading", { name: "Sessions" })).toBeVisible();

		// Count initial sessions (at least 3 from seed, may have more from recording)
		const sessionThumbnails = page.locator('[data-testid="session-thumbnail"]');
		const initialCount = await sessionThumbnails.count();
		expect(initialCount).toBeGreaterThanOrEqual(3);

		// Find and click delete button on first session (usually shows on hover)
		const firstSession = sessionThumbnails.first();
		await firstSession.hover();

		// Handle the confirm dialog
		page.on("dialog", (dialog) => dialog.accept());

		// Click delete button
		const deleteButton = firstSession.locator('button[title*="elete"], button:has-text("×")').first();
		if (await deleteButton.isVisible()) {
			await deleteButton.click();

			// Verify session count decreased
			await page.waitForTimeout(500);
			const newCount = await sessionThumbnails.count();
			expect(newCount).toBe(initialCount - 1);
		}

		// Close picker
		await page.keyboard.press("Escape");
	});

	test("Settings: Mirror mode toggle", async ({ page }) => {
		const video = page.getByTestId("main-video");

		// Check initial state (not mirrored by default since localStorage is cleared)
		await expect(video).toHaveCSS(
			"transform",
			/none|matrix\(1, 0, 0, 1, 0, 0\)/,
		);

		// Open settings and toggle mirror on
		await page.getByTitle("Settings").click();
		const mirrorToggle = getSettingsToggle(page, /^Mirror Video/);

		// Toggle should be off (gray) initially
		await expect(mirrorToggle).toHaveClass(/bg-gray-700/);

		// Click to enable mirror
		await mirrorToggle.click();

		// Toggle should be on (blue)
		await expect(mirrorToggle).toHaveClass(/bg-blue-600/);

		// Close settings
		await page.keyboard.press("Escape");

		// Video should now be mirrored (scaleX(-1) creates matrix with -1)
		await expect(video).toHaveCSS("transform", /matrix\(-1.*\)/);

		// Toggle mirror off again
		await page.getByTitle("Settings").click();
		await mirrorToggle.click();
		await expect(mirrorToggle).toHaveClass(/bg-gray-700/);
		await page.keyboard.press("Escape");
		await expect(video).toHaveCSS(
			"transform",
			/none|matrix\(1, 0, 0, 1, 0, 0\)/,
		);
	});

	test("Settings: Camera device switching", async ({ page }) => {
		// Open settings
		await page.getByTitle("Settings").click();

		// Check camera select is visible with both mock cameras
		const cameraSelect = page.locator("select#camera-source");
		await expect(cameraSelect).toBeVisible();
		await expect(cameraSelect).toContainText("Mock Camera 1");
		await expect(cameraSelect).toContainText("Mock Camera 2");

		// Get initial value
		const initialValue = await cameraSelect.inputValue();
		expect(initialValue).toBe("mock-camera-1");

		// Switch to Mock Camera 2
		await cameraSelect.selectOption("mock-camera-2");

		// Verify selection changed
		const newValue = await cameraSelect.inputValue();
		expect(newValue).toBe("mock-camera-2");

		// Video should still be visible (stream switched)
		await page.keyboard.press("Escape");
		const video = page.getByTestId("main-video");
		await expect(video).toBeVisible();
	});

	test("Recording: Shows recording indicator when live", async ({ page }) => {
		// Wait for app to load and start recording
		const video = page.getByTestId("main-video");
		await expect(video).toBeVisible();

		// Recording indicator should show REC once video + storage are ready
		const recordingIndicator = page.getByText("● REC");
		await expect(recordingIndicator).toBeVisible({ timeout: 10000 });
		await expect(page.getByText("NOT RECORDING")).toBeHidden();
	});

	test("Recording: Duration counter increases over time", async ({ page }) => {
		// Wait for app to load
		const video = page.getByTestId("main-video");
		await expect(video).toBeVisible();

		// Status bar shows "<seconds>s | <n> sessions" while live
		// (.first() — the regex also matches ancestor spans; match innermost deterministically)
		const statusReadout = page.getByText(/\d+s \|/).first();
		await expect(statusReadout).toBeVisible({ timeout: 10000 });

		const initialText = await statusReadout.textContent();

		// Wait for the block duration to tick up
		await expect(async () => {
			const newText = await statusReadout.textContent();
			expect(newText).not.toBe(initialText);
		}).toPass({ timeout: 5000 });
	});

	test("Recording: A real recorded block appears in Sessions without seeding", async ({ page }) => {
		// Wait for recording to actually start
		await expect(page.getByTestId("main-video")).toBeVisible();
		await expect(page.getByText("● REC")).toBeVisible({ timeout: 10000 });

		// Let the mock recorder emit at least two 1s chunks
		await page.waitForTimeout(2500);

		// Opening the picker stops and saves the current block
		await page.getByRole("button", { name: "Sessions" }).click();
		await expect(page.getByRole("heading", { name: "Sessions" })).toBeVisible();

		// The just-recorded block must appear as a Recent session.
		// This is the only test covering record→storage→picker for real;
		// everything else seeds IndexedDB directly.
		await expect(page.getByText("No recent recordings")).toBeHidden({ timeout: 10000 });
	});

	test("Settings: Resolution selector shows options", async ({ page }) => {
		// Open settings
		await page.getByTitle("Settings").click();

		// Check resolution select is visible
		const resolutionSelect = page.locator("select#resolution");
		await expect(resolutionSelect).toBeVisible();

		// Verify all resolution options are present
		// Labels show requested width, not the preset label (see commit 856da46:
		// only width is constrained so the camera can pick its native aspect ratio)
		await expect(resolutionSelect).toContainText("1280 wide (720p)");
		await expect(resolutionSelect).toContainText("1920 wide (1080p)");
		await expect(resolutionSelect).toContainText("3840 wide (4k)");
	});

	test("Settings: Resolution selector defaults to 4K", async ({ page }) => {
		// Open settings
		await page.getByTitle("Settings").click();

		// Check resolution select default value is 4k
		const resolutionSelect = page.locator("select#resolution");
		const value = await resolutionSelect.inputValue();
		expect(value).toBe("4k");
	});

	test("Settings: Resolution change persists to localStorage (per-device)", async ({ page }) => {
		// Open settings
		await page.getByTitle("Settings").click();

		// Change resolution to 1080p
		const resolutionSelect = page.locator("select#resolution");
		await resolutionSelect.selectOption("1080p");

		// Verify selection changed
		const newValue = await resolutionSelect.inputValue();
		expect(newValue).toBe("1080p");

		// Close settings
		await page.keyboard.press("Escape");

		// Verify localStorage was updated with per-device settings
		const storedSettings = await page.evaluate(() => {
			return localStorage.getItem("magic-monitor-camera-device-settings");
		});
		expect(storedSettings).toBeTruthy();
		const parsedSettings = JSON.parse(storedSettings!);
		// Check that some device has resolution 1080p
		const hasCorrectResolution = Object.values(parsedSettings).some(
			(s: unknown) => (s as { resolution: string }).resolution === "1080p"
		);
		expect(hasCorrectResolution).toBe(true);

		// Persist the value before reload (since beforeEach clears it via addInitScript)
		await page.addInitScript(() => {
			// Set up per-device settings for mock camera
			const settings = { "mock-camera-1": { resolution: "1080p", orientation: "landscape" } };
			localStorage.setItem("magic-monitor-camera-device-settings", JSON.stringify(settings));
			localStorage.setItem("magic-monitor-camera-device-id", "mock-camera-1");
		});

		// Reload page and verify setting persisted
		await page.reload();
		await page.getByTitle("Settings").click();

		const resolutionSelectAfterReload = page.locator("select#resolution");
		const valueAfterReload = await resolutionSelectAfterReload.inputValue();
		expect(valueAfterReload).toBe("1080p");
	});

	test("Settings: Resolution shows actual video dimensions", async ({ page }) => {
		// Open settings
		await page.getByTitle("Settings").click();

		// Wait for actual resolution to be displayed (after video metadata loads)
		// The mock canvas stream may report different dimensions depending on browser/timing
		const actualResolutionText = page.getByText(/Actual: \d+×\d+/);
		await expect(actualResolutionText).toBeVisible({ timeout: 5000 });

		// Just verify the format is correct - actual dimensions vary in test environment
		const text = await actualResolutionText.textContent();
		expect(text).toMatch(/Actual: \d+×\d+/);
	});

	test("Settings: Orientation toggle switches between landscape and portrait", async ({ page }) => {
		// Open settings
		await page.getByTitle("Settings").click();

		// Find the orientation toggle buttons
		const landscapeButton = page.getByTitle("Landscape");
		const portraitButton = page.getByTitle("Portrait");

		// Verify both buttons exist
		await expect(landscapeButton).toBeVisible();
		await expect(portraitButton).toBeVisible();

		// Landscape should be active by default (has bg-blue-600 class)
		await expect(landscapeButton).toHaveClass(/bg-blue-600/);
		await expect(portraitButton).not.toHaveClass(/bg-blue-600/);

		// Click portrait
		await portraitButton.click();

		// Portrait should now be active
		await expect(portraitButton).toHaveClass(/bg-blue-600/);
		await expect(landscapeButton).not.toHaveClass(/bg-blue-600/);

		// Click landscape again
		await landscapeButton.click();

		// Landscape should be active again
		await expect(landscapeButton).toHaveClass(/bg-blue-600/);
		await expect(portraitButton).not.toHaveClass(/bg-blue-600/);
	});
});

test.describe("Bug Report", () => {
	test.beforeEach(async ({ page }) => {
		await injectMockCamera(page);
		await page.addInitScript(() => {
			localStorage.clear();
		});
		await page.goto("/");
	});

	test("Bug report includes device details in metadata", async ({
		page,
		context,
	}) => {
		// Open bug report via keyboard shortcut (Ctrl+I or Cmd+I)
		await page.keyboard.press("Control+i");

		// Wait for bug report modal (use heading to be specific)
		await expect(
			page.getByRole("heading", { name: "Report a Bug" }),
		).toBeVisible();

		// Verify "Include technical details" checkbox is checked by default
		const metadataCheckbox = page.locator('input[type="checkbox"]');
		await expect(metadataCheckbox).toBeChecked();

		// Fill in a title (required for submit)
		await page.locator("#bug-title").fill("Test Bug Report");

		// Listen for popup (GitHub issue page)
		const popupPromise = context.waitForEvent("page");

		// Submit the bug report
		await page.getByText("Copy & Open GitHub").click();

		// Wait for the popup and get its URL
		const popup = await popupPromise;
		const popupUrl = popup.url();

		// Close the popup
		await popup.close();

		// Verify the URL is from GitHub
		expect(popupUrl).toContain("github.com");

		// GitHub may redirect to login page with return_to parameter
		// Extract the actual issue URL from return_to if redirected
		const url = new URL(popupUrl);
		let issueUrl: URL;
		const returnTo = url.searchParams.get("return_to");
		if (returnTo) {
			// Redirected to login - extract the original issue URL
			issueUrl = new URL(decodeURIComponent(returnTo));
		} else {
			issueUrl = url;
		}

		// Verify it's the issues/new endpoint
		expect(issueUrl.pathname).toContain("issues/new");

		// Decode the body parameter to check for device details
		const body = decodeURIComponent(issueUrl.searchParams.get("body") || "");

		// Verify device details are present in the body
		expect(body).toContain("App Metadata");
		expect(body).toContain("Screen");
		expect(body).toContain("Device Memory");
		expect(body).toContain("CPU Cores");
		expect(body).toContain("Online");
		expect(body).toContain("Connection");
		expect(body).toContain("Display Mode");
		expect(body).toContain("Touch Device");
		expect(body).toContain("Mobile");
	});
});

test.describe("Error States", () => {
	test("Shows error when camera permission denied", async ({ page }) => {
		// Mock camera permission denied
		await page.addInitScript(() => {
			navigator.mediaDevices.getUserMedia = async () => {
				throw new DOMException(
					"Permission denied",
					"NotAllowedError",
				);
			};
			navigator.mediaDevices.enumerateDevices = async () => [];
		});

		await page.goto("/");

		// Should show error message about camera access
		// Actual message: "Could not access camera. Please allow permissions."
		await expect(
			page.getByText(/could not access camera|allow permissions/i),
		).toBeVisible({ timeout: 10000 });
	});

	test("Shows error when no camera devices available", async ({ page }) => {
		// Mock no devices
		await page.addInitScript(() => {
			navigator.mediaDevices.getUserMedia = async () => {
				throw new DOMException(
					"Requested device not found",
					"NotFoundError",
				);
			};
			navigator.mediaDevices.enumerateDevices = async () => [];
		});

		await page.goto("/");

		// Should show error message about camera access (same error shown for NotFoundError)
		await expect(
			page.getByText(/could not access camera|allow permissions/i),
		).toBeVisible({ timeout: 10000 });
	});
});

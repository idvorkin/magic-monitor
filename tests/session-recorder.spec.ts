import { expect, type Page, test } from "@playwright/test";
import {
	seedSessionBuffer,
	waitForSessionsLoaded,
} from "./helpers/seedSessionBuffer";

/**
 * Session Recorder E2E Tests
 *
 * These tests use a counter video mock that displays an incrementing counter
 * every second. This makes it easy to distinguish between:
 * - Live video (counter keeps incrementing)
 * - Recorded/replay video (counter shows historical values)
 * - Frozen video (counter stays the same)
 *
 * These tests are longer/slower and test the full recording flow.
 */

// Inject a mock camera that displays a counter
async function injectCounterCamera(page: Page) {
	await page.addInitScript(() => {
		const canvas = document.createElement("canvas");
		canvas.width = 1920;
		canvas.height = 1080;
		const ctx = canvas.getContext("2d");

		let counter = 0;
		let startTime = Date.now();

		function draw() {
			if (!ctx) return;

			// Update counter every second
			const elapsed = Math.floor((Date.now() - startTime) / 1000);
			counter = elapsed;

			// Clear with dark background
			ctx.fillStyle = "#1a1a2e";
			ctx.fillRect(0, 0, canvas.width, canvas.height);

			// Draw large counter in center
			ctx.fillStyle = "#00ff88";
			ctx.font = "bold 300px monospace";
			ctx.textAlign = "center";
			ctx.textBaseline = "middle";
			ctx.fillText(counter.toString().padStart(3, "0"), canvas.width / 2, canvas.height / 2);

			// Draw timestamp
			ctx.fillStyle = "#888";
			ctx.font = "40px monospace";
			ctx.fillText(`LIVE: ${new Date().toLocaleTimeString()}`, canvas.width / 2, 100);

			// Draw "COUNTER VIDEO" label
			ctx.fillStyle = "#666";
			ctx.font = "30px sans-serif";
			ctx.fillText("MOCK COUNTER VIDEO", canvas.width / 2, canvas.height - 50);

			requestAnimationFrame(draw);
		}

		draw();

		// Expose counter for test verification
		(window as unknown as Window & { counterCamera: { getCounter: () => number; reset: () => void } }).counterCamera = {
			getCounter: () => counter,
			reset: () => {
				startTime = Date.now();
				counter = 0;
			},
		};

		// Create stream
		function createMockStream() {
			return canvas.captureStream(30);
		}

		let activeStream = createMockStream();

		// Override getUserMedia
		if (!navigator.mediaDevices) {
			// @ts-expect-error - read-only property
			navigator.mediaDevices = {};
		}

		navigator.mediaDevices.getUserMedia = async () => {
			activeStream = createMockStream();
			return activeStream;
		};

		navigator.mediaDevices.enumerateDevices = async () => {
			return [
				{
					deviceId: "counter-camera",
					kind: "videoinput",
					label: "Counter Camera",
					groupId: "group1",
				},
			] as MediaDeviceInfo[];
		};

		// Mock MediaRecorder if needed
		const OriginalMediaRecorder = window.MediaRecorder;
		const mockRecordings = new Map<MediaRecorder, Blob[]>();

		class MockMediaRecorder {
			stream: MediaStream;
			state: "inactive" | "recording" | "paused" = "inactive";
			ondataavailable: ((event: BlobEvent) => void) | null = null;
			onstop: (() => void) | null = null;
			onerror: ((event: Event) => void) | null = null;

			constructor(stream: MediaStream, _opts?: MediaRecorderOptions) {
				void _opts;
				this.stream = stream;
				mockRecordings.set(this as unknown as MediaRecorder, []);
			}

			static isTypeSupported(mimeType: string): boolean {
				return mimeType.startsWith("video/webm");
			}

			start(timeslice?: number) {
				void timeslice;
				this.state = "recording";
				const generateData = () => {
					if (this.state === "recording" && this.ondataavailable) {
						const blob = new Blob(["mock-video-data"], { type: "video/webm" });
						const chunks = mockRecordings.get(this as unknown as MediaRecorder) || [];
						chunks.push(blob);
						this.ondataavailable({ data: blob } as BlobEvent);
					}
				};
				const intervalId = setInterval(generateData, 1000);
				(this as Record<string, unknown>)._intervalId = intervalId;
			}

			stop() {
				this.state = "inactive";
				const intervalId = (this as Record<string, unknown>)._intervalId as number;
				if (intervalId) clearInterval(intervalId);

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

		// Test if original works
		try {
			const testRecorder = new OriginalMediaRecorder(activeStream, { mimeType: "video/webm" });
			testRecorder.start();
			testRecorder.stop();
		} catch {
			// @ts-expect-error - overriding MediaRecorder
			window.MediaRecorder = MockMediaRecorder;
		}
	});
}

test.describe("Session Recorder with Counter Video", () => {
	test.beforeEach(async ({ page, context }) => {
		await injectCounterCamera(page);
		// Grant camera permission
		await context.grantPermissions(["camera"]);
		// Clear storage
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
	});

	test("Live video shows incrementing counter", async ({ page }) => {
		await page.goto("/");

		// Wait for video to load
		await page.waitForSelector('[data-testid="main-video"]', { state: "visible" });
		await page.waitForTimeout(2000); // Let counter increment

		// Get initial counter value
		const counter1 = await page.evaluate(() => {
			return (window as Window & { counterCamera?: { getCounter: () => number } }).counterCamera?.getCounter() ?? -1;
		});

		// Wait and check counter incremented
		await page.waitForTimeout(2000);

		const counter2 = await page.evaluate(() => {
			return (window as Window & { counterCamera?: { getCounter: () => number } }).counterCamera?.getCounter() ?? -1;
		});

		// Counter should have incremented
		expect(counter2).toBeGreaterThan(counter1);
	});

	test("Replay mode shows minimap when zoomed", async ({ page }) => {
		// Navigate first, then seed sessions
		await page.goto("/");
		await seedSessionBuffer(page, 1);
		await page.reload();
		await waitForSessionsLoaded(page, 1);

		// Wait for app to load
		await page.waitForSelector('[data-testid="main-video"]', { state: "visible", timeout: 30000 });

		// Open Sessions picker
		await page.getByRole("button", { name: "Sessions" }).click();
		await expect(page.getByRole("heading", { name: "Sessions" })).toBeVisible();

		// Click first session
		const sessionThumbnails = page.locator('[data-testid="session-thumbnail"]');
		await sessionThumbnails.first().click();

		// Click first thumbnail to enter replay mode
		const timelineThumbs = page.locator('img[alt^="Frame at"]');
		await expect(timelineThumbs.first()).toBeVisible({ timeout: 5000 });
		await timelineThumbs.first().click();

		// Verify in replay mode
		await expect(page.getByText("REPLAY MODE")).toBeVisible();

		// At zoom level 1, minimap should NOT be visible
		await expect(page.locator(".absolute.top-16.right-4")).toBeHidden();

		// Zoom in using scroll wheel on the video container
		const videoContainer = page.locator(".absolute.inset-0.flex.flex-col").first();
		await videoContainer.hover();

		// Scroll to zoom in
		await page.mouse.wheel(0, -300);
		await page.waitForTimeout(500);

		// Now minimap should be visible (zoom > 1)
		// The minimap has a yellow border viewport rectangle
		const minimap = page.locator(".aspect-video.bg-black\\/80");
		await expect(minimap).toBeVisible({ timeout: 3000 });

		// Zoom level indicator should also be visible
		await expect(page.locator("text=/\\d\\.\\dx/")).toBeVisible();

		// Exit replay
		await page.locator("button", { hasText: "✕" }).click();
		await expect(page.getByText("REPLAY MODE")).toBeHidden({ timeout: 5000 });
	});

	test("Replay controls are draggable", async ({ page }) => {
		// Navigate first, then seed sessions
		await page.goto("/");
		await seedSessionBuffer(page, 1);
		await page.reload();
		await waitForSessionsLoaded(page, 1);

		// Wait for app to load
		await page.waitForSelector('[data-testid="main-video"]', { state: "visible", timeout: 30000 });

		// Enter replay mode
		await page.getByRole("button", { name: "Sessions" }).click();
		const sessionThumbnails = page.locator('[data-testid="session-thumbnail"]');
		await sessionThumbnails.first().click();
		const timelineThumbs = page.locator('img[alt^="Frame at"]');
		await expect(timelineThumbs.first()).toBeVisible({ timeout: 5000 });
		await timelineThumbs.first().click();
		await expect(page.getByText("REPLAY MODE")).toBeVisible();

		// Controls are always docked (float/dock toggle was removed, eb54b7f) but
		// remain draggable via the grip handle
		const dragHandle = page.getByTitle("Drag to move");
		await expect(dragHandle).toBeVisible();

		const startBox = await dragHandle.boundingBox();
		expect(startBox).toBeTruthy();
		if (!startBox) return;

		const startX = startBox.x + startBox.width / 2;
		const startY = startBox.y + startBox.height / 2;

		// Drag the panel by (40, 30)
		await page.mouse.move(startX, startY);
		await page.mouse.down();
		await page.mouse.move(startX + 40, startY + 30, { steps: 5 });
		await page.mouse.up();

		const endBox = await dragHandle.boundingBox();
		expect(endBox).toBeTruthy();
		if (!endBox) return;

		// Panel should have moved from its original position
		expect(endBox.x).not.toBe(startBox.x);
		expect(endBox.y).not.toBe(startBox.y);

		// Exit replay
		await page.locator("button", { hasText: "✕" }).click();
	});

	test("Sessions picker scrolling works correctly", async ({ page }) => {
		// Navigate first, then seed many sessions
		await page.goto("/");
		await seedSessionBuffer(page, 10);
		await page.reload();
		await waitForSessionsLoaded(page, 10);

		// Wait for app to load
		await page.waitForSelector('[data-testid="main-video"]', { state: "visible", timeout: 30000 });

		// Open Sessions picker
		await page.getByRole("button", { name: "Sessions" }).click();
		await expect(page.getByRole("heading", { name: "Sessions" })).toBeVisible();

		// Should see session thumbnails
		const sessionThumbnails = page.locator('[data-testid="session-thumbnail"]');
		await expect(sessionThumbnails.first()).toBeVisible();

		// Count visible sessions
		const initialCount = await sessionThumbnails.count();
		expect(initialCount).toBeGreaterThanOrEqual(5);

		// Find the scrollable container (the modal content area)
		const scrollContainer = page.locator(".overflow-y-auto").first();

		// Scroll down in the sessions list
		await scrollContainer.evaluate((el) => {
			el.scrollTop = 500;
		});

		// Wait a moment for any lazy loading
		await page.waitForTimeout(300);

		// Sessions should still be visible after scroll
		await expect(sessionThumbnails.first()).toBeVisible();

		// Close picker
		await page.keyboard.press("Escape");
	});

	test("Thumbnail size buttons work", async ({ page }) => {
		// Navigate first, then seed sessions
		await page.goto("/");
		await seedSessionBuffer(page, 1);
		await page.reload();
		await waitForSessionsLoaded(page, 1);

		// Wait for app to load
		await page.waitForSelector('[data-testid="main-video"]', { state: "visible", timeout: 30000 });

		// Enter replay mode
		await page.getByRole("button", { name: "Sessions" }).click();
		const sessionThumbnails = page.locator('[data-testid="session-thumbnail"]');
		await sessionThumbnails.first().click();
		const timelineThumbs = page.locator('img[alt^="Frame at"]');
		await expect(timelineThumbs.first()).toBeVisible({ timeout: 5000 });
		await timelineThumbs.first().click();
		await expect(page.getByText("REPLAY MODE")).toBeVisible();

		// Find thumbnail size buttons
		const smallerButton = page.getByTitle("Smaller thumbnails");
		const largerButton = page.getByTitle("Larger thumbnails");

		await expect(smallerButton).toBeVisible();
		await expect(largerButton).toBeVisible();

		// Get initial thumbnail width
		const thumb = page.locator('img[alt^="Frame at"]').first();
		const initialWidth = await thumb.evaluate((el) => el.getBoundingClientRect().width);

		// Click larger button
		await largerButton.click();
		await page.waitForTimeout(200);

		// Thumbnail should be larger
		const largerWidth = await thumb.evaluate((el) => el.getBoundingClientRect().width);
		expect(largerWidth).toBeGreaterThanOrEqual(initialWidth);

		// Click smaller button twice
		await smallerButton.click();
		await smallerButton.click();
		await page.waitForTimeout(200);

		// Thumbnail should be smaller
		const smallerWidth = await thumb.evaluate((el) => el.getBoundingClientRect().width);
		expect(smallerWidth).toBeLessThanOrEqual(largerWidth);

		// Exit replay
		await page.locator("button", { hasText: "✕" }).click();
	});

	test("Scrubber drag updates playback position", async ({ page }) => {
		// Navigate first, then seed sessions
		await page.goto("/");
		await seedSessionBuffer(page, 1);
		await page.reload();
		await waitForSessionsLoaded(page, 1);

		// Wait for app to load
		await page.waitForSelector('[data-testid="main-video"]', { state: "visible", timeout: 30000 });

		// Enter replay mode
		await page.getByRole("button", { name: "Sessions" }).click();
		const sessionThumbnails = page.locator('[data-testid="session-thumbnail"]');
		await sessionThumbnails.first().click();
		const timelineThumbs = page.locator('img[alt^="Frame at"]');
		await expect(timelineThumbs.first()).toBeVisible({ timeout: 5000 });
		await timelineThumbs.first().click();
		await expect(page.getByText("REPLAY MODE")).toBeVisible();

		// Find the timeline track (the gray progress bar area)
		const timelineTrack = page.locator(".bg-gray-700.rounded-full").first();
		await expect(timelineTrack).toBeVisible();

		// Get the time display to monitor position changes.
		// `.font-mono` alone is ambiguous (also matches the empty status-bar div and
		// the "REPLAY MODE" banner), so scope to the element with the actual time text.
		const timeDisplay = page.locator(".font-mono", { hasText: /^\d+:\d{2}\.\d/ });
		await expect(timeDisplay).toBeVisible();

		// Get initial time
		const initialTime = await timeDisplay.textContent();

		// Get track bounds for calculating positions
		const trackBounds = await timelineTrack.boundingBox();
		expect(trackBounds).toBeTruthy();
		if (!trackBounds) return;

		// Click at 10% position
		const clickX = trackBounds.x + trackBounds.width * 0.1;
		const clickY = trackBounds.y + trackBounds.height / 2;
		await page.mouse.click(clickX, clickY);

		// Wait for UI update
		await page.waitForTimeout(100);

		// Get time after click
		const timeAfterClick = await timeDisplay.textContent();

		// Now test dragging: start at 10%, drag to 90%
		const startX = trackBounds.x + trackBounds.width * 0.1;
		const endX = trackBounds.x + trackBounds.width * 0.9;
		const midY = trackBounds.y + trackBounds.height / 2;

		// Perform drag operation
		await page.mouse.move(startX, midY);
		await page.mouse.down();

		// Drag across in small increments to simulate real drag
		for (let i = 0; i <= 5; i++) {
			const x = startX + (endX - startX) * (i / 5);
			await page.mouse.move(x, midY);
			await page.waitForTimeout(50);
		}

		await page.mouse.up();

		// Wait for UI update
		await page.waitForTimeout(200);

		// Get time after drag
		const timeAfterDrag = await timeDisplay.textContent();

		// The time should have changed from click to drag
		// If drag works, the final time should be near end (90%)
		// If drag doesn't work, it would stay at click position (10%)
		expect(timeAfterDrag).not.toBe(initialTime);
		expect(timeAfterDrag).not.toBe(timeAfterClick);

		// Exit replay
		await page.locator("button", { hasText: "✕" }).click();
		await expect(page.getByText("REPLAY MODE")).toBeHidden({ timeout: 5000 });
	});

	test("Trim controls set in/out points", async ({ page }) => {
		// Navigate first, then seed sessions
		await page.goto("/");
		await seedSessionBuffer(page, 1);
		await page.reload();
		await waitForSessionsLoaded(page, 1);

		// Wait for app to load
		await page.waitForSelector('[data-testid="main-video"]', { state: "visible", timeout: 30000 });

		// Enter replay mode
		await page.getByRole("button", { name: "Sessions" }).click();
		const sessionThumbnails = page.locator('[data-testid="session-thumbnail"]');
		await sessionThumbnails.first().click();
		const timelineThumbs = page.locator('img[alt^="Frame at"]');
		await expect(timelineThumbs.first()).toBeVisible({ timeout: 5000 });
		await timelineThumbs.first().click();
		await expect(page.getByText("REPLAY MODE")).toBeVisible();

		// Find In/Out buttons
		const inButton = page.locator('button[title="Set start point"]');
		const outButton = page.locator('button[title="Set end point"]');

		await expect(inButton).toBeVisible();
		await expect(outButton).toBeVisible();

		// In button should not be highlighted initially
		await expect(inButton).not.toHaveClass(/bg-green/);

		// Set in point
		await inButton.click();

		// In button should now be green
		await expect(inButton).toHaveClass(/bg-green-600/);

		// Seek forward using frame step
		const nextFrameButton = page.locator('button[aria-label="Next frame"]');
		for (let i = 0; i < 5; i++) {
			await nextFrameButton.click();
		}

		// Set out point
		await outButton.click();

		// Out button should be green
		await expect(outButton).toHaveClass(/bg-green-600/);

		// Preview and Clear buttons should appear
		await expect(page.locator('button[title="Preview trimmed clip"]')).toBeVisible();
		await expect(page.locator('button[title="Clear selection"]')).toBeVisible();

		// Clear selection
		await page.locator('button[title="Clear selection"]').click();

		// Buttons should reset
		await expect(inButton).not.toHaveClass(/bg-green-600/);
		await expect(outButton).not.toHaveClass(/bg-green-600/);

		// Exit replay
		await page.locator("button", { hasText: "✕" }).click();
	});
});

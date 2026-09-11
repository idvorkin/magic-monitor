import { expect, type Page, test } from "@playwright/test";

// Reusable mock-camera + MediaRecorder injection (verbatim from
// tests/magic-monitor.spec.ts injectMockCamera — required for headless Chromium)
async function injectMockCamera(page: Page) {
	await page.addInitScript(() => {
		const canvas = document.createElement("canvas");
		canvas.width = 1920;
		canvas.height = 1080;
		const ctx = canvas.getContext("2d");
		let currentColor = "pattern";
		function draw() {
			if (!ctx) return;
			if (currentColor === "pattern") {
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
				ctx.fillStyle = currentColor;
				ctx.fillRect(0, 0, canvas.width, canvas.height);
			}
			requestAnimationFrame(draw);
		}
		draw();
		(
			window as unknown as { mockCamera: { setColor: (c: string) => void } }
		).mockCamera = {
			setColor: (c: string) => {
				currentColor = c;
			},
		};
		function createMockStream() {
			return canvas.captureStream(30);
		}
		let activeStream = createMockStream();
		if (!navigator.mediaDevices) {
			// @ts-expect-error - mocking for tests
			navigator.mediaDevices = {};
		}
		navigator.mediaDevices.getUserMedia = async () => {
			activeStream = createMockStream();
			return activeStream;
		};
		navigator.mediaDevices.enumerateDevices = async () =>
			[
				{
					deviceId: "mock-camera-1",
					kind: "videoinput",
					label: "Mock Camera 1",
					groupId: "g1",
				},
				{
					deviceId: "mock-camera-2",
					kind: "videoinput",
					label: "Mock Camera 2",
					groupId: "g1",
				},
			] as MediaDeviceInfo[];
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
						const chunks =
							mockRecordings.get(this as unknown as MediaRecorder) || [];
						chunks.push(blob);
						this.ondataavailable({ data: blob } as BlobEvent);
					}
				};
				const intervalId = setInterval(generateData, 1000);
				(this as Record<string, unknown>)._intervalId = intervalId;
			}
			stop() {
				this.state = "inactive";
				const intervalId = (this as Record<string, unknown>)
					._intervalId as number;
				if (intervalId) clearInterval(intervalId);
				if (this.ondataavailable) {
					const blob = new Blob(["mock-video-final"], { type: "video/webm" });
					const chunks =
						mockRecordings.get(this as unknown as MediaRecorder) || [];
					chunks.push(blob);
					this.ondataavailable({ data: blob } as BlobEvent);
				}
				if (this.onstop) this.onstop();
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
		// @ts-expect-error - overriding MediaRecorder
		window.MediaRecorder = MockMediaRecorder;
	});
}

// Extract the scale(X) factor from a CSS transform string like
// "scaleX(-1) scale(2.5) translate(...)" or "scale(2.5) translate(...)".
function scaleOf(transform: string): number | null {
	const m = transform.match(/(?<!X)scale\(([^),]+)(?:,[^)]*)?\)/);
	if (!m) return null;
	const v = Number.parseFloat(m[1]);
	return Number.isNaN(v) ? null : v;
}

test.describe("zoom slider disables smart zoom (real-browser)", () => {
	test.beforeEach(async ({ page, context }) => {
		await injectMockCamera(page);
		// Mirror the existing suite: clear storage, unregister SW, set smart zoom ON.
		await page.addInitScript(() => {
			localStorage.clear();
			if ("serviceWorker" in navigator) {
				navigator.serviceWorker.getRegistrations().then((regs) => {
					for (const r of regs) r.unregister();
				});
			}
			localStorage.setItem("magic-monitor-smart-zoom", "true");
		});
		await context.clearCookies();
		await page.goto("/");
	});

	test("dragging the slider toggles smart zoom off and updates the video scale", async ({
		page,
	}) => {
		// Wait for the live video element (app mounted + camera ready)
		const video = page.getByTestId("main-video");
		await expect(video).toBeVisible();
		// Wait for the video to actually have a transform applied (app initialized)
		await expect
			.poll(
				async () =>
					video.evaluate((el) => (el as HTMLElement).style.transform || ""),
				{
					timeout: 10_000,
				},
			)
			.toContain("scale");

		const smartBtn = page.getByRole("button", { name: /Smart/ });
		await expect(smartBtn).toBeVisible();

		const slider = page.locator('input[type="range"]');
		await expect(slider).toBeVisible();

		const initialTransform = await video.evaluate(
			(el) => (el as HTMLElement).style.transform,
		);
		const initialScale = scaleOf(initialTransform);
		expect(initialScale).not.toBeNull();

		const before = Number.parseFloat(await slider.inputValue());
		const target = before >= 3 ? 1.5 : 4;
		expect(target).not.toBe(before);

		// Real keyboard-driven set via Playwright (fires onChange reliably cross-browser)
		await slider.fill(String(target));
		await page.waitForTimeout(300);

		// G4/G17: smart zoom should now be OFF => button text loses "✓"
		const smartTextAfter = (await smartBtn.textContent()) ?? "";
		expect(smartTextAfter).not.toContain("✓");

		// G6: slider value follows the drag (no snap-back)
		const sliderValueAfter = Number.parseFloat(await slider.inputValue());
		expect(sliderValueAfter).toBeCloseTo(target, 1);

		// G6: video transform scale now reflects the manual target, not the constant-1
		// smart-zoom value (during the model-loading window)
		const transformAfter = await video.evaluate(
			(el) => (el as HTMLElement).style.transform,
		);
		const scaleAfter = scaleOf(transformAfter);
		expect(scaleAfter).not.toBeNull();
		expect(scaleAfter as number).toBeCloseTo(target, 1);
		expect(scaleAfter).not.toEqual(initialScale);
	});

	test("Reset button resets zoom and keeps smart zoom off after slider use", async ({
		page,
	}) => {
		const video = page.getByTestId("main-video");
		await expect(video).toBeVisible();
		await expect
			.poll(
				async () =>
					video.evaluate((el) => (el as HTMLElement).style.transform || ""),
				{
					timeout: 10_000,
				},
			)
			.toContain("scale");

		const slider = page.locator('input[type="range"]');
		await expect(slider).toBeVisible();

		// Drag the slider to 4x (disables smart zoom per fix)
		await slider.fill("4");
		await page.waitForTimeout(300);
		expect(Number.parseFloat(await slider.inputValue())).toBeCloseTo(4, 1);

		// Click Reset
		await page.getByRole("button", { name: "Reset" }).click();
		await page.waitForTimeout(300);

		// G13: Zoom back to 1x
		expect(Number.parseFloat(await slider.inputValue())).toBeCloseTo(1, 1);
		const transform = await video.evaluate(
			(el) => (el as HTMLElement).style.transform,
		);
		expect(scaleOf(transform)).toBeCloseTo(1, 1);
	});

	test("no-regression: mouse wheel over the stage disables smart zoom and zooms", async ({
		page,
	}) => {
		// G12/G17: the wheel escape hatch still works (the wheel handler's onZoomChange path
		// is unchanged by this fix; this guards against an accidental regression in the
		// hook's wheel-useEffect).
		const video = page.getByTestId("main-video");
		await expect(video).toBeVisible();
		await expect
			.poll(
				async () =>
					video.evaluate((el) => (el as HTMLElement).style.transform || ""),
				{
					timeout: 10_000,
				},
			)
			.toContain("scale");

		const smartBtn = page.getByRole("button", { name: /Smart/ });
		await expect(smartBtn).toBeVisible();

		// Scroll up (negative deltaY) on the camera-stage root to zoom in.
		const stage = video.locator("..");
		await stage.hover();
		await page.mouse.wheel(0, -400);
		await page.waitForTimeout(300);

		// Smart zoom should be OFF after a manual wheel zoom
		const smartTextAfter = (await smartBtn.textContent()) ?? "";
		expect(smartTextAfter).not.toContain("✓");

		// Video scale should have increased above 1
		const transform = await video.evaluate(
			(el) => (el as HTMLElement).style.transform,
		);
		const scale = scaleOf(transform);
		expect(scale).not.toBeNull();
		expect(scale as number).toBeGreaterThan(1);
	});

	test("no-regression: SmartZoomToggle button independently toggles smart zoom off/on", async ({
		page,
	}) => {
		// G17: the SmartZoomToggle toolbar escape hatch still works (unaffected by the fix).
		const video = page.getByTestId("main-video");
		await expect(video).toBeVisible();
		await expect
			.poll(
				async () =>
					video.evaluate((el) => (el as HTMLElement).style.transform || ""),
				{
					timeout: 10_000,
				},
			)
			.toContain("scale");

		// Wait for the model to finish loading so the toggle is enabled (not "Downloading %").
		// Smart zoom is ON by default; the toggle shows "Smart ✓" when enabled & not loading.
		const smartBtn = page.getByRole("button", { name: /Smart/ });
		await expect(smartBtn).toBeVisible();

		// The toggle may be disabled during model loading. Wait for it to become enabled
		// (text becomes "Smart ✓" rather than "Downloading X%" / "Initializing...").
		await expect
			.poll(async () => (await smartBtn.textContent()) ?? "", {
				timeout: 30_000,
			})
			.toContain("Smart");

		// Click the Smart toggle to turn smart zoom OFF
		await smartBtn.click();
		await page.waitForTimeout(200);
		const offText = (await smartBtn.textContent()) ?? "";
		expect(offText).not.toContain("✓");

		// Click again to turn it back ON
		await smartBtn.click();
		await page.waitForTimeout(200);
		const onText = (await smartBtn.textContent()) ?? "";
		expect(onText).toContain("✓");
	});
});

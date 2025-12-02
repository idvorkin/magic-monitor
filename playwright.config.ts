import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
	testDir: "./tests",
	fullyParallel: true,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 2 : 0,
	workers: process.env.CI ? 1 : undefined,
	reporter: [
		["list"],
		["html", { outputFolder: "playwright-report" }],
	],
	use: {
		baseURL: "https://localhost:5173",
		trace: "on",
		video: "on",
		screenshot: "on",
		ignoreHTTPSErrors: true,
	},
	projects: [
		{
			name: "chromium",
			use: {
				...devices["Desktop Chrome"],
				headless: true,
			},
		},
		{
			name: "mobile",
			use: {
				...devices["iPhone 14 Pro"],
				headless: true,
			},
		},
	],
	// webServer: {
	// 	command: "npm run dev",
	// 	url: "http://localhost:5173",
	// 	reuseExistingServer: true,
	// 	timeout: 120 * 1000,
	// 	stdout: "ignore",
	// 	stderr: "pipe",
	// },
});

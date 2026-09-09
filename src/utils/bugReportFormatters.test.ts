import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Mutable mock for ../version — using getters so tests can change values
// per-test to verify credential stripping in formatBuildLink / buildCrashReportBody.
const versionMock = vi.hoisted(() => ({
	gitCommitUrl: "https://github.com/test/repo/commit/abcdef1234567890",
	gitShaShort: "abcdef1",
}));

vi.mock("../version", () => ({
	get GIT_COMMIT_URL() {
		return versionMock.gitCommitUrl;
	},
	get GIT_SHA_SHORT() {
		return versionMock.gitShaShort;
	},
	GIT_SHA: "abcdef1234567890abcdef1234567890abcdef12",
	GIT_CURRENT_URL: "https://github.com/test/repo/tree/main",
	GIT_BRANCH: "main",
	BUILD_TIMESTAMP: "2025-11-30T00:00:00Z",
}));

import {
	buildCrashReportBody,
	buildDefaultDescription,
	buildDefaultTitle,
	buildGitHubIssueUrl,
	buildIssueBody,
	formatBuildLink,
	formatDate,
	getMediaRecorderInfo,
	getMetadata,
	sanitizeGitUrl,
} from "./bugReportFormatters";

const CLEAN_COMMIT_URL = "https://github.com/test/repo/commit/abcdef1234567890";

describe("formatDate", () => {
	it("formats date in US locale", () => {
		const date = new Date("2025-11-29T12:00:00Z");
		expect(formatDate(date)).toBe("Nov 29, 2025");
	});

	it("uses current date when none provided", () => {
		const result = formatDate();
		expect(result).toMatch(/\w{3} \d{1,2}, \d{4}/);
	});
});

describe("buildDefaultTitle", () => {
	it("returns Bug", () => {
		expect(buildDefaultTitle()).toBe("Bug");
	});
});

describe("buildDefaultDescription", () => {
	const testDate = new Date("2025-11-29T12:00:00Z");

	it("includes date in description", () => {
		const result = buildDefaultDescription(testDate);
		expect(result).toContain("**Date:** Nov 29, 2025");
	});

	it("includes build info with linked commit", () => {
		const result = buildDefaultDescription(testDate);
		// Build info should always be a linked commit SHA
		expect(result).toContain("**Build:** [");
		expect(result).toContain("](");
	});

	it("includes prompts for user input", () => {
		const result = buildDefaultDescription(testDate);
		expect(result).toContain("**What were you trying to do?**");
		expect(result).toContain("**What happened instead?**");
		expect(result).toContain("**Steps to reproduce:**");
	});
});

describe("buildIssueBody", () => {
	const data = {
		title: "Bug",
		description: "Test description",
		includeMetadata: true,
	};

	const metadata = {
		route: "/test",
		userAgent: "TestBrowser/1.0",
		timestamp: "2025-11-29T12:00:00.000Z",
		appVersion: "1.0.0",
		screenWidth: 1920,
		screenHeight: 1080,
		devicePixelRatio: 2,
		deviceMemoryGB: 8,
		hardwareConcurrency: 8,
		isOnline: true,
		connectionType: "4g",
		displayMode: "browser",
		isTouchDevice: false,
		isMobile: false,
		mediaRecorder: {
			available: true,
			isIOSSafari: false,
			selectedCodec: "video/webm;codecs=vp9",
			supportedCodecs: ["video/webm;codecs=vp9", "video/webm"],
		},
	};

	it("includes description", () => {
		const result = buildIssueBody(data, metadata, {
			isMobile: false,
			hasScreenshot: false,
		});
		expect(result).toContain("Test description");
	});

	it("includes metadata table when enabled", () => {
		const result = buildIssueBody(data, metadata, {
			isMobile: false,
			hasScreenshot: false,
		});
		expect(result).toContain("**App Metadata**");
		expect(result).toContain("| Route | `/test` |");
		expect(result).toContain("| Browser | `TestBrowser/1.0` |");
	});

	it("includes device info in metadata table", () => {
		const result = buildIssueBody(data, metadata, {
			isMobile: false,
			hasScreenshot: false,
		});
		expect(result).toContain("| Screen | `1920x1080 @2x` |");
		expect(result).toContain("| Device Memory | `8 GB` |");
		expect(result).toContain("| CPU Cores | `8 cores` |");
		expect(result).toContain("| Online | `true` |");
		expect(result).toContain("| Connection | `4g` |");
		expect(result).toContain("| Display Mode | `browser` |");
		expect(result).toContain("| Touch Device | `false` |");
		expect(result).toContain("| Mobile | `false` |");
	});

	it("displays Unknown for null device memory", () => {
		const metadataWithNullMemory = { ...metadata, deviceMemoryGB: null };
		const result = buildIssueBody(data, metadataWithNullMemory, {
			isMobile: false,
			hasScreenshot: false,
		});
		expect(result).toContain("| Device Memory | `Unknown` |");
	});

	it("displays Unknown for null hardware concurrency", () => {
		const metadataWithNullCores = { ...metadata, hardwareConcurrency: null };
		const result = buildIssueBody(data, metadataWithNullCores, {
			isMobile: false,
			hasScreenshot: false,
		});
		expect(result).toContain("| CPU Cores | `Unknown` |");
	});

	it("displays Unknown for null connection type", () => {
		const metadataWithNullConnection = { ...metadata, connectionType: null };
		const result = buildIssueBody(data, metadataWithNullConnection, {
			isMobile: false,
			hasScreenshot: false,
		});
		expect(result).toContain("| Connection | `Unknown` |");
	});

	it("excludes metadata when disabled", () => {
		const result = buildIssueBody(
			{ ...data, includeMetadata: false },
			metadata,
			{ isMobile: false, hasScreenshot: false },
		);
		expect(result).not.toContain("**App Metadata**");
	});

	it("includes screenshot note on desktop with screenshot", () => {
		const result = buildIssueBody(data, metadata, {
			isMobile: false,
			hasScreenshot: true,
		});
		expect(result).toContain("**Screenshot**");
		expect(result).toContain("Screenshot is on your clipboard");
	});

	it("excludes screenshot note on mobile", () => {
		const result = buildIssueBody(data, metadata, {
			isMobile: true,
			hasScreenshot: true,
		});
		expect(result).not.toContain("**Screenshot**");
	});

	it("excludes screenshot note when no screenshot", () => {
		const result = buildIssueBody(data, metadata, {
			isMobile: false,
			hasScreenshot: false,
		});
		expect(result).not.toContain("**Screenshot**");
	});
});

describe("buildGitHubIssueUrl", () => {
	const repoUrl = "https://github.com/test/repo";

	it("builds valid URL with title and body", () => {
		const url = buildGitHubIssueUrl(repoUrl, "Bug Title", "Bug body");
		expect(url).toContain("https://github.com/test/repo/issues/new");
		expect(url).toContain("title=Bug+Title");
		expect(url).toContain("body=Bug+body");
	});

	it("includes default labels", () => {
		const url = buildGitHubIssueUrl(repoUrl, "Title", "Body");
		expect(url).toContain("labels=bug%2Cfrom-app");
	});

	it("supports custom labels", () => {
		const url = buildGitHubIssueUrl(repoUrl, "Title", "Body", [
			"custom",
			"labels",
		]);
		expect(url).toContain("labels=custom%2Clabels");
	});
});

describe("getMetadata", () => {
	const testDate = new Date("2025-11-29T12:00:00.000Z");

	const mockDeviceInfo = {
		getScreenWidth: () => 1920,
		getScreenHeight: () => 1080,
		getDevicePixelRatio: () => 2,
		getDeviceMemoryGB: () => 8,
		getHardwareConcurrency: () => 8,
		isOnline: () => true,
		getConnectionType: () => "4g",
		getDisplayMode: () => "browser",
		isTouchDevice: () => false,
		isMobileDevice: () => false,
	};

	it("returns metadata object with route, user agent, and device info", () => {
		const result = getMetadata(
			() => "/test-route",
			() => "TestAgent/1.0",
			mockDeviceInfo,
			testDate,
		);

		expect(result.route).toBe("/test-route");
		expect(result.userAgent).toBe("TestAgent/1.0");
		expect(result.timestamp).toBe("2025-11-29T12:00:00.000Z");
		// appVersion is now the build-time SHA (or "dev" in dev mode)
		expect(typeof result.appVersion).toBe("string");
		expect(result.appVersion.length).toBeGreaterThan(0);
		// Device info
		expect(result.screenWidth).toBe(1920);
		expect(result.screenHeight).toBe(1080);
		expect(result.devicePixelRatio).toBe(2);
		expect(result.deviceMemoryGB).toBe(8);
		expect(result.hardwareConcurrency).toBe(8);
		expect(result.isOnline).toBe(true);
		expect(result.connectionType).toBe("4g");
		expect(result.displayMode).toBe("browser");
		expect(result.isTouchDevice).toBe(false);
		expect(result.isMobile).toBe(false);
	});

	it("uses provided getters", () => {
		let routeCalled = false;
		let agentCalled = false;

		getMetadata(
			() => {
				routeCalled = true;
				return "/";
			},
			() => {
				agentCalled = true;
				return "Agent";
			},
			mockDeviceInfo,
			testDate,
		);

		expect(routeCalled).toBe(true);
		expect(agentCalled).toBe(true);
	});
});

describe("getMediaRecorderInfo", () => {
	// Mock MediaRecorder for basic tests
	class MockMediaRecorder {
		static isTypeSupported(mimeType: string): boolean {
			return mimeType.includes("webm");
		}
	}

	beforeAll(() => {
		// @ts-expect-error - Mock MediaRecorder for testing
		globalThis.MediaRecorder = MockMediaRecorder;
	});

	it("returns expected structure", () => {
		const result = getMediaRecorderInfo();

		expect(result).toHaveProperty("available");
		expect(result).toHaveProperty("isIOSSafari");
		expect(result).toHaveProperty("selectedCodec");
		expect(result).toHaveProperty("supportedCodecs");
	});

	it("returns safe defaults when MediaRecorder throws", () => {
		// Save original
		const originalMediaRecorder = globalThis.MediaRecorder;

		// Create a mock that throws
		// @ts-expect-error - Mock MediaRecorder for testing
		globalThis.MediaRecorder = class {
			static isTypeSupported(): boolean {
				throw new Error("Test error");
			}
		};

		// Suppress console.error for this test
		const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		const result = getMediaRecorderInfo();

		// Should return safe defaults instead of throwing
		expect(result.available).toBe(false);
		expect(result.isIOSSafari).toBe(false);
		expect(result.selectedCodec).toBe("(error during detection)");
		expect(result.supportedCodecs).toEqual([]);

		// Should have logged the error
		expect(consoleSpy).toHaveBeenCalledWith(
			"[BugReport] Failed to collect MediaRecorder info:",
			expect.any(Error),
		);

		// Cleanup
		consoleSpy.mockRestore();
		(globalThis as Record<string, unknown>).MediaRecorder =
			originalMediaRecorder;
	});
});

describe("sanitizeGitUrl", () => {
	it("returns clean HTTPS URL unchanged", () => {
		const url = "https://github.com/owner/repo/commit/abc123";
		expect(sanitizeGitUrl(url)).toBe(url);
	});

	it("strips user:password@ userinfo", () => {
		expect(
			sanitizeGitUrl("https://user:secret@github.com/owner/repo/commit/abc123"),
		).toBe("https://github.com/owner/repo/commit/abc123");
	});

	it("strips token-only userinfo (no password)", () => {
		expect(
			sanitizeGitUrl("https://token@github.com/owner/repo/commit/abc123"),
		).toBe("https://github.com/owner/repo/commit/abc123");
	});

	it("strips GitHub App token userinfo", () => {
		expect(
			sanitizeGitUrl(
				"https://x-access-token:ghs_123@github.com/owner/repo/commit/abc123",
			),
		).toBe("https://github.com/owner/repo/commit/abc123");
	});

	it("preserves URL with port after stripping userinfo", () => {
		expect(
			sanitizeGitUrl(
				"https://user:pass@github.com:8443/owner/repo/commit/abc123",
			),
		).toBe("https://github.com:8443/owner/repo/commit/abc123");
	});

	it("handles empty userinfo (@ with no credentials)", () => {
		expect(sanitizeGitUrl("https://@github.com/owner/repo/commit/abc123")).toBe(
			"https://github.com/owner/repo/commit/abc123",
		);
	});

	it("does not touch @ in path or query string", () => {
		const url =
			"https://github.com/owner/repo/issues/new?body=%40user&user=test%40example.com";
		expect(sanitizeGitUrl(url)).toBe(url);
	});

	it("only strips the first userinfo segment (before first slash)", () => {
		const url =
			"https://user:pass@github.com/owner/repo/commit/abc?ref=test%40rev";
		expect(sanitizeGitUrl(url)).toBe(
			"https://github.com/owner/repo/commit/abc?ref=test%40rev",
		);
	});
});

describe("formatBuildLink", () => {
	beforeEach(() => {
		versionMock.gitCommitUrl = CLEAN_COMMIT_URL;
		versionMock.gitShaShort = "abcdef1";
	});

	it("renders as markdown link with SHA and commit URL", () => {
		expect(formatBuildLink()).toBe(`[abcdef1](${CLEAN_COMMIT_URL})`);
	});

	it("strips credentials from credential-bearing GIT_COMMIT_URL", () => {
		versionMock.gitCommitUrl =
			"https://user:secret@github.com/test/repo/commit/abcdef1234567890";
		const result = formatBuildLink();
		expect(result).not.toContain("user:secret@");
		expect(result).not.toContain("secret");
		expect(result).toBe(`[abcdef1](${CLEAN_COMMIT_URL})`);
	});

	it("strips GitHub App token credentials", () => {
		versionMock.gitCommitUrl =
			"https://x-access-token:ghs_987401_jwt@github.com/test/repo/commit/abcdef1234567890";
		const result = formatBuildLink();
		expect(result).not.toContain("x-access-token");
		expect(result).not.toContain("ghs_987401_jwt");
		expect(result).toBe(`[abcdef1](${CLEAN_COMMIT_URL})`);
	});

	it("preserves clean URL without modification", () => {
		expect(formatBuildLink()).toBe(`[abcdef1](${CLEAN_COMMIT_URL})`);
	});
});

const crashMetadata = {
	route: "/test",
	userAgent: "TestBrowser/1.0",
	timestamp: "2025-11-29T12:00:00.000Z",
	appVersion: "1.0.0",
	screenWidth: 1920,
	screenHeight: 1080,
	devicePixelRatio: 2,
	deviceMemoryGB: 8,
	hardwareConcurrency: 8,
	isOnline: true,
	connectionType: "4g",
	displayMode: "browser",
	isTouchDevice: false,
	isMobile: false,
	mediaRecorder: {
		available: true,
		isIOSSafari: false,
		selectedCodec: "video/webm;codecs=vp9",
		supportedCodecs: ["video/webm;codecs=vp9", "video/webm"],
	},
};

describe("buildCrashReportBody", () => {
	beforeEach(() => {
		versionMock.gitCommitUrl = CLEAN_COMMIT_URL;
		versionMock.gitShaShort = "abcdef1";
	});

	it("includes build link in **Build:** line", () => {
		const body = buildCrashReportBody(new Error("Test error"), crashMetadata);
		expect(body).toContain("**Build:** [abcdef1](");
		expect(body).toContain(CLEAN_COMMIT_URL);
	});

	it("includes build link in App Version table row", () => {
		const body = buildCrashReportBody(new Error("Test error"), crashMetadata);
		expect(body).toContain("| App Version | [abcdef1](");
		expect(body).toContain(CLEAN_COMMIT_URL);
	});

	it("does not contain credentials when GIT_COMMIT_URL has userinfo", () => {
		versionMock.gitCommitUrl =
			"https://user:secret@github.com/test/repo/commit/abcdef1234567890";
		const body = buildCrashReportBody(new Error("Boom"), crashMetadata);
		expect(body).not.toContain("user:secret@");
		expect(body).not.toContain("secret");
		expect(body).toContain(CLEAN_COMMIT_URL);
		expect(body).not.toContain("user:secret");
	});

	it("does not contain GitHub App token when GIT_COMMIT_URL has one", () => {
		versionMock.gitCommitUrl =
			"https://x-access-token:ghs_987401_jwt@github.com/test/repo/commit/abcdef1234567890";
		const body = buildCrashReportBody(new Error("Boom"), crashMetadata);
		expect(body).not.toContain("x-access-token");
		expect(body).not.toContain("ghs_987401_jwt");
		expect(body).toContain(CLEAN_COMMIT_URL);
	});

	it("both build link occurrences are sanitized", () => {
		versionMock.gitCommitUrl =
			"https://user:secret@github.com/test/repo/commit/abcdef1234567890";
		const body = buildCrashReportBody(new Error("Boom"), crashMetadata);
		// Should appear exactly twice (Build line + App Version row) without credentials
		const cleanLinkCount = (body.match(/\[abcdef1\]\(/g) || []).length;
		expect(cleanLinkCount).toBe(2);
		expect(body).not.toContain("user:secret");
	});

	it("includes error message and stack trace", () => {
		const error = new Error("Test crash");
		const body = buildCrashReportBody(error, crashMetadata);
		expect(body).toContain("**Error:** Test crash");
		expect(body).toContain("**Stack Trace:**");
	});
});

describe("buildDefaultDescription credential stripping", () => {
	beforeEach(() => {
		versionMock.gitCommitUrl = CLEAN_COMMIT_URL;
		versionMock.gitShaShort = "abcdef1";
	});

	it("does not contain credentials when GIT_COMMIT_URL has userinfo", () => {
		versionMock.gitCommitUrl =
			"https://user:secret@github.com/test/repo/commit/abcdef1234567890";
		const result = buildDefaultDescription(new Date("2025-11-29T12:00:00Z"));
		expect(result).not.toContain("user:secret@");
		expect(result).not.toContain("secret");
		expect(result).toContain(CLEAN_COMMIT_URL);
	});
});

describe("buildGitHubIssueUrl credential stripping end-to-end", () => {
	beforeEach(() => {
		versionMock.gitCommitUrl = CLEAN_COMMIT_URL;
		versionMock.gitShaShort = "abcdef1";
	});

	it("prefilled issue URL body has no credentials when GIT_COMMIT_URL has userinfo", () => {
		versionMock.gitCommitUrl =
			"https://user:secret@github.com/test/repo/commit/abcdef1234567890";
		const body = buildCrashReportBody(new Error("Boom"), crashMetadata);
		const issueUrl = buildGitHubIssueUrl(
			"https://github.com/test/repo",
			"Crash: Boom",
			body,
			["bug", "crash"],
		);
		const decodedBody = decodeURIComponent(
			new URL(issueUrl).searchParams.get("body") || "",
		);
		expect(decodedBody).not.toContain("user:secret@");
		expect(decodedBody).not.toContain("secret");
		expect(decodedBody).toContain(CLEAN_COMMIT_URL);
	});
});

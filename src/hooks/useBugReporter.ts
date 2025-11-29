import { useCallback, useEffect, useState } from "react";
import { DeviceService } from "../services/DeviceService";

const GITHUB_REPO_URL = "https://github.com/idvorkin/magic-monitor";
const STORAGE_KEY_SHAKE_ENABLED = "bug-report-shake-enabled";
const STORAGE_KEY_FIRST_TIME = "bug-report-first-time-shown";

export interface BugReportData {
	title: string;
	description: string;
	includeMetadata: boolean;
	screenshot?: string; // base64 data URL
}

export interface BugReportMetadata {
	route: string;
	userAgent: string;
	timestamp: string;
	appVersion: string;
}

interface LatestCommit {
	sha: string;
	message: string;
	url: string;
}

function getMetadata(): BugReportMetadata {
	return {
		route: DeviceService.getCurrentRoute(),
		userAgent: DeviceService.getUserAgent(),
		timestamp: new Date().toISOString(),
		appVersion: "0.0.0", // Could be injected at build time
	};
}

function formatDate(): string {
	return new Date().toLocaleDateString("en-US", {
		month: "short",
		day: "numeric",
		year: "numeric",
	});
}

function buildDefaultTitle(): string {
	return "Bug";
}

function buildDefaultDescription(latestCommit: LatestCommit | null): string {
	const date = formatDate();
	const versionLine = latestCommit
		? `**Latest version:** [${latestCommit.sha}](${latestCommit.url}) - ${latestCommit.message}`
		: `**Latest version:** [${GITHUB_REPO_URL}](${GITHUB_REPO_URL})`;

	return `**Date:** ${date}

${versionLine}

**What were you trying to do?**


**What happened instead?**


**Steps to reproduce:**
1.
`;
}

function buildIssueBody(
	data: BugReportData,
	metadata: BugReportMetadata,
): string {
	let body = data.description;

	if (data.includeMetadata) {
		body += `

---

**App Metadata**
| Field | Value |
|-------|-------|
| Route | \`${metadata.route}\` |
| App Version | \`${metadata.appVersion}\` |
| Browser | \`${metadata.userAgent}\` |
| Timestamp | \`${metadata.timestamp}\` |
`;
	}

	if (data.screenshot && !DeviceService.isMobileDevice()) {
		body += `
**Screenshot**
_(Screenshot is on your clipboard - paste it here with Ctrl+V / Cmd+V)_
`;
	}

	return body;
}

export function useBugReporter() {
	const [isOpen, setIsOpen] = useState(false);
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [latestCommit, setLatestCommit] = useState<LatestCommit | null>(null);

	// Fetch latest commit on mount
	useEffect(() => {
		DeviceService.fetchLatestCommit(GITHUB_REPO_URL).then(setLatestCommit);
	}, []);

	// Shake detection preference
	const [shakeEnabled, setShakeEnabledState] = useState(() => {
		return DeviceService.getStorageItem(STORAGE_KEY_SHAKE_ENABLED) === "true";
	});

	const [isFirstTime, setIsFirstTimeState] = useState(() => {
		return DeviceService.getStorageItem(STORAGE_KEY_FIRST_TIME) !== "shown";
	});

	const setShakeEnabled = useCallback((enabled: boolean) => {
		setShakeEnabledState(enabled);
		DeviceService.setStorageItem(STORAGE_KEY_SHAKE_ENABLED, String(enabled));
	}, []);

	const markFirstTimeShown = useCallback(() => {
		setIsFirstTimeState(false);
		DeviceService.setStorageItem(STORAGE_KEY_FIRST_TIME, "shown");
	}, []);

	const open = useCallback(() => setIsOpen(true), []);
	const close = useCallback(() => setIsOpen(false), []);

	const getDefaultData = useCallback((): BugReportData => {
		return {
			title: buildDefaultTitle(),
			description: buildDefaultDescription(latestCommit),
			includeMetadata: true,
		};
	}, [latestCommit]);

	const submit = useCallback(async (data: BugReportData) => {
		setIsSubmitting(true);
		try {
			const metadata = getMetadata();
			const body = buildIssueBody(data, metadata);

			// Build the issue URL with pre-filled data
			const issueUrl = new URL(`${GITHUB_REPO_URL}/issues/new`);
			issueUrl.searchParams.set("title", data.title);
			issueUrl.searchParams.set("body", body);
			issueUrl.searchParams.set("labels", "bug,from-app");

			// Desktop: copy screenshot to clipboard if available
			let hasScreenshotOnClipboard = false;
			if (data.screenshot && !DeviceService.isMobileDevice()) {
				hasScreenshotOnClipboard = await DeviceService.copyImageToClipboard(
					data.screenshot,
				);
			}

			if (!hasScreenshotOnClipboard) {
				// Fallback: copy text if no screenshot or on mobile
				const clipboardText = `Title: ${data.title}\n\n${body}`;
				await DeviceService.copyToClipboard(clipboardText);
			}

			// Open GitHub in new tab
			DeviceService.openInNewTab(issueUrl.toString());

			return { success: true, hasScreenshotOnClipboard };
		} catch (error) {
			console.error("Failed to submit bug report:", error);
			return { success: false, error };
		} finally {
			setIsSubmitting(false);
		}
	}, []);

	return {
		isOpen,
		open,
		close,
		submit,
		isSubmitting,
		getDefaultData,
		shakeEnabled,
		setShakeEnabled,
		isFirstTime,
		markFirstTimeShown,
		githubRepoUrl: GITHUB_REPO_URL,
	};
}

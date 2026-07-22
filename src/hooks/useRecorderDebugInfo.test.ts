import { renderHook } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { MediaRecorderServiceType } from "../services/MediaRecorderService";
import { useRecorderDebugInfo } from "./useRecorderDebugInfo";

// Mock MediaRecorder globally
class MockMediaRecorder {
	static isTypeSupported(mimeType: string): boolean {
		return mimeType.includes("webm");
	}
}

beforeAll(() => {
	// @ts-expect-error - Mock MediaRecorder for testing
	globalThis.MediaRecorder = MockMediaRecorder;
});

describe("useRecorderDebugInfo", () => {
	const originalUserAgent = navigator.userAgent;

	afterEach(() => {
		// Restore original user agent
		Object.defineProperty(navigator, "userAgent", {
			value: originalUserAgent,
			configurable: true,
		});
	});

	const mockMediaRecorderService: MediaRecorderServiceType = {
		isTypeSupported: vi.fn((mimeType: string) => mimeType.includes("webm")),
		isIOSSafari: vi.fn(() => false),
		getBestCodec: vi.fn(() => "video/webm;codecs=vp9"),
		startRecording: vi.fn(),
	};

	it("should return expected structure", () => {
		const { result } = renderHook(() =>
			useRecorderDebugInfo(mockMediaRecorderService),
		);

		expect(result.current).toHaveProperty("hasMediaRecorder");
		expect(result.current).toHaveProperty("hasIsTypeSupported");
		expect(result.current).toHaveProperty("selectedCodec");
		expect(result.current).toHaveProperty("codecTests");
		expect(result.current).toHaveProperty("userAgent");
		expect(result.current).toHaveProperty("isIOS");
		expect(result.current).toHaveProperty("isSafari");
		expect(result.current).toHaveProperty("iosVersion");
	});

	it("should detect MediaRecorder availability", () => {
		const { result } = renderHook(() =>
			useRecorderDebugInfo(mockMediaRecorderService),
		);

		expect(result.current.hasMediaRecorder).toBe(true);
		expect(result.current.hasIsTypeSupported).toBe(true);
	});

	it("should return selected codec from service", () => {
		const { result } = renderHook(() =>
			useRecorderDebugInfo(mockMediaRecorderService),
		);

		expect(result.current.selectedCodec).toBe("video/webm;codecs=vp9");
		expect(mockMediaRecorderService.getBestCodec).toHaveBeenCalled();
	});

	it("should test all codecs", () => {
		const { result } = renderHook(() =>
			useRecorderDebugInfo(mockMediaRecorderService),
		);

		expect(result.current.codecTests.length).toBeGreaterThan(0);

		// Should include common codec tests
		const mimeTypes = result.current.codecTests.map((c) => c.mimeType);
		expect(mimeTypes).toContain("video/webm;codecs=vp9");
		expect(mimeTypes).toContain("video/mp4;codecs=avc1.42E01E");
	});

	it("should detect iOS from user agent", () => {
		Object.defineProperty(navigator, "userAgent", {
			value:
				"Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
			configurable: true,
		});

		const { result } = renderHook(() =>
			useRecorderDebugInfo(mockMediaRecorderService),
		);

		expect(result.current.isIOS).toBe(true);
		expect(result.current.isSafari).toBe(true);
		expect(result.current.iosVersion).toBe("17.0");
	});

	it("should detect iPad from user agent", () => {
		Object.defineProperty(navigator, "userAgent", {
			value:
				"Mozilla/5.0 (iPad; CPU OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1",
			configurable: true,
		});

		const { result } = renderHook(() =>
			useRecorderDebugInfo(mockMediaRecorderService),
		);

		expect(result.current.isIOS).toBe(true);
		expect(result.current.isSafari).toBe(true);
		expect(result.current.iosVersion).toBe("16.6");
	});

	it("should not detect iOS for desktop browsers", () => {
		Object.defineProperty(navigator, "userAgent", {
			value:
				"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
			configurable: true,
		});

		const { result } = renderHook(() =>
			useRecorderDebugInfo(mockMediaRecorderService),
		);

		expect(result.current.isIOS).toBe(false);
		expect(result.current.isSafari).toBe(false);
		expect(result.current.iosVersion).toBeNull();
	});

	it("should handle Chrome on iOS (not Safari)", () => {
		Object.defineProperty(navigator, "userAgent", {
			value:
				"Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0.6099.119 Mobile/15E148 Safari/604.1 Chrome/120.0",
			configurable: true,
		});

		const { result } = renderHook(() =>
			useRecorderDebugInfo(mockMediaRecorderService),
		);

		expect(result.current.isIOS).toBe(true);
		// Chrome on iOS has "Chrome" in UA, so isSafari should be false
		expect(result.current.isSafari).toBe(false);
	});

	it("should handle missing MediaRecorder", () => {
		const originalMediaRecorder = globalThis.MediaRecorder;
		// biome-ignore lint/performance/noDelete: testing missing API
		delete (globalThis as Record<string, unknown>).MediaRecorder;

		const { result } = renderHook(() =>
			useRecorderDebugInfo(mockMediaRecorderService),
		);

		expect(result.current.hasMediaRecorder).toBe(false);
		expect(result.current.hasIsTypeSupported).toBe(false);

		// Restore
		(globalThis as Record<string, unknown>).MediaRecorder = originalMediaRecorder;
	});

	it("should mark all codecs as unsupported when MediaRecorder unavailable", () => {
		const originalMediaRecorder = globalThis.MediaRecorder;
		// biome-ignore lint/performance/noDelete: testing missing API
		delete (globalThis as Record<string, unknown>).MediaRecorder;

		const { result } = renderHook(() =>
			useRecorderDebugInfo(mockMediaRecorderService),
		);

		// All non-empty codecs should be unsupported
		const nonEmptyCodecs = result.current.codecTests.filter(
			(c) => !c.mimeType.includes("empty"),
		);
		for (const codec of nonEmptyCodecs) {
			expect(codec.supported).toBe(false);
		}

		// Restore
		(globalThis as Record<string, unknown>).MediaRecorder = originalMediaRecorder;
	});
});

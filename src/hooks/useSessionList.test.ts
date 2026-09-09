import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PracticeSession } from "../types/sessions";
import { useSessionList } from "./useSessionList";

function createMockSessionStorage() {
	return {
		init: vi.fn().mockResolvedValue(undefined),
		getRecentSessions: vi.fn().mockResolvedValue([]),
		getSavedSessions: vi.fn().mockResolvedValue([]),
		saveSession: vi.fn().mockResolvedValue("test-id"),
		saveBlob: vi.fn().mockResolvedValue(undefined),
		saveSessionWithBlob: vi.fn().mockResolvedValue("test-id"),
		pruneOldSessions: vi.fn().mockResolvedValue(0),
		getSession: vi.fn(),
		getBlob: vi.fn(),
		deleteSession: vi.fn(),
		deleteBlob: vi.fn(),
		deleteSessionWithBlob: vi.fn(),
		deleteSessionIfUnsaved: vi.fn().mockResolvedValue(true),
		updateSession: vi.fn(),
		markAsSaved: vi.fn(),
		setTrimPoints: vi.fn(),
		getAllSessions: vi.fn(),
		getStorageUsage: vi.fn(),
		clear: vi.fn(),
		close: vi.fn(),
	};
}

function createMockVideoFix() {
	return {
		fixDuration: vi
			.fn()
			.mockImplementation((blob) =>
				Promise.resolve({ blob, wasFixed: true }),
			),
		needsFix: vi.fn().mockReturnValue(true),
	};
}

// Mock ThumbnailCaptureService
vi.mock("../services/ThumbnailCaptureService", () => ({
	ThumbnailCaptureService: {
		captureFromVideo: vi.fn(),
		captureAtTime: vi
			.fn()
			.mockResolvedValue("data:image/jpeg;base64,firstframe"),
	},
}));

describe("useSessionList", () => {
	let mockStorage: ReturnType<typeof createMockSessionStorage>;
	let mockVideoFix: ReturnType<typeof createMockVideoFix>;

	beforeEach(() => {
		vi.clearAllMocks();
		mockStorage = createMockSessionStorage();
		mockVideoFix = createMockVideoFix();
	});

	it("initializes storage on mount", async () => {
		renderHook(() =>
			useSessionList({
				sessionStorageService: mockStorage,
				videoFixService: mockVideoFix,
			}),
		);

		await waitFor(() => {
			expect(mockStorage.init).toHaveBeenCalled();
		});
	});

	it("sets isInitialized to true after successful init", async () => {
		const { result } = renderHook(() =>
			useSessionList({
				sessionStorageService: mockStorage,
				videoFixService: mockVideoFix,
			}),
		);

		// Initially false
		expect(result.current.isInitialized).toBe(false);

		await waitFor(() => {
			expect(result.current.isInitialized).toBe(true);
		});
	});

	it("keeps isInitialized false when init fails", async () => {
		mockStorage.init.mockRejectedValue(new Error("Storage unavailable"));

		const { result } = renderHook(() =>
			useSessionList({
				sessionStorageService: mockStorage,
				videoFixService: mockVideoFix,
			}),
		);

		await waitFor(() => {
			expect(result.current.error).not.toBeNull();
		});

		// isInitialized should remain false on error
		expect(result.current.isInitialized).toBe(false);
	});

	it("loads recent and saved sessions on init", async () => {
		const mockSessions: PracticeSession[] = [
			{
				id: "1",
				createdAt: Date.now(),
				duration: 60,
				blobKey: "blob-1",
				thumbnail: "data:test",
				thumbnails: [],
				saved: false,
			},
		];
		mockStorage.getRecentSessions.mockResolvedValue(mockSessions);

		const { result } = renderHook(() =>
			useSessionList({
				sessionStorageService: mockStorage,
				videoFixService: mockVideoFix,
			}),
		);

		await waitFor(() => {
			expect(result.current.recentSessions).toEqual(mockSessions);
		});
	});

	it("sets error state when storage init fails", async () => {
		mockStorage.init.mockRejectedValue(new Error("Storage unavailable"));

		const { result } = renderHook(() =>
			useSessionList({
				sessionStorageService: mockStorage,
				videoFixService: mockVideoFix,
			}),
		);

		await waitFor(() => {
			expect(result.current.error).toBe("Storage unavailable - recording disabled");
		});
	});

	it("refreshes sessions", async () => {
		const { result } = renderHook(() =>
			useSessionList({
				sessionStorageService: mockStorage,
				videoFixService: mockVideoFix,
			}),
		);

		await waitFor(() => {
			expect(mockStorage.getRecentSessions).toHaveBeenCalledTimes(1);
		});

		await result.current.refreshSessions();

		expect(mockStorage.getRecentSessions).toHaveBeenCalledTimes(2);
		expect(mockStorage.getSavedSessions).toHaveBeenCalledTimes(2);
	});

	it("saves block with video fix", async () => {
		const { result } = renderHook(() =>
			useSessionList({
				sessionStorageService: mockStorage,
				videoFixService: mockVideoFix,
			}),
		);

		await waitFor(() => {
			expect(mockStorage.init).toHaveBeenCalled();
		});

		const blob = new Blob(["test"], { type: "video/webm" });
		const thumbnails = [
			{ time: 0, dataUrl: "data:image/jpeg;base64,thumb1" },
		];
		const session = await result.current.saveBlock(
			blob,
			5000,
			thumbnails,
			Date.now(),
		);

		// The block duration (ms) has to reach the fixer: it is the only source
		// for the WebM Duration header, and without it replay cannot scale
		// scrubber positions.
		expect(mockVideoFix.fixDuration).toHaveBeenCalledWith(blob, 5000);
		expect(mockStorage.saveSessionWithBlob).toHaveBeenCalled();
		expect(session).not.toBeNull();
		expect(session?.id).toBe("test-id");
	});

	it("uses first thumbnail if available", async () => {
		const { result } = renderHook(() =>
			useSessionList({
				sessionStorageService: mockStorage,
				videoFixService: mockVideoFix,
			}),
		);

		await waitFor(() => {
			expect(mockStorage.init).toHaveBeenCalled();
		});

		const blob = new Blob(["test"], { type: "video/webm" });
		const thumbnails = [
			{ time: 0, dataUrl: "data:image/jpeg;base64,customthumb" },
		];
		const session = await result.current.saveBlock(
			blob,
			5000,
			thumbnails,
			Date.now(),
		);

		expect(session?.thumbnail).toBe("data:image/jpeg;base64,customthumb");
	});

	it("generates thumbnail if none provided", async () => {
		const { result } = renderHook(() =>
			useSessionList({
				sessionStorageService: mockStorage,
				videoFixService: mockVideoFix,
			}),
		);

		await waitFor(() => {
			expect(mockStorage.init).toHaveBeenCalled();
		});

		const blob = new Blob(["test"], { type: "video/webm" });
		const session = await result.current.saveBlock(blob, 5000, [], Date.now());

		expect(session?.thumbnail).toBe("data:image/jpeg;base64,firstframe");
	});

	it("returns null for empty blob", async () => {
		const { result } = renderHook(() =>
			useSessionList({
				sessionStorageService: mockStorage,
				videoFixService: mockVideoFix,
			}),
		);

		await waitFor(() => {
			expect(mockStorage.init).toHaveBeenCalled();
		});

		const blob = new Blob([], { type: "video/webm" });
		const session = await result.current.saveBlock(blob, 5000, [], Date.now());

		expect(session).toBeNull();
	});

	it("handles save errors", async () => {
		mockStorage.saveSessionWithBlob.mockRejectedValue(
			new Error("Save failed"),
		);

		const { result } = renderHook(() =>
			useSessionList({
				sessionStorageService: mockStorage,
				videoFixService: mockVideoFix,
			}),
		);

		await waitFor(() => {
			expect(mockStorage.init).toHaveBeenCalled();
		});

		const blob = new Blob(["test"], { type: "video/webm" });
		let session: PracticeSession | null;
		await act(async () => {
			session = await result.current.saveBlock(blob, 5000, [], Date.now());
		});

		expect(session!).toBeNull();
		expect(result.current.error).toBe("Failed to save recording block");
	});

	it("prunes old sessions after saving", async () => {
		const { result } = renderHook(() =>
			useSessionList({
				sessionStorageService: mockStorage,
				videoFixService: mockVideoFix,
			}),
		);

		await waitFor(() => {
			expect(mockStorage.init).toHaveBeenCalled();
		});

		const blob = new Blob(["test"], { type: "video/webm" });
		await result.current.saveBlock(blob, 5000, [], Date.now());

		expect(mockStorage.pruneOldSessions).toHaveBeenCalled();
	});
});

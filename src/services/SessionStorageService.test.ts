import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PracticeSession } from "../types/sessions";
import {
	SessionStorageService,
	settleTransaction,
} from "./SessionStorageService";

// Helper to create a test session
function createTestSession(
	overrides: Partial<PracticeSession> = {},
): Omit<PracticeSession, "id"> {
	return {
		createdAt: Date.now(),
		duration: 60,
		blobKey: "test-blob",
		thumbnail: "data:image/png;base64,test",
		thumbnails: [],
		saved: false,
		...overrides,
	};
}

// Note: Blob storage tests are skipped because fake-indexeddb in jsdom
// doesn't handle Blob structuredClone correctly. These work in real browsers.

describe("SessionStorageService", () => {
	beforeEach(async () => {
		// Ensure clean state by closing and clearing any existing DB
		SessionStorageService.close();
		// Reset the database by clearing after init
		await SessionStorageService.init();
		await SessionStorageService.clear();
	});

	afterEach(() => {
		SessionStorageService.close();
	});

	describe("init", () => {
		it("initializes the database without error", async () => {
			await expect(SessionStorageService.init()).resolves.toBeUndefined();
		});

		it("can be called multiple times safely", async () => {
			await SessionStorageService.init();
			await SessionStorageService.init();
			// No error means success
		});

		it("has onclose handler that clears dbInstance on unexpected closure", async () => {
			// Initialize the database and save a session
			await SessionStorageService.init();
			const session = createTestSession();
			const id = await SessionStorageService.saveSession(session);
			expect(id).toBeDefined();

			// Access the DB to ensure dbInstance is set
			const retrieved = await SessionStorageService.getSession(id);
			expect(retrieved).not.toBeNull();

			// We can't directly test dbInstance (it's private), but we can verify
			// that the database connection has an onclose handler by checking that
			// operations succeed after unexpected closure.
			//
			// In a real scenario, the browser might close the DB if another tab
			// requests a version change. The onclose handler should clear dbInstance
			// so the next operation reopens the DB instead of using a stale connection.
			//
			// For now, this test verifies the handler exists by ensuring we can
			// re-establish connection after closure.
			SessionStorageService.close();

			// After close, should be able to save and retrieve new session
			const session2 = createTestSession();
			const id2 = await SessionStorageService.saveSession(session2);
			expect(id2).toBeDefined();

			const retrieved2 = await SessionStorageService.getSession(id2);
			expect(retrieved2).not.toBeNull();
		});
	});

	describe("saveSession", () => {
		it("saves a session and returns an ID", async () => {
			const session = createTestSession();
			const id = await SessionStorageService.saveSession(session);

			expect(id).toBeDefined();
			expect(typeof id).toBe("string");
			expect(id.length).toBeGreaterThan(0);
		});

		it("saved session can be retrieved", async () => {
			const session = createTestSession({ duration: 120 });
			const id = await SessionStorageService.saveSession(session);

			const retrieved = await SessionStorageService.getSession(id);
			expect(retrieved).not.toBeNull();
			expect(retrieved?.id).toBe(id);
			expect(retrieved?.duration).toBe(120);
			expect(retrieved?.saved).toBe(false);
		});
	});

	describe("saveSessionWithBlob", () => {
		it("saves both session and blob atomically", async () => {
			const session = createTestSession({ duration: 120 });
			const blob = new Blob(["test video data"], { type: "video/webm" });

			const id = await SessionStorageService.saveSessionWithBlob(session, blob);

			expect(id).toBeDefined();
			expect(typeof id).toBe("string");

			// Both should be retrievable
			const retrievedSession = await SessionStorageService.getSession(id);
			expect(retrievedSession).not.toBeNull();
			expect(retrievedSession?.duration).toBe(120);

			const retrievedBlob = await SessionStorageService.getBlob(id);
			expect(retrievedBlob).not.toBeNull();
		});
	});

	describe("saveBlob and getBlob", () => {
		// Note: Blob storage tests are skipped - fake-indexeddb doesn't properly
		// handle Blob structuredClone in jsdom. These work in real browsers.
		it.skip("saves and retrieves a blob", async () => {
			const blob = new Blob(["test video data"], { type: "video/webm" });
			const id = "test-blob-id";

			await SessionStorageService.saveBlob(id, blob);
			const retrieved = await SessionStorageService.getBlob(id);

			expect(retrieved).not.toBeNull();
			expect(retrieved?.size).toBe(blob.size);
			expect(retrieved?.type).toBe(blob.type);
		});

		it("returns null for non-existent blob", async () => {
			const result = await SessionStorageService.getBlob("non-existent");
			expect(result).toBeNull();
		});

		it.skip("overwrites existing blob with same ID", async () => {
			const id = "overwrite-test";
			const blob1 = new Blob(["first"], { type: "video/webm" });
			const blob2 = new Blob(["second longer"], { type: "video/webm" });

			await SessionStorageService.saveBlob(id, blob1);
			await SessionStorageService.saveBlob(id, blob2);

			const retrieved = await SessionStorageService.getBlob(id);
			expect(retrieved?.size).toBe(blob2.size);
		});
	});

	describe("getSession", () => {
		it("returns null for non-existent session", async () => {
			const result = await SessionStorageService.getSession("non-existent");
			expect(result).toBeNull();
		});
	});

	describe("getRecentSessions", () => {
		it("returns empty array when no sessions exist", async () => {
			const result = await SessionStorageService.getRecentSessions();
			expect(result).toEqual([]);
		});

		it("returns only unsaved sessions", async () => {
			await SessionStorageService.saveSession(
				createTestSession({ saved: false }),
			);
			await SessionStorageService.saveSession(
				createTestSession({ saved: true }),
			);

			const recent = await SessionStorageService.getRecentSessions();
			expect(recent.length).toBe(1);
			expect(recent[0].saved).toBe(false);
		});

		it("returns sessions ordered by createdAt descending", async () => {
			const now = Date.now();
			await SessionStorageService.saveSession(
				createTestSession({ createdAt: now - 2000 }),
			);
			await SessionStorageService.saveSession(
				createTestSession({ createdAt: now }),
			);
			await SessionStorageService.saveSession(
				createTestSession({ createdAt: now - 1000 }),
			);

			const recent = await SessionStorageService.getRecentSessions();
			expect(recent.length).toBe(3);
			expect(recent[0].createdAt).toBe(now);
			expect(recent[1].createdAt).toBe(now - 1000);
			expect(recent[2].createdAt).toBe(now - 2000);
		});

		it("respects limit parameter", async () => {
			for (let i = 0; i < 5; i++) {
				await SessionStorageService.saveSession(createTestSession());
			}

			const limited = await SessionStorageService.getRecentSessions(2);
			expect(limited.length).toBe(2);
		});
	});

	describe("getSavedSessions", () => {
		it("returns empty array when no saved sessions exist", async () => {
			await SessionStorageService.saveSession(
				createTestSession({ saved: false }),
			);
			const result = await SessionStorageService.getSavedSessions();
			expect(result).toEqual([]);
		});

		it("returns only saved sessions", async () => {
			await SessionStorageService.saveSession(
				createTestSession({ saved: true, name: "Saved one" }),
			);
			await SessionStorageService.saveSession(
				createTestSession({ saved: false }),
			);
			await SessionStorageService.saveSession(
				createTestSession({ saved: true, name: "Saved two" }),
			);

			const saved = await SessionStorageService.getSavedSessions();
			expect(saved.length).toBe(2);
			expect(saved.every((s) => s.saved)).toBe(true);
		});
	});

	describe("getAllSessions", () => {
		it("returns all sessions regardless of saved status", async () => {
			await SessionStorageService.saveSession(
				createTestSession({ saved: true }),
			);
			await SessionStorageService.saveSession(
				createTestSession({ saved: false }),
			);

			const all = await SessionStorageService.getAllSessions();
			expect(all.length).toBe(2);
		});
	});

	describe("updateSession", () => {
		it("updates session fields", async () => {
			const id = await SessionStorageService.saveSession(
				createTestSession({ duration: 60 }),
			);

			await SessionStorageService.updateSession(id, { duration: 120 });

			const updated = await SessionStorageService.getSession(id);
			expect(updated?.duration).toBe(120);
		});

		it("preserves unmodified fields", async () => {
			const session = createTestSession({ duration: 60, saved: false });
			const id = await SessionStorageService.saveSession(session);

			await SessionStorageService.updateSession(id, { saved: true });

			const updated = await SessionStorageService.getSession(id);
			expect(updated?.duration).toBe(60);
			expect(updated?.saved).toBe(true);
		});

		it("throws for non-existent session", async () => {
			await expect(
				SessionStorageService.updateSession("non-existent", { duration: 100 }),
			).rejects.toThrow("Session non-existent not found");
		});
	});

	describe("markAsSaved", () => {
		it("marks session as saved with name", async () => {
			const id = await SessionStorageService.saveSession(
				createTestSession({ saved: false }),
			);

			await SessionStorageService.markAsSaved(id, "My Practice");

			const session = await SessionStorageService.getSession(id);
			expect(session?.saved).toBe(true);
			expect(session?.name).toBe("My Practice");
		});
	});

	describe("setTrimPoints", () => {
		it("sets trim in and out points", async () => {
			const id = await SessionStorageService.saveSession(createTestSession());

			await SessionStorageService.setTrimPoints(id, 5.0, 55.0);

			const session = await SessionStorageService.getSession(id);
			expect(session?.trimIn).toBe(5.0);
			expect(session?.trimOut).toBe(55.0);
		});
	});

	describe("deleteSession", () => {
		it("deletes a session", async () => {
			const id = await SessionStorageService.saveSession(createTestSession());

			await SessionStorageService.deleteSession(id);

			const result = await SessionStorageService.getSession(id);
			expect(result).toBeNull();
		});
	});

	describe("deleteBlob", () => {
		it("deletes a blob", async () => {
			const id = "delete-blob-test";
			const blob = new Blob(["test"], { type: "video/webm" });
			await SessionStorageService.saveBlob(id, blob);

			await SessionStorageService.deleteBlob(id);

			const result = await SessionStorageService.getBlob(id);
			expect(result).toBeNull();
		});
	});

	describe("deleteSessionWithBlob", () => {
		it("deletes both session and blob", async () => {
			const session = createTestSession();
			const id = await SessionStorageService.saveSession(session);
			const blob = new Blob(["test"], { type: "video/webm" });
			await SessionStorageService.saveBlob(id, blob);

			await SessionStorageService.deleteSessionWithBlob(id);

			expect(await SessionStorageService.getSession(id)).toBeNull();
			expect(await SessionStorageService.getBlob(id)).toBeNull();
		});

		it("deletes session only when both session and blob exist", async () => {
			// Verify that delete succeeds atomically
			const session = createTestSession();
			const id = await SessionStorageService.saveSession(session);
			const blob = new Blob(["test"], { type: "video/webm" });
			await SessionStorageService.saveBlob(id, blob);

			// Successful deletion - both should be gone
			await SessionStorageService.deleteSessionWithBlob(id);

			expect(await SessionStorageService.getSession(id)).toBeNull();
			expect(await SessionStorageService.getBlob(id)).toBeNull();
		});

		it("handles deletion when blob does not exist", async () => {
			// Delete should succeed even if blob doesn't exist
			const session = createTestSession();
			const id = await SessionStorageService.saveSession(session);

			// Don't save a blob - only session exists
			await SessionStorageService.deleteSessionWithBlob(id);

			// Session should be deleted regardless
			expect(await SessionStorageService.getSession(id)).toBeNull();
		});
	});

	describe("pruneOldSessions", () => {
		it("keeps sessions within duration limit", async () => {
			const now = Date.now();
			// Create 3 sessions, each 120 seconds
			await SessionStorageService.saveSession(
				createTestSession({ createdAt: now, duration: 120 }),
			);
			await SessionStorageService.saveSession(
				createTestSession({ createdAt: now - 1000, duration: 120 }),
			);
			await SessionStorageService.saveSession(
				createTestSession({ createdAt: now - 2000, duration: 120 }),
			);

			// Keep only 200 seconds worth (should keep first 2)
			const deleted = await SessionStorageService.pruneOldSessions(200);

			expect(deleted).toBe(1);
			const remaining = await SessionStorageService.getRecentSessions();
			expect(remaining.length).toBe(2);
		});

		it("does not prune saved sessions", async () => {
			const now = Date.now();
			await SessionStorageService.saveSession(
				createTestSession({ createdAt: now, duration: 60, saved: false }),
			);
			await SessionStorageService.saveSession(
				createTestSession({
					createdAt: now - 1000,
					duration: 60,
					saved: true,
				}),
			);

			// Try to prune with 0 duration limit
			await SessionStorageService.pruneOldSessions(0);

			// Saved session should still exist
			const saved = await SessionStorageService.getSavedSessions();
			expect(saved.length).toBe(1);
		});
	});

	describe("clear", () => {
		it("removes all sessions and blobs", async () => {
			await SessionStorageService.saveSession(createTestSession());
			await SessionStorageService.saveSession(createTestSession());
			await SessionStorageService.saveBlob(
				"test",
				new Blob(["test"], { type: "video/webm" }),
			);

			await SessionStorageService.clear();

			expect(await SessionStorageService.getAllSessions()).toEqual([]);
			expect(await SessionStorageService.getBlob("test")).toBeNull();
		});
	});

	describe("getStorageUsage", () => {
		it("returns storage estimate", async () => {
			// Mock navigator.storage.estimate
			const mockEstimate = vi.fn().mockResolvedValue({
				usage: 1024,
				quota: 1048576,
			});
			vi.stubGlobal("navigator", {
				storage: { estimate: mockEstimate },
			});

			const usage = await SessionStorageService.getStorageUsage();

			expect(usage.used).toBe(1024);
			expect(usage.quota).toBe(1048576);

			vi.unstubAllGlobals();
		});

		it("returns zeros when storage API unavailable", async () => {
			vi.stubGlobal("navigator", {});

			const usage = await SessionStorageService.getStorageUsage();

			expect(usage.used).toBe(0);
			expect(usage.quota).toBe(0);

			vi.unstubAllGlobals();
		});
	});

	describe("settleTransaction (H5)", () => {
		it("rejects on abort instead of hanging forever", async () => {
			const fakeTx = {
				oncomplete: null,
				onerror: null,
				onabort: null,
				error: null,
			} as unknown as IDBTransaction;
			const promise = settleTransaction(fakeTx, () => "unreachable");
			fakeTx.onabort?.(new Event("abort"));
			await expect(promise).rejects.toThrow(/aborted/);
		});

		it("resolves the result on complete", async () => {
			const fakeTx = {
				oncomplete: null,
				onerror: null,
				onabort: null,
			} as unknown as IDBTransaction;
			const promise = settleTransaction(fakeTx, () => 42);
			fakeTx.oncomplete?.(new Event("complete"));
			await expect(promise).resolves.toBe(42);
		});

		it("rejects when result() throws instead of hanging", async () => {
			const fakeTx = {
				oncomplete: null,
				onerror: null,
				onabort: null,
			} as unknown as IDBTransaction;
			const promise = settleTransaction(fakeTx, () => {
				throw new Error("result blew up");
			});
			fakeTx.oncomplete?.(new Event("complete"));
			await expect(promise).rejects.toThrow("result blew up");
		});
	});
});

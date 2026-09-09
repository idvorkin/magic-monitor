/**
 * Race-condition tests for the practice session storage layer.
 *
 * These tests exercise the TOCTOU window between `pruneOldSessions`' snapshot
 * read (which captures the `saved` flag) and its per-id delete transactions
 * (which previously deleted unconditionally). A session that `markAsSaved`
 * commits as `saved: true` *between* those two steps must survive the prune.
 *
 * The reproduction runs against the real `SessionStorageService` under
 * `fake-indexeddb` (the same harness as the main suite) — no interceptor or
 * monkeypatch is used, only ordinary `await`s plus a single microtask yield
 * to lock in the spec-permitted ordering described in the bug report.
 */
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PracticeSession } from "../types/sessions";
import { SessionStorageService } from "./SessionStorageService";

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

describe("SessionStorageService.pruneOldSessions race / TOCTOU", () => {
	beforeEach(async () => {
		SessionStorageService.close();
		await SessionStorageService.init();
		await SessionStorageService.clear();
	});

	afterEach(() => {
		SessionStorageService.close();
	});

	it("does not delete a session that markAsSaved committed saved:true during a concurrent prune", async () => {
		const base = Date.now();
		const ids: string[] = [];
		// Seed 3 unsaved 120s sessions; pruneOldSessions(200) targets the oldest.
		for (let i = 0; i < 3; i++) {
			const id = await SessionStorageService.saveSessionWithBlob(
				createTestSession({ createdAt: base - i * 1000, duration: 120 }),
				new Blob(["d"], { type: "video/mp4" }),
			);
			ids.push(id);
		}
		const oldest = ids[2]; // smallest createdAt -> newest-first prune target

		// markAsSaved starts; one microtask yield locks in the spec-permitted
		// interleaving (markAsSaved's get+put txs queue before the prune's
		// snapshot resolves and its delete txs queue).
		const saveP = SessionStorageService.markAsSaved(oldest, "SavedClip");
		await Promise.resolve();
		const pruneP = SessionStorageService.pruneOldSessions(200);

		await expect(saveP).resolves.toBeUndefined(); // markAsSaved DID commit saved:true
		await pruneP;

		// FIX: the saved clip must survive the concurrent prune.
		const savedSessions = await SessionStorageService.getSavedSessions();
		expect(savedSessions.map((s) => s.id)).toContain(oldest);

		const remaining = await SessionStorageService.getSession(oldest);
		expect(remaining).not.toBeNull();
		expect(remaining?.saved).toBe(true);
		expect(remaining?.name).toBe("SavedClip");

		// The blob must survive too - deletion of a saved clip is irrecoverable.
		expect(await SessionStorageService.getBlob(oldest)).not.toBeNull();
	});
});

describe("SessionStorageService.pruneOldSessions regressions", () => {
	beforeEach(async () => {
		SessionStorageService.close();
		await SessionStorageService.init();
		await SessionStorageService.clear();
	});

	afterEach(() => {
		SessionStorageService.close();
	});

	it("still prunes genuinely unsaved sessions over the keep duration", async () => {
		const base = Date.now();
		for (let i = 0; i < 3; i++) {
			await SessionStorageService.saveSessionWithBlob(
				createTestSession({ createdAt: base - i * 1000, duration: 120 }),
				new Blob(["d"], { type: "video/mp4" }),
			);
		}

		const deleted = await SessionStorageService.pruneOldSessions(200);

		// The oldest unsaved session is pruned (metadata + blob).
		expect(deleted).toBe(1);
		expect((await SessionStorageService.getRecentSessions()).length).toBe(2);
	});

	it("explicit deleteSessionWithBlob still deletes a saved session unconditionally", async () => {
		const id = await SessionStorageService.saveSessionWithBlob(
			createTestSession({ saved: false }),
			new Blob(["d"], { type: "video/mp4" }),
		);
		await SessionStorageService.markAsSaved(id, "SavedClip");
		expect((await SessionStorageService.getSession(id))?.saved).toBe(true);

		// Explicit user deletion must remove a saved session and its blob - the
		// saved-recheck that protects pruning must NOT neuter intentional deletes.
		await SessionStorageService.deleteSessionWithBlob(id);

		expect(await SessionStorageService.getSession(id)).toBeNull();
		expect(await SessionStorageService.getBlob(id)).toBeNull();
	});

	it("pruneOldSessions reports the number of sessions actually deleted, skipping saved ones", async () => {
		const base = Date.now();
		const ids: string[] = [];
		for (let i = 0; i < 3; i++) {
			const id = await SessionStorageService.saveSessionWithBlob(
				createTestSession({ createdAt: base - i * 1000, duration: 120 }),
				new Blob(["d"], { type: "video/mp4" }),
			);
			ids.push(id);
		}
		const oldest = ids[2]; // prune target

		// markAsSaved commits before the prune's delete tx runs for the oldest;
		// the prune snapshot still read saved:false so the oldest is in toDelete,
		// but the re-check inside the delete tx skips it.
		const saveP = SessionStorageService.markAsSaved(oldest, "SavedClip");
		await Promise.resolve();
		const pruneP = SessionStorageService.pruneOldSessions(200);

		await saveP;
		const deleted = await pruneP;

		// Only sessions that were actually deleted (unsaved at delete time) are
		// counted; the saved one is skipped, so the count reflects real deletions.
		expect(deleted).toBe(0);
		expect(
			(await SessionStorageService.getSavedSessions()).map((s) => s.id),
		).toContain(oldest);
	});
});

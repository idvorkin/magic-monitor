import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DB_NAME = "magic-monitor-rewind";
const DB_VERSION = 1;
const STORE_NAME = "chunks";

/**
 * Seed the IndexedDB rewind buffer with test data.
 * This allows E2E tests to verify replay functionality without waiting for real recording.
 */
export async function seedRewindBuffer(
	page: Page,
	chunkCount: number = 5,
): Promise<void> {
	// Read test fixtures
	const fixturesDir = join(__dirname, "..", "fixtures");
	const videoBuffer = readFileSync(join(fixturesDir, "test-chunk.webm"));
	const previewBuffer = readFileSync(join(fixturesDir, "test-preview.jpg"));

	// Convert to base64 for transfer to browser
	const videoBase64 = videoBuffer.toString("base64");
	const previewBase64 = previewBuffer.toString("base64");

	await page.evaluate(
		async ({ dbName, dbVersion, storeName, count, videoData, previewData }) => {
			// Convert base64 back to ArrayBuffer
			const videoArrayBuffer = Uint8Array.from(atob(videoData), (c) =>
				c.charCodeAt(0),
			).buffer;
			const previewDataUrl = `data:image/jpeg;base64,${previewData}`;

			// Open database
			const db = await new Promise<IDBDatabase>((resolve, reject) => {
				const request = indexedDB.open(dbName, dbVersion);
				request.onerror = () => reject(request.error);
				request.onsuccess = () => resolve(request.result);
				request.onupgradeneeded = (event) => {
					const db = (event.target as IDBOpenDBRequest).result;
					if (!db.objectStoreNames.contains(storeName)) {
						const store = db.createObjectStore(storeName, {
							keyPath: "id",
							autoIncrement: true,
						});
						store.createIndex("timestamp", "timestamp", { unique: false });
					}
				};
			});

			// Insert test chunks
			const tx = db.transaction(storeName, "readwrite");
			const store = tx.objectStore(storeName);

			const baseTimestamp = Date.now() - count * 2000; // Start from past

			for (let i = 0; i < count; i++) {
				const chunk = {
					blob: new Blob([videoArrayBuffer], { type: "video/webm" }),
					preview: previewDataUrl,
					timestamp: baseTimestamp + i * 2000,
					duration: 2000,
				};
				store.add(chunk);
			}

			await new Promise<void>((resolve, reject) => {
				tx.oncomplete = () => resolve();
				tx.onerror = () => reject(tx.error);
			});

			db.close();
		},
		{
			dbName: DB_NAME,
			dbVersion: DB_VERSION,
			storeName: STORE_NAME,
			count: chunkCount,
			videoData: videoBase64,
			previewData: previewBase64,
		},
	);
}

/**
 * Clear the IndexedDB rewind buffer.
 */
export async function clearRewindBuffer(page: Page): Promise<void> {
	await page.evaluate(
		async ({ dbName }) => {
			// Delete the entire database
			await new Promise<void>((resolve, reject) => {
				const request = indexedDB.deleteDatabase(dbName);
				request.onsuccess = () => resolve();
				request.onerror = () => reject(request.error);
			});
		},
		{ dbName: DB_NAME },
	);
}

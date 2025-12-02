/**
 * Humble Object for IndexedDB video chunk storage.
 * Isolates IndexedDB calls for testability.
 */

const DB_NAME = "magic-monitor-rewind";
const DB_VERSION = 1;
const STORE_NAME = "chunks";

export interface VideoChunk {
	id?: number;
	blob: Blob; // WebM video data
	preview: string; // JPEG data URL
	timestamp: number; // Recording start time (ms since epoch)
	duration: number; // Chunk duration in ms
}

export interface ChunkPreview {
	id: number;
	preview: string;
	timestamp: number;
}

let dbInstance: IDBDatabase | null = null;

function getDB(): Promise<IDBDatabase> {
	if (dbInstance) {
		return Promise.resolve(dbInstance);
	}

	return new Promise((resolve, reject) => {
		const request = indexedDB.open(DB_NAME, DB_VERSION);

		request.onerror = () => {
			reject(new Error("Failed to open IndexedDB"));
		};

		request.onsuccess = () => {
			dbInstance = request.result;
			resolve(dbInstance);
		};

		request.onupgradeneeded = (event) => {
			const db = (event.target as IDBOpenDBRequest).result;
			if (!db.objectStoreNames.contains(STORE_NAME)) {
				const store = db.createObjectStore(STORE_NAME, {
					keyPath: "id",
					autoIncrement: true,
				});
				store.createIndex("timestamp", "timestamp", { unique: false });
			}
		};
	});
}

export const DiskBufferService = {
	/**
	 * Initialize the database connection.
	 * Called automatically by other methods, but can be called explicitly.
	 */
	async init(): Promise<void> {
		await getDB();
	},

	/**
	 * Save a video chunk with its preview thumbnail.
	 * Returns the auto-generated chunk ID.
	 */
	async saveChunk(chunk: Omit<VideoChunk, "id">): Promise<number> {
		const db = await getDB();
		return new Promise((resolve, reject) => {
			const tx = db.transaction(STORE_NAME, "readwrite");
			const store = tx.objectStore(STORE_NAME);
			const request = store.add(chunk);

			request.onsuccess = () => {
				resolve(request.result as number);
			};
			request.onerror = () => {
				reject(new Error("Failed to save chunk"));
			};
		});
	},

	/**
	 * Get all chunks ordered by timestamp (oldest first).
	 */
	async getAllChunks(): Promise<VideoChunk[]> {
		const db = await getDB();
		return new Promise((resolve, reject) => {
			const tx = db.transaction(STORE_NAME, "readonly");
			const store = tx.objectStore(STORE_NAME);
			const index = store.index("timestamp");
			const request = index.getAll();

			request.onsuccess = () => {
				resolve(request.result as VideoChunk[]);
			};
			request.onerror = () => {
				reject(new Error("Failed to get chunks"));
			};
		});
	},

	/**
	 * Get chunk by ID.
	 */
	async getChunk(id: number): Promise<VideoChunk | null> {
		const db = await getDB();
		return new Promise((resolve, reject) => {
			const tx = db.transaction(STORE_NAME, "readonly");
			const store = tx.objectStore(STORE_NAME);
			const request = store.get(id);

			request.onsuccess = () => {
				resolve((request.result as VideoChunk) ?? null);
			};
			request.onerror = () => {
				reject(new Error("Failed to get chunk"));
			};
		});
	},

	/**
	 * Get just the preview thumbnails (without video blobs) for the scrubber.
	 * Much lighter than getAllChunks when you only need thumbnails.
	 */
	async getPreviews(): Promise<ChunkPreview[]> {
		const chunks = await this.getAllChunks();
		return chunks.map((chunk) => ({
			id: chunk.id!,
			preview: chunk.preview,
			timestamp: chunk.timestamp,
		}));
	},

	/**
	 * Get the count of stored chunks.
	 */
	async getChunkCount(): Promise<number> {
		const db = await getDB();
		return new Promise((resolve, reject) => {
			const tx = db.transaction(STORE_NAME, "readonly");
			const store = tx.objectStore(STORE_NAME);
			const request = store.count();

			request.onsuccess = () => {
				resolve(request.result);
			};
			request.onerror = () => {
				reject(new Error("Failed to count chunks"));
			};
		});
	},

	/**
	 * Prune old chunks, keeping only the most recent N chunks.
	 */
	async pruneOldChunks(keepCount: number): Promise<void> {
		const chunks = await this.getAllChunks();
		if (chunks.length <= keepCount) {
			return;
		}

		// Chunks are sorted by timestamp, so oldest are first
		const toDelete = chunks.slice(0, chunks.length - keepCount);
		const db = await getDB();

		return new Promise((resolve, reject) => {
			const tx = db.transaction(STORE_NAME, "readwrite");
			const store = tx.objectStore(STORE_NAME);

			let completed = 0;
			for (const chunk of toDelete) {
				const request = store.delete(chunk.id!);
				request.onsuccess = () => {
					completed++;
					if (completed === toDelete.length) {
						resolve();
					}
				};
				request.onerror = () => {
					reject(new Error("Failed to delete chunk"));
				};
			}

			if (toDelete.length === 0) {
				resolve();
			}
		});
	},

	/**
	 * Concatenate all chunks into a single video blob for export/download.
	 * Note: Simple blob concatenation - video may not be fully seekable.
	 * For proper merging, use ffmpeg on the command line after download.
	 *
	 * @param onProgress - Optional progress callback (0-1)
	 */
	async exportVideo(onProgress?: (progress: number) => void): Promise<Blob> {
		const chunks = await this.getAllChunks();
		if (chunks.length === 0) {
			return new Blob([], { type: "video/webm" });
		}

		// Simple blob concatenation - fast but may have playback issues
		const blobs = chunks.map((chunk) => chunk.blob);
		onProgress?.(0.5);
		const result = new Blob(blobs, { type: "video/webm" });
		onProgress?.(1);
		return result;
	},

	/**
	 * Clear all stored chunks.
	 */
	async clear(): Promise<void> {
		const db = await getDB();
		return new Promise((resolve, reject) => {
			const tx = db.transaction(STORE_NAME, "readwrite");
			const store = tx.objectStore(STORE_NAME);
			const request = store.clear();

			request.onsuccess = () => {
				resolve();
			};
			request.onerror = () => {
				reject(new Error("Failed to clear chunks"));
			};
		});
	},

	/**
	 * Close database connection (useful for testing).
	 */
	close(): void {
		if (dbInstance) {
			dbInstance.close();
			dbInstance = null;
		}
	},
};

export type DiskBufferServiceType = typeof DiskBufferService;

import { afterEach, describe, expect, it, vi } from "vitest";
import { ShareService } from "./ShareService";

describe("ShareService", () => {
	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	});

	describe("canShare", () => {
		it("returns true when navigator.share exists", () => {
			vi.stubGlobal("navigator", {
				share: vi.fn(),
				canShare: vi.fn(),
			});

			expect(ShareService.canShare()).toBe(true);
		});

		it("returns false when navigator.share is missing", () => {
			vi.stubGlobal("navigator", {});

			expect(ShareService.canShare()).toBe(false);
		});
	});

	describe("canShareFiles", () => {
		it("returns false when canShare is false", () => {
			vi.stubGlobal("navigator", {});

			expect(ShareService.canShareFiles()).toBe(false);
		});

		it("returns true when navigator.canShare accepts files", () => {
			vi.stubGlobal("navigator", {
				share: vi.fn(),
				canShare: vi.fn().mockReturnValue(true),
			});

			expect(ShareService.canShareFiles()).toBe(true);
		});

		it("returns false when navigator.canShare rejects files", () => {
			vi.stubGlobal("navigator", {
				share: vi.fn(),
				canShare: vi.fn().mockReturnValue(false),
			});

			expect(ShareService.canShareFiles()).toBe(false);
		});
	});

	describe("share", () => {
		it("shares file via native share sheet", async () => {
			const shareMock = vi.fn().mockResolvedValue(undefined);
			vi.stubGlobal("navigator", {
				share: shareMock,
				canShare: vi.fn().mockReturnValue(true),
			});

			const blob = new Blob(["test"], { type: "video/webm" });
			const result = await ShareService.share(blob, "test.webm");

			expect(shareMock).toHaveBeenCalled();
			expect(result).toBe(true);
		});

		it("falls back to download when sharing unavailable", async () => {
			vi.stubGlobal("navigator", {});

			// Mock download
			const createObjectURLMock = vi.fn().mockReturnValue("blob:test");
			const revokeObjectURLMock = vi.fn();
			vi.stubGlobal("URL", {
				createObjectURL: createObjectURLMock,
				revokeObjectURL: revokeObjectURLMock,
			});

			const clickMock = vi.fn();
			const appendChildMock = vi.fn();
			const removeChildMock = vi.fn();
			vi.spyOn(document, "createElement").mockReturnValue({
				href: "",
				download: "",
				click: clickMock,
			} as unknown as HTMLAnchorElement);
			vi.spyOn(document.body, "appendChild").mockImplementation(appendChildMock);
			vi.spyOn(document.body, "removeChild").mockImplementation(removeChildMock);

			const blob = new Blob(["test"], { type: "video/webm" });
			const result = await ShareService.share(blob, "test.webm");

			expect(clickMock).toHaveBeenCalled();
			expect(result).toBe(false);
		});

		it("returns false when user cancels share", async () => {
			const abortError = new Error("User cancelled");
			abortError.name = "AbortError";
			const shareMock = vi.fn().mockRejectedValue(abortError);
			vi.stubGlobal("navigator", {
				share: shareMock,
				canShare: vi.fn().mockReturnValue(true),
			});

			const blob = new Blob(["test"], { type: "video/webm" });
			const result = await ShareService.share(blob, "test.webm");

			expect(result).toBe(false);
		});
	});

	describe("download", () => {
		it("triggers file download", () => {
			const createObjectURLMock = vi.fn().mockReturnValue("blob:test");
			const revokeObjectURLMock = vi.fn();
			vi.stubGlobal("URL", {
				createObjectURL: createObjectURLMock,
				revokeObjectURL: revokeObjectURLMock,
			});

			const mockAnchor = {
				href: "",
				download: "",
				click: vi.fn(),
			};
			vi.spyOn(document, "createElement").mockReturnValue(
				mockAnchor as unknown as HTMLAnchorElement,
			);
			vi.spyOn(document.body, "appendChild").mockImplementation(() => null as unknown as Node);
			vi.spyOn(document.body, "removeChild").mockImplementation(() => null as unknown as Node);

			const blob = new Blob(["test"], { type: "video/webm" });
			ShareService.download(blob, "test.webm");

			expect(createObjectURLMock).toHaveBeenCalledWith(blob);
			expect(mockAnchor.href).toBe("blob:test");
			expect(mockAnchor.download).toBe("test.webm");
			expect(mockAnchor.click).toHaveBeenCalled();
			expect(revokeObjectURLMock).toHaveBeenCalledWith("blob:test");
		});
	});

	describe("generateFilename", () => {
		it("generates a .webm filename for webm blobs", () => {
			expect(
				ShareService.generateFilename("my-clip", "video/webm;codecs=vp9"),
			).toMatch(/^my-clip-.*\.webm$/);
		});

		it("generates an .mp4 filename for mp4 blobs (iOS)", () => {
			expect(
				ShareService.generateFilename("my-clip", "video/mp4;codecs=avc1.42E01E"),
			).toMatch(/^my-clip-.*\.mp4$/);
		});

		it("defaults to .webm when no mime type is given", () => {
			expect(ShareService.generateFilename()).toMatch(/\.webm$/);
		});
	});
});

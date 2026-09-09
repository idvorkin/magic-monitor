import { fireEvent, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useEscapeKey } from "./useEscapeKey";

describe("useEscapeKey", () => {
	it("calls onCloseSettings when settings is open", () => {
		const onCloseSettings = vi.fn();
		const onCancelColorPick = vi.fn();
		const onExitReplay = vi.fn();

		renderHook(() =>
			useEscapeKey({
				isSettingsOpen: true,
				isPickingColor: false,
				isReplaying: false,
				onCloseSettings,
				onCancelColorPick,
				onExitReplay,
			}),
		);

		fireEvent.keyDown(window, { key: "Escape" });

		expect(onCloseSettings).toHaveBeenCalledTimes(1);
		expect(onCancelColorPick).not.toHaveBeenCalled();
		expect(onExitReplay).not.toHaveBeenCalled();
	});

	it("calls onCancelColorPick when picking color (settings closed)", () => {
		const onCloseSettings = vi.fn();
		const onCancelColorPick = vi.fn();
		const onExitReplay = vi.fn();

		renderHook(() =>
			useEscapeKey({
				isSettingsOpen: false,
				isPickingColor: true,
				isReplaying: false,
				onCloseSettings,
				onCancelColorPick,
				onExitReplay,
			}),
		);

		fireEvent.keyDown(window, { key: "Escape" });

		expect(onCloseSettings).not.toHaveBeenCalled();
		expect(onCancelColorPick).toHaveBeenCalledTimes(1);
		expect(onExitReplay).not.toHaveBeenCalled();
	});

	it("calls onExitReplay when replaying (settings closed, not picking)", () => {
		const onCloseSettings = vi.fn();
		const onCancelColorPick = vi.fn();
		const onExitReplay = vi.fn();

		renderHook(() =>
			useEscapeKey({
				isSettingsOpen: false,
				isPickingColor: false,
				isReplaying: true,
				onCloseSettings,
				onCancelColorPick,
				onExitReplay,
			}),
		);

		fireEvent.keyDown(window, { key: "Escape" });

		expect(onCloseSettings).not.toHaveBeenCalled();
		expect(onCancelColorPick).not.toHaveBeenCalled();
		expect(onExitReplay).toHaveBeenCalledTimes(1);
	});

	it("prioritizes settings over color picking", () => {
		const onCloseSettings = vi.fn();
		const onCancelColorPick = vi.fn();
		const onExitReplay = vi.fn();

		renderHook(() =>
			useEscapeKey({
				isSettingsOpen: true,
				isPickingColor: true,
				isReplaying: true,
				onCloseSettings,
				onCancelColorPick,
				onExitReplay,
			}),
		);

		fireEvent.keyDown(window, { key: "Escape" });

		expect(onCloseSettings).toHaveBeenCalledTimes(1);
		expect(onCancelColorPick).not.toHaveBeenCalled();
		expect(onExitReplay).not.toHaveBeenCalled();
	});

	it("does nothing when nothing is active", () => {
		const onCloseSettings = vi.fn();
		const onCancelColorPick = vi.fn();
		const onExitReplay = vi.fn();

		renderHook(() =>
			useEscapeKey({
				isSettingsOpen: false,
				isPickingColor: false,
				isReplaying: false,
				onCloseSettings,
				onCancelColorPick,
				onExitReplay,
			}),
		);

		fireEvent.keyDown(window, { key: "Escape" });

		expect(onCloseSettings).not.toHaveBeenCalled();
		expect(onCancelColorPick).not.toHaveBeenCalled();
		expect(onExitReplay).not.toHaveBeenCalled();
	});

	it("ignores non-Escape keys", () => {
		const onCloseSettings = vi.fn();
		const onCancelColorPick = vi.fn();
		const onExitReplay = vi.fn();

		renderHook(() =>
			useEscapeKey({
				isSettingsOpen: true,
				isPickingColor: false,
				isReplaying: false,
				onCloseSettings,
				onCancelColorPick,
				onExitReplay,
			}),
		);

		fireEvent.keyDown(window, { key: "Enter" });
		fireEvent.keyDown(window, { key: "a" });

		expect(onCloseSettings).not.toHaveBeenCalled();
	});

	it("cleans up event listener on unmount", () => {
		const onCloseSettings = vi.fn();

		const { unmount } = renderHook(() =>
			useEscapeKey({
				isSettingsOpen: true,
				isPickingColor: false,
				isReplaying: false,
				onCloseSettings,
				onCancelColorPick: vi.fn(),
				onExitReplay: vi.fn(),
			}),
		);

		unmount();

		fireEvent.keyDown(window, { key: "Escape" });

		expect(onCloseSettings).not.toHaveBeenCalled();
	});

	it("calls onDismissThinkOfACard when thinking of a card (settings closed)", () => {
		const onDismissThinkOfACard = vi.fn();
		const onCloseSettings = vi.fn();
		const onCancelColorPick = vi.fn();
		const onExitReplay = vi.fn();

		renderHook(() =>
			useEscapeKey({
				isThinkingOfACard: true,
				isSettingsOpen: false,
				isPickingColor: false,
				isReplaying: false,
				onDismissThinkOfACard,
				onCloseSettings,
				onCancelColorPick,
				onExitReplay,
			}),
		);

		fireEvent.keyDown(window, { key: "Escape" });

		expect(onDismissThinkOfACard).toHaveBeenCalledTimes(1);
		expect(onCloseSettings).not.toHaveBeenCalled();
		expect(onCancelColorPick).not.toHaveBeenCalled();
		expect(onExitReplay).not.toHaveBeenCalled();
	});

	it("prioritizes think-of-a-card over every other overlay when all are active", () => {
		const onDismissThinkOfACard = vi.fn();
		const onCloseSettings = vi.fn();
		const onCancelColorPick = vi.fn();
		const onExitReplay = vi.fn();

		renderHook(() =>
			useEscapeKey({
				isThinkingOfACard: true,
				isSettingsOpen: true,
				isPickingColor: true,
				isReplaying: true,
				onDismissThinkOfACard,
				onCloseSettings,
				onCancelColorPick,
				onExitReplay,
			}),
		);

		fireEvent.keyDown(window, { key: "Escape" });

		expect(onDismissThinkOfACard).toHaveBeenCalledTimes(1);
		expect(onCloseSettings).not.toHaveBeenCalled();
		expect(onCancelColorPick).not.toHaveBeenCalled();
		expect(onExitReplay).not.toHaveBeenCalled();
	});
});

import { fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useEscapeKey } from "./useEscapeKey";
import { useFocusTrap } from "./useFocusTrap";

interface HarnessProps {
	isThinkingOfACard: boolean;
	isSettingsOpen: boolean;
	onCloseSettings: () => void;
	onDismissThinkOfACard: () => void;
}

function CoordinationHarness({
	isThinkingOfACard,
	isSettingsOpen,
	onCloseSettings,
	onDismissThinkOfACard,
}: HarnessProps) {
	const trapRef = useFocusTrap({
		isOpen: isSettingsOpen,
		onClose: onCloseSettings,
	});
	useEscapeKey({
		isThinkingOfACard,
		onDismissThinkOfACard,
		isSettingsOpen,
		isPickingColor: false,
		isReplaying: false,
		onCloseSettings,
		onCancelColorPick: vi.fn(),
		onExitReplay: vi.fn(),
	});
	return (
		<div ref={trapRef}>
			<button data-testid="inner" type="button">
				focusable
			</button>
		</div>
	);
}

describe("Escape coordination between useFocusTrap and useEscapeKey", () => {
	afterEach(() => {
		document.body.innerHTML = "";
	});

	it("a single Escape with Settings and think-of-a-card both open dismisses exactly one overlay", () => {
		const onCloseSettings = vi.fn();
		const onDismissThinkOfACard = vi.fn();

		const { getByTestId } = render(
			<CoordinationHarness
				isThinkingOfACard={true}
				isSettingsOpen={true}
				onCloseSettings={onCloseSettings}
				onDismissThinkOfACard={onDismissThinkOfACard}
			/>,
		);

		const inner = getByTestId("inner");
		inner.focus();
		fireEvent.keyDown(inner, { key: "Escape" });

		expect(onCloseSettings).toHaveBeenCalledTimes(1);
		expect(onDismissThinkOfACard).not.toHaveBeenCalled();
	});

	it("Escape with only Settings open closes Settings exactly once (no redundant window dispatch)", () => {
		const onCloseSettings = vi.fn();
		const onDismissThinkOfACard = vi.fn();

		const { getByTestId } = render(
			<CoordinationHarness
				isThinkingOfACard={false}
				isSettingsOpen={true}
				onCloseSettings={onCloseSettings}
				onDismissThinkOfACard={onDismissThinkOfACard}
			/>,
		);

		const inner = getByTestId("inner");
		inner.focus();
		fireEvent.keyDown(inner, { key: "Escape" });

		expect(onCloseSettings).toHaveBeenCalledTimes(1);
		expect(onDismissThinkOfACard).not.toHaveBeenCalled();
	});

	it("Escape with only think-of-a-card active (Settings closed) dismisses the round once", () => {
		const onCloseSettings = vi.fn();
		const onDismissThinkOfACard = vi.fn();

		const { getByTestId } = render(
			<CoordinationHarness
				isThinkingOfACard={true}
				isSettingsOpen={false}
				onCloseSettings={onCloseSettings}
				onDismissThinkOfACard={onDismissThinkOfACard}
			/>,
		);

		const inner = getByTestId("inner");
		inner.focus();
		fireEvent.keyDown(inner, { key: "Escape" });

		expect(onDismissThinkOfACard).toHaveBeenCalledTimes(1);
		expect(onCloseSettings).not.toHaveBeenCalled();
	});

	it("Escape with nothing active dismisses nothing", () => {
		const onCloseSettings = vi.fn();
		const onDismissThinkOfACard = vi.fn();

		const { getByTestId } = render(
			<CoordinationHarness
				isThinkingOfACard={false}
				isSettingsOpen={false}
				onCloseSettings={onCloseSettings}
				onDismissThinkOfACard={onDismissThinkOfACard}
			/>,
		);

		const inner = getByTestId("inner");
		inner.focus();
		fireEvent.keyDown(inner, { key: "Escape" });

		expect(onCloseSettings).not.toHaveBeenCalled();
		expect(onDismissThinkOfACard).not.toHaveBeenCalled();
	});
});

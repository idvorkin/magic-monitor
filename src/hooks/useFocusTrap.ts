import { useEffect, useRef } from "react";

const FOCUSABLE_ELEMENTS = [
	'a[href]:not([tabindex="-1"])',
	'button:not([disabled]):not([tabindex="-1"])',
	'textarea:not([disabled]):not([tabindex="-1"])',
	'input:not([disabled]):not([tabindex="-1"])',
	'select:not([disabled]):not([tabindex="-1"])',
	'[tabindex]:not([tabindex="-1"])',
].join(",");

interface UseFocusTrapOptions {
	isOpen: boolean;
	onClose?: () => void;
}

/**
 * Custom hook that traps focus within a container element
 * and returns focus to the trigger element when the container closes.
 *
 * @param options - Configuration options
 * @param options.isOpen - Whether the focus trap is active
 * @param options.onClose - Optional callback to close the trap (called when Escape is pressed)
 * @returns A ref to attach to the container element
 */
export function useFocusTrap({ isOpen, onClose }: UseFocusTrapOptions) {
	const containerRef = useRef<HTMLDivElement>(null);
	const previousActiveElementRef = useRef<HTMLElement | null>(null);

	useEffect(() => {
		if (!isOpen) return;

		// Store the currently focused element before opening
		previousActiveElementRef.current = document.activeElement as HTMLElement;

		// Focus the first focusable element in the container
		const container = containerRef.current;
		if (container) {
			const focusableElements = container.querySelectorAll<HTMLElement>(
				FOCUSABLE_ELEMENTS,
			);
			if (focusableElements.length > 0) {
				focusableElements[0].focus();
			}
		}

		const handleKeyDown = (e: KeyboardEvent) => {
			// Get container from ref (not closure) to handle dynamic assignment
			const container = containerRef.current;
			if (!container) return;

			// Handle Escape key
			if (e.key === "Escape" && onClose) {
				onClose();
				e.stopPropagation();
				return;
			}

			// Handle Tab key
			if (e.key === "Tab") {
				const focusableElements = Array.from(
					container.querySelectorAll<HTMLElement>(FOCUSABLE_ELEMENTS),
				);

				if (focusableElements.length === 0) return;

				const firstElement = focusableElements[0];
				const lastElement = focusableElements[focusableElements.length - 1];
				const activeElement = document.activeElement as HTMLElement;

				// Shift+Tab on first element -> go to last
				if (e.shiftKey && activeElement === firstElement) {
					e.preventDefault();
					lastElement.focus();
				}
				// Tab on last element -> go to first
				else if (!e.shiftKey && activeElement === lastElement) {
					e.preventDefault();
					firstElement.focus();
				}
			}
		};

		document.addEventListener("keydown", handleKeyDown);

		return () => {
			document.removeEventListener("keydown", handleKeyDown);

			// Return focus to the previously focused element when trap closes
			if (previousActiveElementRef.current) {
				previousActiveElementRef.current.focus();
			}
		};
	}, [isOpen, onClose]);

	return containerRef;
}

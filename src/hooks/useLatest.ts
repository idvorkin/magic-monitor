import { useEffect, useRef } from "react";

/**
 * Returns a ref that always holds the latest value.
 * Use to hand fresh callbacks to long-lived consumers (state machines,
 * event handlers) without recreating them.
 */
export function useLatest<T>(value: T): React.RefObject<T> {
	const ref = useRef(value);
	useEffect(() => {
		ref.current = value;
	});
	return ref;
}

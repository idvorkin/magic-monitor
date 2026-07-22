import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useLatest } from "./useLatest";

describe("useLatest", () => {
	it("returns a ref holding the latest value across re-renders", () => {
		const { result, rerender } = renderHook(({ value }) => useLatest(value), {
			initialProps: { value: 1 },
		});
		const firstRef = result.current;
		expect(firstRef.current).toBe(1);

		rerender({ value: 2 });
		expect(result.current).toBe(firstRef); // stable ref identity
		expect(result.current.current).toBe(2); // latest value
	});
});

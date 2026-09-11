import { act, renderHook } from "@testing-library/react";
import { expect, it } from "vitest";
import { useDeferredDirectorValue } from "./use-director-sync";
it("播放中的同一媒体保持旧源，暂停后采用新源，删除立即清空", () => {
    const { result, rerender } = renderHook(({ id, url, playing }) => useDeferredDirectorValue(id, url, playing), { initialProps: { id: "a", url: "v1", playing: true } });
    rerender({ id: "a", url: "v2", playing: true }); expect(result.current.value).toBe("v1"); expect(result.current.pending).toBe(true);
    act(() => rerender({ id: "a", url: "v2", playing: false })); expect(result.current.value).toBe("v2");
    rerender({ id: "b", url: "b1", playing: true }); expect(result.current.value).toBe("b1");
    act(() => rerender({ id: "b", url: "", playing: true })); expect(result.current.value).toBe("");
});

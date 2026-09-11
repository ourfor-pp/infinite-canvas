import { beforeEach, expect, it, vi } from "vitest";
import { queryClient } from "@/lib/query-client";
import { useDirectorStore } from "@/stores/use-director-store";
import { readDirectorQuery } from "./director-queries";
const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; };
beforeEach(() => { queryClient.clear(); useDirectorStore.setState({ data: { p: { version: 1, epochs: { assets: 1 } } } }); });
it("共享详情请求，途中资源变更后丢弃旧结果并串行重读", async () => {
    const first = deferred<string>(); const read = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue("new");
    const a = readDirectorQuery("p", "assets", ["one"], read); const b = readDirectorQuery("p", "assets", ["one"], read);
    expect(read).toHaveBeenCalledTimes(1);
    useDirectorStore.setState({ data: { p: { version: 2, epochs: { assets: 2 } } } }); first.resolve("old");
    expect(await a).toBe("new"); expect(await b).toBe("new"); expect(read).toHaveBeenCalledTimes(2);
});
it("保存后的强制读取不复用保存前尚未完成的请求", async () => {
    const first = deferred<string>(); const read = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue("saved");
    const old = readDirectorQuery("p", "assets", ["one"], read);
    const saved = readDirectorQuery("p", "assets", ["one"], read, true);
    expect(read).toHaveBeenCalledTimes(1); first.resolve("old");
    expect(await old).toBe("old"); expect(await saved).toBe("saved"); expect(read).toHaveBeenCalledTimes(2);
});

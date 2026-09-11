import { afterEach, describe, expect, it, vi } from "vitest";
import { DirectorSync } from "./director-sync";
import { DIRECTOR_RESOURCES, type DirectorResource, type DirectorSyncSnapshot } from "@/types/director-sync";
const coordinators: DirectorSync[] = [];
const snapshot = (projectId: string, resources: DirectorResource[], version = 1): DirectorSyncSnapshot => ({ projectId, resources, version, data: { state: {} } });
const event = (projectId: string, version: number, resources: DirectorResource[]) => ({ type: "director.project.changed" as const, projectId, version, changes: resources.map((resource) => ({ resource })) });
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; };
function fixture() {
    let version = 1;
    const read = vi.fn(async (id: string, resources: DirectorResource[], _refresh: boolean) => snapshot(id, resources, version));
    const apply = vi.fn(); const failed = vi.fn(); const sync = new DirectorSync({ read, apply, failed }); coordinators.push(sync);
    return { sync, read, apply, failed, version: (value: number) => { version = value; } };
}
afterEach(() => { coordinators.splice(0).forEach((sync) => sync.dispose()); vi.useRealTimers(); });

describe("导演项目同步协调", () => {
    it("100 个变更合并为一次受影响资源请求，不重新读取故事", async () => {
        vi.useFakeTimers(); const f = fixture(); await f.sync.refresh("p"); f.sync.retain("p", ["assets", "generations"]); f.read.mockClear(); f.version(101);
        for (let version = 2; version <= 101; version++) f.sync.changed(event("p", version, ["assets"]));
        await vi.advanceTimersByTimeAsync(100);
        expect(f.read).toHaveBeenCalledTimes(1); expect(f.read).toHaveBeenCalledWith("p", ["assets"], false);
    });
    it("未打开资源只失效，进入对应页面时加载", async () => {
        vi.useFakeTimers(); const f = fixture(); await f.sync.refresh("p"); f.sync.retain("p", ["assets"]); f.read.mockClear(); f.version(2);
        f.sync.changed(event("p", 2, ["story"])); await vi.advanceTimersByTimeAsync(100); expect(f.read).not.toHaveBeenCalled();
        f.sync.retain("p", ["story"]); await vi.advanceTimersByTimeAsync(100); expect(f.read).toHaveBeenCalledWith("p", ["story"], false);
    });
    it("事件在请求中到达时拒绝旧资源结果，串行补读新版本", async () => {
        const f = fixture(); await f.sync.refresh("p"); f.sync.retain("p", ["assets"]); f.apply.mockClear(); const held = deferred<DirectorSyncSnapshot>();
        f.read.mockImplementationOnce(() => held.promise); const pending = f.sync.refresh("p", ["assets"]); f.version(2); f.sync.changed(event("p", 2, ["assets"]));
        held.resolve(snapshot("p", ["assets"], 1)); await pending;
        expect(f.apply.mock.calls.filter(([, resources]) => resources.length).map(([value]) => value.version)).toEqual([2]);
        expect(f.failed).not.toHaveBeenCalled();
    });
    it("重复和乱序事件不回退，版本缺口触发对账", async () => {
        vi.useFakeTimers(); const f = fixture(); await f.sync.refresh("p"); f.sync.retain("p", ["assets", "story"]); f.read.mockClear(); f.version(3);
        f.sync.changed(event("p", 3, ["assets"])); f.sync.changed(event("p", 2, ["story"])); f.sync.changed(event("p", 3, ["assets"]));
        await vi.advanceTimersByTimeAsync(100);
        expect(f.read).toHaveBeenCalledTimes(1); expect(new Set(f.read.mock.calls[0][1])).toEqual(new Set(["assets", "story"])); expect(f.read.mock.calls[0][2]).toBe(true);
    });
    it("跨项目请求响应只写入其所属项目", async () => {
        const f = fixture(); const held = deferred<DirectorSyncSnapshot>(); f.read.mockImplementationOnce(() => held.promise);
        const old = f.sync.refresh("old"); await f.sync.refresh("new"); held.resolve(snapshot("old", [...DIRECTOR_RESOURCES])); await old;
        expect(f.apply.mock.calls.map(([value]) => value.projectId)).toEqual(["new", "old"]);
    });
    it("重连只对活跃项目对账，旧请求不能遮住恢复结果", async () => {
        const f = fixture(); await f.sync.refresh("p"); f.sync.retain("p", ["assets"]); const held = deferred<DirectorSyncSnapshot>(); f.read.mockImplementationOnce(() => held.promise);
        const pending = f.sync.refresh("p", ["assets"]); f.sync.reconnect(); f.version(3); held.resolve(snapshot("p", ["assets"], 1)); await pending;
        expect(f.apply.mock.calls.at(-1)?.[0].version).toBe(3); expect(f.read.mock.calls.at(-1)?.[2]).toBe(true);
    });
    it("错误保留失效资源，不无限重试；显式重试可恢复", async () => {
        const f = fixture(); f.read.mockRejectedValueOnce(new Error("网络断开")); await expect(f.sync.refresh("p")).rejects.toThrow("网络断开");
        expect(f.failed).toHaveBeenCalledTimes(1); await f.sync.refresh("p"); expect(f.apply).toHaveBeenCalledTimes(1);
    });
    it("错误项目响应不能应用到当前缓存", async () => {
        const f = fixture(); f.read.mockResolvedValueOnce(snapshot("foreign", [...DIRECTOR_RESOURCES])); await expect(f.sync.refresh("p")).rejects.toThrow("不一致"); expect(f.apply).not.toHaveBeenCalled();
    });
});

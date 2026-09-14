import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

const root = mkdtempSync(join(tmpdir(), "director-tools-test-"));
process.env.DATA_DIR = root;
const [{ db }, tasks, media, workspace, { storeLocalFile }] = await Promise.all([
    import("../database.js"), import("./director-tools.js"), import("./media-understanding.js"), import("../director-workspace.js"), import("../file-store.js"),
]);
after(() => { db.close(); rmSync(root, { recursive: true, force: true }); });
db.prepare("INSERT INTO users VALUES('u','test',0,datetime('now'),datetime('now'))").run();
for (const id of ["p", "other"]) db.prepare("INSERT INTO projects(id,user_id,kind,title,payload,created_at,updated_at) VALUES(?,'u','director','test','{}',datetime('now'),datetime('now'))").run(id);

test("生成查询先按项目筛选再分页，隐藏完整请求，拒绝其他项目与用户", () => {
    const add = db.prepare("INSERT INTO generations(id,user_id,kind,status,model_id,request,created_at,updated_at) VALUES(?,'u','video','failed','test',?,?,?)");
    for (let i = 0; i < 220; i++) add.run(`other-${i}`, JSON.stringify({ prompt: "private prompt", params: { __directorSegment: { projectId: "other" } } }), "2026-01-02", "2026-01-02");
    for (let i = 0; i < 3; i++) add.run(`own-${i}`, JSON.stringify({ prompt: "private prompt", params: { __directorSegment: { projectId: "p" } } }), "2026-01-01", "2026-01-01");
    const first = tasks.getDirectorGenerationTasks("u", "p", { limit: 2 }) as { items: Array<{ id: string }>; nextOffset: number };
    const second = tasks.getDirectorGenerationTasks("u", "p", { limit: 2, offset: first.nextOffset }) as { items: Array<{ id: string }>; nextOffset: null };
    assert.deepEqual(first.items.map((item) => item.id), ["own-2", "own-1"]);
    assert.deepEqual(second.items.map((item) => item.id), ["own-0"]); assert.equal(second.nextOffset, null);
    assert.doesNotMatch(JSON.stringify(first), /private prompt|request|params/);
    assert.throws(() => tasks.getDirectorGenerationTasks("u", "p", { id: "other-0" }), /不属于当前项目/);
    assert.throws(() => tasks.getDirectorGenerationTasks("foreign", "p", {}), /不属于当前项目/);
});

test("视频按工程路径抽帧与联系表，结果可直接读取，拒绝目录逃逸和符号链接", async () => {
    const folder = workspace.ensureDirectorProjectWorkspace("u", "p");
    const source = join(root, "source.mp4");
    execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc=size=320x180:rate=24", "-t", "2", "-pix_fmt", "yuv420p", source]);
    copyFileSync(source, join(folder, "sample.mp4"));
    const overview = await media.sampleDirectorVideo("u", "p", { path: "sample.mp4", mode: "overview", count: 4 });
    assert.ok("image" in overview); assert.ok(existsSync(join(folder, overview.image!.path)));
    const result = await media.sampleDirectorVideo("u", "p", { path: "sample.mp4", mode: "frames", timesSeconds: [0.25, 1.25] });
    assert.ok("frames" in result); assert.deepEqual(result.frames!.map((frame) => frame.timeSeconds), [0.25, 1.25]);
    assert.ok(result.frames!.every((frame) => frame.path.startsWith(".cache/media-inspection/") && existsSync(join(folder, frame.path))));
    assert.doesNotMatch(JSON.stringify(result), /fileId|\/api\/|\/tmp\//);
    await assert.rejects(media.sampleDirectorVideo("u", "p", { path: "../source.mp4", mode: "frames" }));
    symlinkSync(source, join(folder, "linked.mp4"));
    await assert.rejects(media.sampleDirectorVideo("u", "p", { path: "linked.mp4", mode: "frames" }), /符号链接/);
    await assert.rejects(media.sampleDirectorVideo("foreign", "p", { path: "sample.mp4", mode: "frames" }), /不存在/);
});

test("任务产物提供工程缓存路径；成片列表分页与单项查询，拒绝跨项目", () => {
    const source = join(root, "output.wav");
    writeFileSync(source, "test audio");
    const file = storeLocalFile("u", source, "output.wav", "audio/wav");
    db.prepare("UPDATE generations SET status='succeeded',result=? WHERE id='own-0'").run(JSON.stringify({ files: [file] }));
    const item = tasks.getDirectorGenerationTasks("u", "p", { id: "own-0" });
    assert.ok("outputs" in item);
    assert.ok(Array.isArray(item.outputs));
    assert.equal(typeof item.outputs[0].path, "string");
    assert.ok(existsSync(join(workspace.directorProjectRoot("u", "p"), item.outputs[0].path)));
    const add = db.prepare("INSERT INTO director_renders(id,user_id,project_id,status,payload,created_at,updated_at) VALUES(?,'u',?,'succeeded',?,datetime('now'),datetime('now'))");
    for (let i = 0; i < 3; i++) add.run(`render-${i}`, "p", JSON.stringify({ timelineRevision: 1, duration: 2, warnings: [], privateSnapshot: "hidden" }));
    add.run("foreign-render", "other", "{}");
    const page = tasks.getDirectorRenderTasks("u", "p", { limit: 2 }) as { items: unknown[]; nextOffset: number };
    assert.equal(page.items.length, 2); assert.equal(page.nextOffset, 2); assert.doesNotMatch(JSON.stringify(page), /hidden|privateSnapshot/);
    assert.equal((tasks.getDirectorRenderTasks("u", "p", { id: "render-0" }) as { outputPath: string }).outputPath, "renders/render-0/final.mp4");
    assert.throws(() => tasks.getDirectorRenderTasks("u", "p", { id: "foreign-render" }), /不属于当前项目/);
});


test("缺少媒体快照的旧成片拒绝重试，任务保持失败", async () => {
    const { retryDirectorRender } = await import("../director-render.js");
    db.prepare("INSERT INTO director_timelines(project_id,user_id,revision,created_at,updated_at) VALUES('p','u',2,datetime('now'),datetime('now'))").run();
    db.prepare("UPDATE director_renders SET status='failed' WHERE id='render-0'").run();
    assert.throws(() => retryDirectorRender("u", "render-0"), /缺少媒体快照/);
    assert.equal((db.prepare("SELECT status FROM director_renders WHERE id='render-0'").get() as { status: string }).status, "failed");
});

test("独立配乐按项目查询并保存每次产物，提示改动不覆盖历史且拒绝路径逃逸", () => {
    const projectRoot = workspace.ensureDirectorProjectWorkspace("u", "p");
    const promptPath = "audio/music/cue-1/prompt.md";
    const text = "---\nseconds: 30\nlyrics: '[Instrumental]'\n---\nGlobal Metadata\nQuiet piano.";
    const saved = workspace.writeDirectorMarkdown("u", "p", promptPath, text);
    assert.equal(workspace.readDirectorMusicPrompt("u", "p", promptPath, saved.hash).seconds, 30);
    assert.throws(() => workspace.readDirectorMusicPrompt("u", "p", promptPath, "wrong"), /已修改/);
    assert.throws(() => workspace.readDirectorMusicPrompt("u", "p", "../prompt.md", saved.hash), /配乐提示/);
    assert.throws(() => workspace.readDirectorMusicPrompt("foreign", "p", promptPath, saved.hash), /不存在/);
    const wave = join(root, "music.wav");
    execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=0.1", wave]);
    const file = storeLocalFile("u", wave, "music.wav", "audio/wav");
    db.prepare("INSERT INTO generations(id,user_id,kind,status,model_id,request,result,created_at,updated_at) VALUES('music-1','u','audio','succeeded','test',?,?,'now','now')")
        .run(JSON.stringify({ prompt: "Quiet piano.", model: "test", params: { seconds: 30 }, metadata: { directorMusic: { projectId: "p", promptPath, promptHash: saved.hash } } }), JSON.stringify({ files: [{ fileId: file.fileId }] }));
    const result = tasks.getDirectorGenerationTasks("u", "p", { id: "music-1" }) as any;
    assert.equal(result.music.path, "audio/music/cue-1/outputs/music-1.wav");
    assert.deepEqual(readFileSync(join(projectRoot, result.music.path)), readFileSync(wave));
    assert.throws(() => tasks.getDirectorGenerationTasks("u", "other", { id: "music-1" }), /不属于/);
    workspace.writeDirectorMarkdown("u", "p", promptPath, text + "\nA cello enters.");
    assert.equal((tasks.getDirectorGenerationTasks("u", "p", { id: "music-1" }) as any).music.promptChanged, true);
    writeFileSync(join(projectRoot, result.music.path), "user changed output");
    assert.throws(() => tasks.getDirectorGenerationTasks("u", "p", { id: "music-1" }), /不覆盖/);
    const linkFolder = join(projectRoot, "audio/music/cue-link"); mkdirSync(linkFolder, { recursive: true });
    symlinkSync(join(root, "missing-outside.md"), join(linkFolder, "prompt.md"));
    assert.throws(() => workspace.readDirectorMusicPrompt("u", "p", "audio/music/cue-link/prompt.md", "hash"), /符号链接/);
});

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { after, test } from "node:test";

const testData = mkdtempSync(join(tmpdir(), "infinite-canvas-render-"));
process.env.DATA_DIR = testData;
process.env.APP_SECRET = "director-render-test";

const [{ db }, { storeLocalFile, getStoredFile }, { createDirectorRender }] = await Promise.all([import("./database.js"), import("./file-store.js"), import("./director-render.js")]);
after(() => { db.close(); rmSync(testData, { recursive: true, force: true }); });

test("导演台用 FFmpeg 合成 1080p 24fps H.264/AAC MP4 并保留产物", async () => {
    const userId = "render-user"; const projectId = "render-project"; const now = new Date().toISOString();
    db.prepare("INSERT INTO users(id,username,is_admin,created_at,updated_at) VALUES(?,?,1,?,?)").run(userId, "合成测试", now, now);
    db.prepare("INSERT INTO projects(id,user_id,kind,title,payload,revision,created_at,updated_at) VALUES(?,?,'director',?,?,1,?,?)").run(projectId, userId, "测试长片", JSON.stringify({ id: projectId, kind: "director", title: "测试长片" }), now, now);
    db.prepare("INSERT INTO director_workspaces(project_id,user_id,target_duration_seconds,aspect_ratio,created_at,updated_at) VALUES(?,?,2,'1:1',?,?)").run(projectId, userId, now, now);

    const red = join(testData, "red.mp4"); const blue = join(testData, "blue.mp4"); const tone = join(testData, "tone.wav");
    run("ffmpeg", ["-y", "-f", "lavfi", "-i", "color=c=red:s=320x180:d=1:r=24", "-c:v", "libx264", "-pix_fmt", "yuv420p", red]);
    run("ffmpeg", ["-y", "-f", "lavfi", "-i", "color=c=blue:s=320x180:d=1:r=24", "-c:v", "libx264", "-pix_fmt", "yuv420p", blue]);
    run("ffmpeg", ["-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=2", tone]);
    const files = [storeLocalFile(userId, red, "red.mp4", "video/mp4"), storeLocalFile(userId, blue, "blue.mp4", "video/mp4"), storeLocalFile(userId, tone, "tone.wav", "audio/wav")];
    db.prepare("INSERT INTO director_sequences(id,user_id,project_id,position,title,status,payload,created_at,updated_at) VALUES('seq',?,?,0,'段落','confirmed','{}',?,?)").run(userId, projectId, now, now);
    const insertShot = db.prepare("INSERT INTO director_shots(id,user_id,project_id,sequence_id,position,title,status,payload,created_at,updated_at) VALUES(?,?,?,'seq',?,?,'confirmed',?,?,?)");
    insertShot.run("shot-1", userId, projectId, 0, "红色", JSON.stringify({ durationSeconds: 1, videoFileId: files[0].id }), now, now);
    insertShot.run("shot-2", userId, projectId, 1, "蓝色", JSON.stringify({ durationSeconds: 1, videoFileId: files[1].id }), now, now);
    const timeline = { shotOrder: ["shot-1", "shot-2"], tracks: [{ id: "music", kind: "music", clips: [{ id: "tone", fileId: files[2].id, start: 0, duration: 2, volume: .5 }] }] };
    db.prepare("INSERT INTO director_timelines(project_id,user_id,payload,created_at,updated_at) VALUES(?,?,?,?,?)").run(projectId, userId, JSON.stringify(timeline), now, now);

    const render = createDirectorRender(userId, projectId, { timelineRevision: 1 });
    let row: { status: string; output_file_id: string | null; error: string | null } | undefined;
    for (let index = 0; index < 200; index += 1) {
        row = db.prepare("SELECT status,output_file_id,error FROM director_renders WHERE id=?").get(render.id) as typeof row;
        if (row && ["succeeded", "failed"].includes(row.status)) break;
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
    }
    assert.equal(row?.status, "succeeded", row?.error || "合成超时");
    const output = getStoredFile(userId, row!.output_file_id!);
    assert.ok(output);
    const probe = JSON.parse(run("ffprobe", ["-v", "error", "-show_streams", "-show_format", "-of", "json", output!.path])) as { streams: Array<{ codec_type: string; codec_name: string; width?: number; height?: number; r_frame_rate?: string }>; format: { duration: string } };
    const video = probe.streams.find((stream) => stream.codec_type === "video"); const audio = probe.streams.find((stream) => stream.codec_type === "audio");
    assert.deepEqual({ codec: video?.codec_name, width: video?.width, height: video?.height, fps: video?.r_frame_rate }, { codec: "h264", width: 1080, height: 1080, fps: "24/1" });
    assert.equal(audio?.codec_name, "aac");
    assert.ok(Math.abs(Number(probe.format.duration) - 2) < .15);
});

function run(command: string, args: string[]) {
    const result = spawnSync(command, args, { encoding: "utf8" });
    if (result.status) throw new Error(result.stderr || `${command} 失败`);
    return result.stdout;
}

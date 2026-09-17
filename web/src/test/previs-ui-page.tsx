import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { PrevisViewport } from "@/pages/director/previs-viewport";
import { parsePrevis } from "../../../server/src/previs/model";
import "@/styles/globals.css";

const sample = (id: string) => parsePrevis({ version: 1, id: "scene", name: "测试", objects: [{ id: "actor", name: "角色", kind: "human", position: [0, 0, 0], color: id === "a" ? "#2563eb" : "#be123c" }] }, {
    version: 1, segmentId: id, duration: 2, initial: { actor: { position: [0, 0, 0] } },
    tracks: [{ objectId: "actor", keys: [{ time: 0, position: [0, 0, 0] }, { time: 2, position: [1, 0, 0] }] }],
    shots: [{ id: "wide", name: "全景", start: 0, end: 2, keys: [{ time: 0, position: [0, 1, 5], target: [0, 1, 0] }] }],
});
const raised = (continued: boolean, phaseSeconds = 4) => parsePrevis({ version: 1, id: "scene", name: "持物", objects: [
    { id: "actor", name: "角色", kind: "human", position: [0, 0, 0] },
    { id: "box", name: "盒子", kind: "box", position: [0, 0, 0], size: [.3, .3, .3] },
] }, { version: 1, segmentId: "raised", duration: continued ? 4 : 8, initial: { actor: { position: [0, 0, 0] } },
    actions: [{ id: "raise", objectId: "actor", kind: "raise", side: "left", start: continued ? 0 : 1, end: continued ? 3 : 8, phaseSeconds: continued ? phaseSeconds : 0 }],
    attachments: [{ time: 0, objectId: "box", parentId: "actor", hand: "left" }],
    shots: [{ id: "wide", name: "持物", start: 0, end: continued ? 4 : 8, keys: [{ time: 0, position: [3, 2, 5], target: [0, 1, 0] }] }],
});
function TestPage() {
    const [data, setData] = useState(() => sample("a"));
    const [time, setTime] = useState(1), [selected, setSelected] = useState<string>();
    return <main className="w-[800px] p-4">
        <button onClick={() => setData(sample(data.plan.segmentId === "a" ? "b" : "a"))}>切换分镜段</button>
        <button onClick={() => setData(sample(data.plan.segmentId))}>刷新预演数据</button>
        <button onClick={() => setTime(time === 1 ? 0 : 1)}>定位时间</button>
        <button onClick={() => { setData(raised(false)); setTime(5); }}>拆段前持物</button>
        <button onClick={() => { setData(raised(true)); setTime(0); }}>拆段后持物</button>
        <button onClick={() => { setData(raised(true, 0)); setTime(0); }}>从零抬手</button>
        <output aria-label="当前时刻">{time}</output><output aria-label="当前对象">{selected}</output>
        <PrevisViewport {...data} time={time} aspectRatio="16:9" onSelect={setSelected} />
    </main>;
}
createRoot(document.getElementById("root")!).render(<StrictMode><TestPage /></StrictMode>);

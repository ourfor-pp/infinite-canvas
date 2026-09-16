import { createPrevisRenderer } from "./renderer.js";
import { parsePrevis } from "./model.js";

// The same renderer is mounted by React and by the isolated export browser.
Object.assign(globalThis, { mountPrevis: (scene: unknown, plan: unknown, width: number, height: number) => {
    document.body.style.margin = "0";
    const canvas = document.createElement("canvas"); document.body.replaceChildren(canvas);
    const renderer = createPrevisRenderer(canvas, parsePrevis(scene, plan), width, height);
    return Object.assign(globalThis, { renderPrevis: (time: number) => { renderer.render(time); return canvas.toDataURL("image/png").split(",")[1]; } });
} });

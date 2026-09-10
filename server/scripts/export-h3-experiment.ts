import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { buildH3Experiment, type H3Experiment } from "../src/h3-experiment-workflows.js";

const { values } = parseArgs({ options: { recipe: { type: "string", default: "base" }, mode: { type: "string", default: "ref2va" }, prompt: { type: "string" }, image: { type: "string", default: "reference.jpg" }, seed: { type: "string", default: "314159" }, output: { type: "string" } } });
if (!values.prompt || !values.output || !["base", "lightx2v-ref4", "lightx2v-ref8", "pdd-ref8", "vdn8"].includes(values.recipe) || !["ref2va", "fl2va"].includes(values.mode)) throw new Error("指定 --prompt 文件、--output 文件及有效的 --recipe / --mode");
const experiment = buildH3Experiment({ recipe: values.recipe as H3Experiment, mode: values.mode as "ref2va" | "fl2va", seed: Number(values.seed), prompt: readFileSync(values.prompt, "utf8"), files: [{ fileId: "evaluation-reference", kind: "image", name: values.image }] });
writeFileSync(values.output, JSON.stringify(experiment, null, 2) + "\n");

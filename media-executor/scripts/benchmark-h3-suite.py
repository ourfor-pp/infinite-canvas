#!/usr/bin/env python3
"""Compare base, LightX2V and PDD on the fixed official-skill H3 cases."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import requests

repo = Path(__file__).resolve().parents[2]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--cases", type=Path, default=repo / "media-executor/examples/h3-evaluation/second-batch/cases.json")
parser.add_argument("--inputs", type=Path, required=True, help="Directory containing the original reference images")
parser.add_argument("--output", type=Path, required=True, help="New evidence directory")
parser.add_argument("--recipes", nargs="+", choices=("base", "lightx2v-ref4", "lightx2v-ref8", "pdd-ref8"), default=("base", "lightx2v-ref4", "pdd-ref8"))
parser.add_argument("--case-ids", nargs="+", help="Subset of case IDs from the fixture")
parser.add_argument("--seeds", nargs="+", type=int, help="Explicit fixed seeds; each gets a separate output directory")
args = parser.parse_args()
cases = json.loads(args.cases.read_text())["cases"]
if args.case_ids:
    unknown = set(args.case_ids) - {case["id"] for case in cases}
    if unknown:
        parser.error(f"Unknown case IDs: {sorted(unknown)}")
    cases = [case for case in cases if case["id"] in args.case_ids]
if args.seeds and any(seed < 0 or seed > 2**53 - 1 for seed in args.seeds):
    parser.error("Seeds must be nonnegative JavaScript safe integers")
runs = [(case, seed, recipe) for case in cases for seed in dict.fromkeys(args.seeds or [case["seed"]]) for recipe in dict.fromkeys(args.recipes)]
def run_name(case, seed, recipe):
    return f'{case["id"]}-{recipe}' + (f'-seed-{seed}' if args.seeds else "")
sources = {item["file"]: item for item in json.loads((args.cases.parent / "input-sources.json").read_text())}
args.output = args.output.resolve()
for case in cases:
    image = args.inputs / case["image"]
    prompt = args.cases.parent / case["prompt"]
    if hashlib.sha256(image.read_bytes()).hexdigest() != sources[case["image"]]["sha256"]:
        parser.error(f"Reference image checksum mismatch: {image}")
    if hashlib.sha256(prompt.read_bytes()).hexdigest() != case["promptSha256"]:
        parser.error(f"Prompt checksum mismatch: {prompt}")
if any((args.output / run_name(case, seed, recipe)).exists() for case, seed, recipe in runs):
    parser.error("Use a new output directory to preserve prior evidence")
args.output.mkdir(parents=True, exist_ok=True)
for case, seed, recipe in runs:
    image = args.inputs / case["image"]
    with image.open("rb") as stream:
        response = requests.post("http://127.0.0.1:8190/upload/image", files={"image": (image.name, stream, "image/jpeg")}, timeout=30)
    response.raise_for_status()
    uploaded = response.json()
    name = "/".join(filter(None, [uploaded.get("subfolder"), uploaded["name"]]))
    run = args.output / run_name(case, seed, recipe)
    graph = run.with_suffix(".json")
    subprocess.run(["node", "--import", "tsx", "scripts/export-h3-experiment.ts", "--recipe", recipe, "--mode", "ref2va", "--prompt", str((args.cases.parent / case["prompt"]).resolve()), "--image", name, "--seed", str(seed), "--output", str(graph)], cwd=repo / "server", check=True)
    experiment = json.loads(graph.read_text())
    experiment["recipe"]["caseId"] = case["id"]
    experiment["graph"]["14"]["inputs"]["filename_prefix"] = "H3-Evaluation/" + args.output.name + "/" + run.name
    graph.write_text(json.dumps(experiment, ensure_ascii=False, indent=2) + "\n")
    subprocess.run([sys.executable, str(repo / "media-executor/scripts/benchmark-h3.py"), str(graph), "--output", str(run)], cwd=repo, check=True)

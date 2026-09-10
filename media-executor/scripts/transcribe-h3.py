#!/usr/bin/env python3
"""Offline CPU transcription and timing checks for saved H3 experiments."""
import argparse
import dataclasses
import hashlib
import json
import os
from pathlib import Path
import subprocess
import unicodedata

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("root", type=Path)
parser.add_argument("--cases", type=Path, required=True)
parser.add_argument("--model", type=Path, required=True)
parser.add_argument("--aligner", type=Path, required=True)
parser.add_argument("--output", type=Path, required=True)
parser.add_argument("--timing-tolerance", type=float, default=0.25)
args = parser.parse_args()
if args.timing_tolerance < 0 or not args.model.is_dir() or not args.aligner.is_dir():
    parser.error("Use existing local models and a nonnegative timing tolerance")
os.environ["HF_HUB_OFFLINE"] = "1"
os.environ["TRANSFORMERS_OFFLINE"] = "1"

import torch
from qwen_asr import Qwen3ASRModel

torch.set_num_threads(8)
model = Qwen3ASRModel.from_pretrained(
    str(args.model), dtype=torch.bfloat16, device_map="cpu",
    forced_aligner=str(args.aligner),
    forced_aligner_kwargs={"dtype": torch.bfloat16, "device_map": "cpu"},
    max_new_tokens=128, max_inference_batch_size=1,
)
cases = {case["id"]: case for case in json.loads(args.cases.read_text())["cases"]}
result = {"model": str(args.model), "aligner": str(args.aligner), "device": "cpu",
          "timingToleranceSeconds": args.timing_tolerance,
          "note": "ASR and forced alignment are auxiliary evidence, not listening or lip-sync acceptance.",
          "results": []}

def spoken_text(text):
    return "".join(char for char in text if not char.isspace() and not unicodedata.category(char).startswith("P"))

for report_path in sorted(args.root.glob("*/report.json")):
    report = json.loads(report_path.read_text())
    if report.get("history", {}).get("status", {}).get("status_str") != "success":
        continue
    case = cases[report["recipe"]["caseId"]]
    video = report_path.parent / "output-0.mp4"
    wave = video.with_suffix(".wav")
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(video), "-vn", "-ar", "16000", "-ac", "1", str(wave)], check=True)
    transcription = dataclasses.asdict(model.transcribe(audio=str(wave), language="Chinese", return_time_stamps=True)[0])
    items = (transcription.get("time_stamps") or {}).get("items", [])
    window = [items[0]["start_time"], items[-1]["end_time"]] if items else None
    expected = case["speechWindow"]
    errors = [round(actual - wanted, 3) for actual, wanted in zip(window, expected)] if window and expected else None
    check = {"run": report_path.parent.name, "recipe": report["recipe"],
             "videoSha256": hashlib.sha256(video.read_bytes()).hexdigest(),
             "expectedText": case["expectedText"], "expectedSpeechWindow": expected,
             "transcription": transcription, "actualSpeechWindow": window,
             "transcriptMatches": spoken_text(transcription["text"]) == spoken_text(case["expectedText"]),
             "speechBoundaryErrorsSeconds": errors,
             "speechWithinWindow": errors[0] >= -args.timing_tolerance and errors[1] <= args.timing_tolerance if errors is not None else None,
             "speechWindowMatches": all(abs(error) <= args.timing_tolerance for error in errors) if errors is not None else None,
             "audioAccepted": False}
    result["results"].append(check)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({key: check[key] for key in ("run", "actualSpeechWindow", "transcriptMatches", "speechWindowMatches")}, ensure_ascii=False), flush=True)

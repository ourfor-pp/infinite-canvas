"""Offline graph export for isolated recipe experiments; never submits inference."""
import json
import sys

from . import h3

if __name__ == "__main__":
    value = json.load(sys.stdin)
    request = {"id": "experiment", "model": f"minimax-h3-{value['mode']}-local", "mode": value["mode"], "operation": "generate", "prompt": value["prompt"], "params": {"seed": value["seed"], "seconds": value.get("seconds", 5), "recipe": "base"}, "references": value["files"]}
    plan = h3.prepare(request, {})
    if value["recipe"] == "pdd-ref8":
        plan["recipe"] = "pdd-ref8"
    print(json.dumps(h3.graph(request, plan, {r["fileId"]: r["name"] for r in value["files"]})))

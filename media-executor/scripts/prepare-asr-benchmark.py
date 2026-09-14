#!/usr/bin/env python3
"""Prepare 24 human-read FLEURS test clips and their published reference texts."""
import argparse
import csv
import hashlib
import io
import json
import tarfile
import urllib.request
from pathlib import Path

REVISION = "70bb2e84b976b7e960aa89f1c648e09c59f894dd"
SOURCE = "https://huggingface.co/datasets/google/fleurs"
LANGUAGES = {"cmn_hans_cn": "Chinese", "yue_hant_hk": "Cantonese", "en_us": "English"}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    manifest = args.output / "cases.json"
    if manifest.exists():
        raise SystemExit("Benchmark already exists; use a new output directory")
    cases = []
    for locale, language in LANGUAGES.items():
        base = f"{SOURCE}/resolve/{REVISION}/data/{locale}"
        with urllib.request.urlopen(base + "/test.tsv", timeout=120) as response:
            metadata = response.read()
        (args.output / f"{locale}.tsv").write_bytes(metadata)
        rows = {row[1]: row for row in csv.reader(io.StringIO(metadata.decode()), delimiter="\t")}
        count = 0
        # Archive order is fixed by revision; select before observing model results.
        with urllib.request.urlopen(base + "/audio/test.tar.gz", timeout=120) as response, tarfile.open(fileobj=response, mode="r|gz") as archive:
            for item in archive:
                name = Path(item.name).name
                if not item.isfile() or name not in rows:
                    continue
                row = rows[name]
                audio = archive.extractfile(item).read()
                target = args.output / f"{locale}-{name}"
                target.write_bytes(audio)
                cases.append({"id": f"{locale}-{row[0]}", "language": language, "locale": locale,
                    "file": target.name, "text": row[2], "normalizedReference": row[3],
                    "sha256": hashlib.sha256(audio).hexdigest(), "referenceSource": "published FLEURS reading transcript"})
                count += 1
                if count == 8:
                    break
        if count != 8:
            raise RuntimeError(f"Expected 8 clips for {locale}, got {count}")
        print(f"{locale}: {count} clips", flush=True)
    manifest.write_text(json.dumps({"source": SOURCE, "revision": REVISION, "split": "test", "license": "CC-BY-4.0",
        "selection": "First eight archive entries with published metadata per locale; selected before inference",
        "cases": cases}, ensure_ascii=False, indent=2) + "\n")


if __name__ == "__main__":
    main()

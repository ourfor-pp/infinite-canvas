#!/usr/bin/env python3
"""Summarize persisted H3 experiment costs without treating renders as accepted film."""
import argparse
import json
from pathlib import Path


def summarize(root):
    rows = []
    for path in sorted(root.glob('*/report.json')):
        report = json.loads(path.read_text())
        recipe = report.get('recipe', {})
        history = report.get('history', {})
        status = history.get('status', {})
        times = {name: detail.get('timestamp') for name, detail in status.get('messages', [])}
        start = times.get('execution_start')
        end = times.get('execution_success') or times.get('execution_error')
        seconds = (end - start) / 1000 if start is not None and end is not None else None
        category = recipe.get('category') or ('state-redecode' if recipe.get('mode') == 'state-redecode' else 'state-continuation' if recipe.get('sourceStateSha256') else 'video-generation')
        rows.append({'id': path.parent.name, 'category': category, 'status': status.get('status_str', 'unknown'),
                     'executionSeconds': seconds, 'observedWallSeconds': report.get('seconds'),
                     'gpuPeakTotalUsedMiB': report.get('gpuPeakTotalUsedMiB'),
                     'frames': recipe.get('frames'), 'qualityAccepted': report.get('qualityAccepted') is True,
                     'report': str(path.relative_to(root))})
    totals = {}
    for row in rows:
        total = totals.setdefault(row['category'], {'runs': 0, 'executionSeconds': 0, 'missingTiming': 0})
        total['runs'] += 1
        total['executionSeconds'] += row['executionSeconds'] or 0
        total['missingTiming'] += row['executionSeconds'] is None
    for total in totals.values():
        total['executionSeconds'] = round(total['executionSeconds'], 3)
    music_path = root / 'music/job.json'
    music = json.loads(music_path.read_text()) if music_path.exists() else {}
    timeline_path = root / 'review/timeline.json'
    timeline = json.loads(timeline_path.read_text()) if timeline_path.exists() else {}
    qualified_seconds = timeline.get('seconds', 0) if timeline.get('accepted') is True else 0
    return {'runs': rows, 'byCategory': totals,
            'totalRecordedComfyExecutionSeconds': round(sum(row['executionSeconds'] or 0 for row in rows), 3),
            'music': {'status': music.get('status'), 'observedJobWallSeconds': music.get('elapsedSeconds'), 'inferenceSeconds': None},
            'postproductionRenderSeconds': timeline.get('renderSeconds'),
            'candidateFilmSeconds': timeline.get('seconds'), 'qualifiedFilmSeconds': qualified_seconds,
            'endToEndSecondsPerQualifiedFilmSecond': None, 'monetaryCost': None,
            'limitations': ['Comfy timing includes rejected variants and separates state redecoding from generation.',
                            'Music observed wall time includes queue and recovery; it is not inference time.',
                            'Image generation, research, review, idle time and pricing are not completely measured.',
                            'Unknown end-to-end cost remains null even when a film is accepted.']}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('root', type=Path)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    result = summarize(args.root)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({key: value for key, value in result.items() if key != 'runs'}, ensure_ascii=False, indent=2))

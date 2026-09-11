#!/usr/bin/env python3
"""Deduplicate saved Comfy histories; report measured execution, not total film cost."""
import argparse
import json
from pathlib import Path


def summarize(roots):
    runs = {}
    for root in roots:
        if not root.is_dir():
            raise ValueError(f'History root does not exist: {root}')
        paths = sorted(set(root.rglob('*history.json')) | set(root.rglob('report.json')))
        for path in paths:
            data = json.loads(path.read_text())
            history = data.get('history', data)
            histories = [history] if isinstance(history, dict) and 'prompt' in history else list(history.values()) if isinstance(history, dict) else []
            for history in histories:
                prompt = history.get('prompt') if isinstance(history, dict) else None
                if not isinstance(prompt, list) or len(prompt) < 3:
                    continue
                task_id, graph = prompt[1:3]
                classes = {node['class_type'] for node in graph.values()}
                if not any('H3' in name for name in classes):
                    continue
                status = history['status']
                times = {name: detail.get('timestamp') for name, detail in status['messages']}
                start = times.get('execution_start')
                end = next((times[name] for name in ('execution_success', 'execution_error', 'execution_interrupted') if times.get(name) is not None), None)
                seconds = (end - start) / 1000 if start is not None and end is not None else None
                if seconds is not None and seconds < 0:
                    raise ValueError(f'Negative task duration: {task_id}')
                category = 'continuation' if 'MiniMaxH3AppendContinuation' in classes else 'generation' if 'SamplerCustomAdvanced' in classes else 'state-or-decode'
                row = {'promptId': task_id, 'category': category, 'status': status['status_str'],
                       'executionSeconds': seconds, 'startedAtMilliseconds': start, 'endedAtMilliseconds': end}
                if task_id in runs:
                    previous = {key: value for key, value in runs[task_id].items() if key != 'sources'}
                    if previous != row:
                        raise ValueError(f'Conflicting histories for {task_id}: {path}')
                    runs[task_id]['sources'].append(str(path))
                else:
                    runs[task_id] = {**row, 'sources': [str(path)]}
    rows = sorted(runs.values(), key=lambda row: (row['startedAtMilliseconds'] or 0, row['promptId']))
    return {'roots': [str(root) for root in roots], 'runs': rows, 'uniqueTasks': len(rows),
            'duplicateCopiesExcluded': sum(len(row['sources']) - 1 for row in rows),
            'recordedExecutionSeconds': round(sum(row['executionSeconds'] or 0 for row in rows), 3),
            'missingTimingTasks': sum(row['executionSeconds'] is None for row in rows),
            'failedTasks': sum(row['status'] != 'success' for row in rows),
            'qualifiedFilmSeconds': None, 'endToEndCost': None,
            'limitations': ['Only histories present under the explicit roots are counted; this is not all project work.',
                            'Importing or copying an existing task does not count as another inference.',
                            'Pre-submission failures without Comfy task IDs, image generation, music, review, queueing and pricing are outside this ledger.',
                            'No quality acceptance or end-to-end speedup is inferred from task success.']}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('roots', type=Path, nargs='+')
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    result = summarize(args.roots)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({key: value for key, value in result.items() if key != 'runs'}, ensure_ascii=False))

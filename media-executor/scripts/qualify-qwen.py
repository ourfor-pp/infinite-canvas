#!/usr/bin/env python3
"""Local maintenance-only qualification; never expose unverified models publicly."""
import argparse
import array
import hashlib
import json
import os
import subprocess
import time
import uuid
import wave
from pathlib import Path

from media_executor import app, qwen


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--model', choices=qwen.MODELS, required=True)
    parser.add_argument('--reference', type=Path)
    parser.add_argument('--transcript')
    args = parser.parse_args()
    if not (app.ROOT / 'maintenance').exists():
        raise RuntimeError('qualification requires maintenance admission gate')
    import fcntl
    with (app.ROOT / 'qualification.lock').open('w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        with app.connect() as db:
            if db.execute("SELECT 1 FROM jobs WHERE status IN ('queued','running')").fetchone() or db.execute('SELECT 1 FROM proxy_executions WHERE finished=0').fetchone():
                raise RuntimeError('wait for all queued/running jobs and proxy submissions')
        model_root = Path(os.getenv('MEDIA_MODEL_ROOT', '/data/sas/models'))
        model_dir = model_root / qwen.MODELS[args.model][0]
        source = subprocess.check_output(['git', '-C', str(model_dir), 'remote', 'get-url', 'origin'], text=True).strip()
        expected = 'Qwen/' + qwen.MODELS[args.model][0]
        if source not in [f'https://modelscope.cn/{expected}.git', f'https://www.modelscope.cn/{expected}.git', f'https://huggingface.co/{expected}']:
            raise RuntimeError('model origin is not the official repository')
        subprocess.run(['git', '-C', str(model_dir), 'lfs', 'fsck'], check=True)
        subprocess.run(['git', '-C', str(model_dir), 'diff', '--exit-code', 'HEAD', '--'], check=True, stdout=subprocess.DEVNULL)
        before = qwen.fingerprint(args.model, model_root, app.RUNTIME_ROOT)
        root = app.ROOT / 'qualification' / (args.model + '-' + uuid.uuid4().hex)
        root.mkdir(parents=True)
        params = {'seed': 153, 'language': 'Chinese'}
        if qwen.MODELS[args.model][1] != 'generate_voice_clone':
            params['instructions'] = '温和自然的成年旁白，语速舒缓，吐字清楚，句间自然停顿。'
        refs = [{'path': str(args.reference.resolve()), 'transcript': args.transcript}] if args.reference else []
        text = '窗外的雨渐渐停了。我们慢慢打开窗户，听见树叶上的水滴轻轻落下。'
        qwen.validate(args.model, text, params, refs)
        gpu = app.scheduler()
        owner = root.name
        if not gpu.acquire(owner):
            raise RuntimeError('GPU lease busy')
        runtime = gpu.runtimes['qwen']
        if any(r.status().get('busy') for r in gpu.runtimes.values()):
            gpu.release(owner)
            raise RuntimeError('managed runtime busy; qualification postponed')
        try:
            runtime.start()
            gpu.prepare(owner, 'qwen', 'qualification-' + before)
            result = runtime.request('POST', '/generate', json={'model': args.model, 'prompt': text, 'params': params, 'references': refs, 'outputDir': str(root)}, timeout=None)
            audio = Path(result['files'][0]['path'])
            with wave.open(str(audio)) as wav:
                samples = array.array('h', wav.readframes(wav.getnframes()))
                if wav.getsampwidth() != 2 or not samples or max(abs(v) for v in samples) == 0:
                    raise RuntimeError('smoke output is empty or silent')
                seconds = len(samples) / wav.getnchannels() / wav.getframerate()
            after = qwen.fingerprint(args.model, model_root, app.RUNTIME_ROOT)
            if before != after:
                raise RuntimeError('model/runtime changed during qualification')
            record = {'fingerprint': after, 'smokePassed': True, 'source': source, 'revision': subprocess.check_output(['git', '-C', str(model_dir), 'rev-parse', 'HEAD'], text=True).strip(),
                      'smoke': {'file': str(audio), 'sha256': hashlib.sha256(audio.read_bytes()).hexdigest(), 'seconds': seconds, 'text': text}, 'verifiedAt': time.time()}
            folder = app.ROOT / 'qwen-readiness'
            folder.mkdir(exist_ok=True)
            target = folder / (args.model + '.json')
            temporary = target.with_suffix('.tmp')
            temporary.write_text(json.dumps(record, ensure_ascii=False, indent=2))
            temporary.replace(target)
            print(json.dumps(record, ensure_ascii=False), flush=True)
        finally:
            runtime.stop()
            gpu.release(owner)


if __name__ == '__main__':
    main()

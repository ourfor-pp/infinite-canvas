#!/usr/bin/env python3
"""Protocol-2 example: persist designed speech, ACK, then re-upload for Base."""
import argparse
import hashlib
import json
import os
import time
import uuid
from pathlib import Path

import httpx


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--text', default='窗外的雨渐渐停了。我们慢慢打开窗户，听见树叶上的水滴轻轻落下。')
    parser.add_argument('--instructions', default='温和自然的成年旁白，语速舒缓，吐字清楚，句间自然停顿。')
    parser.add_argument('--new-text', default='傍晚，我们把书放回架子。今天的故事讲完了，明天还会有新的发现。')
    parser.add_argument('--seed', type=int, default=1531)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    with httpx.Client(base_url=os.environ['MEDIA_EXECUTOR_URL'].rstrip('/'), headers={'Authorization': 'Bearer ' + os.environ['MEDIA_EXECUTOR_TOKEN'], 'X-Media-Protocol': '2'}, timeout=60, trust_env=False) as client:
        discovery = client.get("/v1/capabilities"); discovery.raise_for_status()
        available = {item["id"] for item in discovery.json()["capabilities"] if item["available"]}
        if not {"qwen3-tts-1.7b-voicedesign-local", "qwen3-tts-1.7b-base-local"}.issubset(available):
            raise RuntimeError("VoiceDesign and Base must both be available")
        def run(model, text, params, references):
            request = {'id': uuid.uuid4().hex, 'model': model, 'mode': 'speech', 'operation': 'clone' if references else 'generate', 'prompt': text, 'params': params, 'references': references}
            path = args.output / request['id']; path.mkdir()
            (path / 'request.json').write_text(json.dumps(request, ensure_ascii=False, indent=2))
            checked = client.post('/v1/jobs/validate', json=request); checked.raise_for_status()
            submitted = client.post('/v1/jobs', json=request); submitted.raise_for_status()
            while True:
                response = client.get('/v1/jobs/' + request['id']); response.raise_for_status(); job = response.json()
                if job['status'] in ('succeeded', 'failed', 'canceled'): break
                time.sleep(2)
            (path / 'job.json').write_text(json.dumps(job, ensure_ascii=False, indent=2))
            if job['status'] != 'succeeded': raise RuntimeError(job.get('error') or job['status'])
            name = job['result']['files'][0]['name']
            response = client.get('/v1/jobs/' + request['id'] + '/files/' + name); response.raise_for_status()
            output = path / 'speech.wav'; output.write_bytes(response.content)
            (path / 'sha256.txt').write_text(hashlib.sha256(response.content).hexdigest() + '\n')
            acknowledged = client.post('/v1/jobs/' + request['id'] + '/ack'); acknowledged.raise_for_status()
            return output
        designed = run('qwen3-tts-1.7b-voicedesign-local', args.text, {'language': 'Chinese', 'instructions': args.instructions, 'seed': args.seed}, [])
        with designed.open('rb') as stream:
            uploaded = client.post('/v1/files', files={'upload': ('reference.wav', stream, 'audio/wav')})
        uploaded.raise_for_status()
        reused = run('qwen3-tts-1.7b-base-local', args.new_text, {'language': 'Chinese', 'seed': args.seed}, [{'kind': 'audio', 'fileId': uploaded.json()['id'], 'transcript': args.text}])
        print('Designed reference:', designed)
        print('New speech with reference:', reused)


if __name__ == '__main__':
    main()

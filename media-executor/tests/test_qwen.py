import json
from pathlib import Path
from types import SimpleNamespace as NS

import pytest
from fastapi.testclient import TestClient
from media_executor import qwen
from media_executor.capabilities.catalog import describe, prepare
from test_audio_adapters import adapter

CUSTOM, BASE, DESIGN = qwen.MODELS


def info():
    return {'models': {m: qwen.describe(m) for m in qwen.MODELS}, 'modelReadiness': {m: True for m in qwen.MODELS}}


@pytest.mark.parametrize('model,params,refs', [
    (DESIGN, {}, []), (DESIGN, {'instructions': ' '}, []), (DESIGN, {'instructions': '温和', 'speaker': 'Vivian'}, []),
    (DESIGN, {'instructions': '温和'}, [{}]), (BASE, {'instructions': ''}, [{}]), (BASE, {}, []),
    (CUSTOM, {'speed': 0.8}, []), (CUSTOM, {'emotion': 'happy'}, []), (CUSTOM, {'speaker': 'unknown'}, []),
    (CUSTOM, {'language': 'invalid'}, []), (BASE, {'seed': True}, [{}]),
])
def test_rejects_unused_and_invalid_parameters(model, params, refs):
    with pytest.raises(ValueError): qwen.validate(model, '正文', params, refs)


def test_preflight_requires_model_specific_readiness(tmp_path):
    runtime = info()
    runtime['modelReadiness'] = {CUSTOM: True}
    runtime['configuredRuntimes'] = {'qwen': True}
    caps = {v['id']: v for v in describe(runtime)['capabilities']}
    assert caps[CUSTOM]['available'] and not caps[BASE]['available'] and not caps[DESIGN]['available']
    request = {'id': 'a', 'model': DESIGN, 'mode': 'speech', 'operation': 'generate', 'prompt': '正文', 'params': {'instructions': '舒缓'}, 'references': []}
    with pytest.raises(ValueError, match='unavailable'): prepare(request, runtime, tmp_path)
    plan = prepare(request, info(), tmp_path)
    assert type(plan['seed']) is int
    with pytest.raises(ValueError, match='unsupported Qwen'): prepare({**request, 'params': {'instructions': '舒缓', 'speed': 0.8}}, info(), tmp_path)


def test_all_three_methods_receive_only_effective_parameters(tmp_path, monkeypatch):
    calls, seeds, loads = [], [], []
    def generate(method):
        return lambda **kw: calls.append((method, kw)) or ([[0.2]], 24000)
    model = NS(**{method: generate(method) for _, method in qwen.MODELS.values()})
    module = adapter('qwen_tts', monkeypatch, {
        'torch': NS(manual_seed=seeds.append, cuda=NS(manual_seed_all=seeds.append), bfloat16='bf16'),
        'soundfile': NS(write=lambda path, *_: path.write_bytes(b'audio')),
        'qwen_tts': NS(Qwen3TTSModel=NS(from_pretrained=lambda path, **kw: loads.append(path) or model)),
    })
    monkeypatch.setattr(module.importlib.util, 'find_spec', lambda _: None)
    for name, params, refs in [(DESIGN, {'instructions': '慢慢说'}, []), (CUSTOM, {'instructions': '高兴', 'speaker': 'Ryan'}, []), (BASE, {}, [{'path': 'ref.wav', 'transcript': '原文'}]), (BASE, {}, [{'path': 'ref.wav'}])]:
        module.synthesize(module.Request(model=name, prompt='新正文', params={**params, 'seed': 7, 'language': 'Chinese'}, references=refs, outputDir=str(tmp_path)))
    assert [c[0] for c in calls] == ['generate_voice_design', 'generate_custom_voice', 'generate_voice_clone', 'generate_voice_clone']
    assert calls[0][1] == {'text': '新正文', 'language': 'Chinese', 'instruct': '慢慢说'}
    assert calls[1][1]['speaker'] == 'Ryan'
    assert calls[2][1]['ref_text'] == '原文' and 'instruct' not in calls[2][1]
    assert calls[3][1]['x_vector_only_mode'] is True and 'ref_text' not in calls[3][1]
    assert seeds == [7] * 8
    assert len(loads) == 3 and loads[0].endswith('VoiceDesign') and loads[2].endswith('Base')
    with pytest.raises(ValueError, match='unknown Qwen'): module.load('not-base')


def test_readiness_survives_unloaded_worker_but_detects_files_and_code(tmp_path):
    models, runtimes, state = [tmp_path / x for x in ('models', 'runtimes', 'state')]
    folder = models / qwen.MODELS[DESIGN][0]; folder.mkdir(parents=True)
    (folder / 'config.json').write_text('{}'); weight = folder / 'model.safetensors'; weight.write_bytes(b'123')
    rt = runtimes / 'qwen_tts'; (rt / '.venv/bin').mkdir(parents=True)
    for name in ('app.py', 'uv.lock', 'pyproject.toml', '.venv/bin/python'): (rt / name).write_text('test')
    (state / 'qwen-readiness').mkdir(parents=True)
    record = state / 'qwen-readiness' / (DESIGN + '.json')
    def certify(): record.write_text(json.dumps({'fingerprint': qwen.fingerprint(DESIGN, models, runtimes), 'smokePassed': True}))
    certify(); assert qwen.readiness(state, models, runtimes)[DESIGN]
    assert not qwen.readiness(state, models, runtimes)[BASE]
    weight.write_bytes(b'456'); assert not qwen.readiness(state, models, runtimes)[DESIGN]
    certify(); (rt / 'app.py').write_text('changed'); assert not qwen.readiness(state, models, runtimes)[DESIGN]
    certify(); weight.unlink(); assert not qwen.readiness(state, models, runtimes)[DESIGN]


def test_maintenance_blocks_new_jobs_but_preserves_queries_downloads_ack(monkeypatch, tmp_path):
    from test_capability_jobs import setup
    module = setup(monkeypatch, tmp_path)
    monkeypatch.setattr(module, 'health', info)
    headers = {'Authorization': 'Bearer secret', 'X-Media-Protocol': '2'}
    job = {'id': 'existing', 'model': CUSTOM, 'mode': 'speech', 'prompt': '你好'}
    with TestClient(module.app) as client:
        assert client.post('/v1/jobs', json=job, headers=headers).status_code == 202
        (module.ROOT / 'maintenance').touch()
        assert client.post('/v1/jobs', json={**job, 'id': 'new'}, headers=headers).status_code == 503
        assert client.post('/v1/jobs', json=job, headers=headers).status_code == 202
        assert client.get('/v1/jobs/existing', headers=headers).status_code == 200
        assert client.post('/v1/comfy/prompt', headers=headers, json={'client_id': 'new', 'prompt': {}}).status_code == 503
        result = module.RESULTS / 'existing'; result.mkdir(); (result / 'speech.wav').write_bytes(b'audio')
        with module.connect() as db: db.execute("UPDATE jobs SET status='succeeded',result=? WHERE id='existing'", (json.dumps({'files': [{'name': 'speech.wav'}]}),))
        assert client.get('/v1/jobs/existing/files/speech.wav', headers=headers).content == b'audio'
        assert client.post('/v1/jobs/existing/ack', headers=headers).status_code == 200
        assert not result.exists()

"""Fingerprint the exact files resolved by ComfyUI, caching only unchanged files."""
import hashlib
import time
from pathlib import Path

_cache = {}


def comfy_sources(root):
    root = Path(root).resolve(strict=True)
    for name in ('ldm/minimax/model.py', 'ldm/minimax/vae.py', 'ldm/minimax/audio_vae.py'):
        if not (root / name).is_file():
            raise ValueError(f'Missing H3 implementation: {name}')
    return sorted(root.rglob('*.py'))


def file_sha256(path):
    path = Path(path).resolve(strict=True)
    info = path.stat()
    identity = (info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns)
    cached = _cache.get(path)
    stable_large_file = info.st_size > 8 * 1024 * 1024 and time.time_ns() - max(info.st_mtime_ns, info.st_ctime_ns) > 1_000_000_000
    if stable_large_file and cached and cached[0] == identity:
        return cached[1]
    digest = hashlib.sha256()
    with path.open('rb') as source:
        for chunk in iter(lambda: source.read(8 * 1024 * 1024), b''):
            digest.update(chunk)
    after = path.stat()
    if identity != (after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns):
        raise ValueError('Runtime file changed during fingerprinting')
    value = digest.hexdigest()
    _cache[path] = (identity, value)
    return value


def identify(model_path, video_vae_path, audio_vae_path, implementation_paths):
    implementation = hashlib.sha256(''.join(sorted({file_sha256(path) for path in implementation_paths})).encode()).hexdigest()
    return {'schemaVersion': 1, 'modelId': 'minimax-h3-ref2va-local',
            'modelRevision': file_sha256(model_path) + ':pipeline:' + implementation,
            'videoVaeRevision': file_sha256(video_vae_path), 'audioVaeRevision': file_sha256(audio_vae_path),
            'implementationRevision': implementation}

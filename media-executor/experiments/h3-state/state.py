"""Experimental H3 cumulative AV state; no pickle, no process-local cache."""
import json
from pathlib import Path
import torch
from safetensors import safe_open
from safetensors.torch import save_file

FIELDS = {'schemaVersion', 'modelRevision', 'videoVaeRevision', 'audioVaeRevision', 'sourceId', 'width', 'height', 'frames', 'fps'}


def validate(video, audio, context):
    if not isinstance(context, dict) or set(context) != FIELDS or type(context['schemaVersion']) is not int or context['schemaVersion'] != 1 or type(context['fps']) is not int or context['fps'] != 24:
        raise ValueError('Unsupported H3 state metadata')
    for key in ['modelRevision', 'videoVaeRevision', 'audioVaeRevision', 'sourceId']:
        if not isinstance(context[key], str) or not context[key].strip():
            raise ValueError('Missing state provenance: ' + key)
    for key in ['width', 'height', 'frames']:
        if type(context[key]) is not int or context[key] <= 0:
            raise ValueError('Invalid dimensions')
    w, h, frames = (context[k] for k in ['width', 'height', 'frames'])
    if w % 32 or h % 32 or frames < 5 or frames % 17 != 5:
        raise ValueError('Invalid H3 frame or pixel grid')
    shape = (1, 24, (frames - 5) // 17 * 5 + 2, h // 16, w // 16)
    if tuple(video.shape) != shape or tuple(audio.shape) != (1, 32, 2, round(frames * 40 / 24)):
        raise ValueError('AV stream shapes do not match metadata')
    for stream in [video, audio]:
        if stream.dtype not in (torch.float16, torch.bfloat16, torch.float32) or not torch.isfinite(stream).all():
            raise ValueError('Invalid latent values or dtype')


def save(path, video, audio, context):
    validate(video, audio, context)
    # Atomic creation at a caller-owned destination; never overwrite a previous state.
    import os, tempfile
    path = Path(path)
    fd, temporary = tempfile.mkstemp(dir=path.parent, suffix='.safetensors')
    os.close(fd)
    try:
        save_file({'video': video.detach().cpu().contiguous(), 'audio': audio.detach().cpu().contiguous()}, temporary,
                  metadata={'h3_state': json.dumps(context, sort_keys=True)})
        os.link(temporary, path)
    finally:
        Path(temporary).unlink(missing_ok=True)


def load(path, expected):
    with safe_open(path, framework='pt', device='cpu') as source:
        context = json.loads((source.metadata() or {}).get('h3_state', '{}'))
        if context != expected or set(source.keys()) != {'video', 'audio'}:
            raise ValueError('State provenance, format or source mismatch')
        video, audio = source.get_tensor('video'), source.get_tensor('audio')
    validate(video, audio, context)
    return video, audio


def new_av_segment(images, audio, previous_frames):
    """Keep only newly generated frames; reconcile the native 40 Hz audio rounding."""
    if not isinstance(images, torch.Tensor) or images.ndim != 4:
        raise ValueError('Expected decoded IMAGE batch')
    frames = images.shape[0]
    if type(previous_frames) is not int or previous_frames < 0 or previous_frames >= frames:
        raise ValueError('Previous frame count must leave new frames')
    if (frames - 5) % 17 or (previous_frames and (previous_frames - 5) % 17):
        raise ValueError('Expected native H3 frame grid')
    rate = audio.get('sample_rate')
    waveform = audio.get('waveform')
    if type(rate) is not int or rate <= 0 or not isinstance(waveform, torch.Tensor) or waveform.ndim != 3:
        raise ValueError('Expected decoded AUDIO waveform')
    end = round(frames * rate / 24)
    start = round(previous_frames * rate / 24)
    # H3 stores round(frames * 40 / 24) audio latents, at most half a tick away.
    if abs(waveform.shape[-1] - end) > rate / 80 + 1:
        raise ValueError('Decoded audio duration does not match cumulative video')
    suffix = waveform[..., start:end]
    if suffix.shape[-1] < end - start:
        suffix = torch.nn.functional.pad(suffix, (0, end - start - suffix.shape[-1]))
    return images[previous_frames:], {**audio, 'waveform': suffix}

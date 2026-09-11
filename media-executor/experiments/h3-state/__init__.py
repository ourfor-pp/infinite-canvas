"""Experimental ComfyUI nodes for independent H3 continuation jobs."""
import json
from pathlib import Path
from uuid import uuid4

import folder_paths
from comfy.nested_tensor import NestedTensor
from . import state


class H3SaveContinuationState:
    @classmethod
    def INPUT_TYPES(cls):
        return {'required': {'latent': ('LATENT',), 'context': ('STRING', {'multiline': True})}}

    RETURN_TYPES = ('LATENT', 'STRING')
    RETURN_NAMES = ('latent', 'state_name')
    FUNCTION = 'save'
    OUTPUT_NODE = True
    CATEGORY = 'experimental/H3 continuation'

    def save(self, latent, context):
        _verify_runtime(json.loads(context))
        if set(latent) != {'samples'} or not isinstance(latent['samples'], NestedTensor):
            raise ValueError('Only completed native H3 AV samples are supported')
        if len(latent['samples'].tensors) != 2:
            raise ValueError('Expected video and audio streams')
        directory = Path(folder_paths.get_output_directory()) / 'h3-state'
        directory.mkdir(exist_ok=True)
        name = f'{uuid4().hex}.safetensors'
        state.save(directory / name, *latent['samples'].tensors, json.loads(context))
        return {'ui': {'h3_states': [{'filename': name, 'subfolder': 'h3-state', 'type': 'output'}]},
                'result': (latent, name)}


class H3LoadContinuationState:
    @classmethod
    def INPUT_TYPES(cls):
        return {'required': {'state_name': ('STRING',), 'expected_context': ('STRING', {'multiline': True})}}

    RETURN_TYPES = ('LATENT',)
    FUNCTION = 'load'
    CATEGORY = 'experimental/H3 continuation'

    def load(self, state_name, expected_context):
        _verify_runtime(json.loads(expected_context))
        root = Path(folder_paths.get_input_directory()).resolve()
        if Path(state_name).name != state_name or not state_name.endswith('.safetensors'):
            raise ValueError('State must be a filename inside the input directory')
        path = (root / state_name).resolve()
        if path.parent != root:
            raise ValueError('State cannot escape the input directory')
        streams = state.load(path, json.loads(expected_context))
        return ({'samples': NestedTensor(streams)},)

    @classmethod
    def IS_CHANGED(cls, state_name, expected_context):
        # Never reuse a loaded state from a process cache after a file replacement.
        return float('nan')


class H3NewAVSegment:
    @classmethod
    def INPUT_TYPES(cls):
        return {'required': {'images': ('IMAGE',), 'audio': ('AUDIO',),
                             'previous_frames': ('INT', {'default': 0, 'min': 0})}}

    RETURN_TYPES = ('IMAGE', 'AUDIO')
    FUNCTION = 'extract'
    CATEGORY = 'experimental/H3 continuation'

    def extract(self, images, audio, previous_frames):
        return state.new_av_segment(images, audio, previous_frames)


NODE_CLASS_MAPPINGS = {'H3SaveContinuationState': H3SaveContinuationState,
                       'H3LoadContinuationState': H3LoadContinuationState,
                       'H3NewAVSegment': H3NewAVSegment}

# Normal ComfyUI extension route. No node or framework implementation is patched.
import asyncio
import inspect
from aiohttp import web
from server import PromptServer
from . import runtime

_identity_tasks = {}
_initial_identities = {}
_NATIVE_NODES = ('H3SaveContinuationState', 'H3LoadContinuationState', 'H3NewAVSegment',
                 'MiniMaxH3GuidedContinuationWindow', 'MiniMaxH3LatentTailGuide', 'MiniMaxH3AppendContinuation')


def _runtime_identity(recipe='base'):
    if recipe not in ('base', 'pdd-ref8'):
        raise ValueError('Unsupported H3 recipe')
    import nodes
    if any(name not in nodes.NODE_CLASS_MAPPINGS for name in _NATIVE_NODES):
        raise ValueError('Native H3 node set is incomplete')
    implementations = [__file__, state.__file__, runtime.__file__, inspect.getfile(NestedTensor), inspect.getfile(nodes.NODE_CLASS_MAPPINGS["MiniMaxH3ReferenceToVideo"]), folder_paths.get_full_path_or_raise("text_encoders", "qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors")]
    implementations += [inspect.getfile(nodes.NODE_CLASS_MAPPINGS[name]) for name in _NATIVE_NODES]
    implementations += runtime.comfy_sources(Path(folder_paths.__file__).parent / 'comfy')
    identity = runtime.identify(
        folder_paths.get_full_path_or_raise('diffusion_models', 'minimax_h3_ref2va_pruned_int8_convrot.safetensors'),
        folder_paths.get_full_path_or_raise('vae', 'minimax_h3_video_vae_fp16.safetensors'),
        folder_paths.get_full_path_or_raise('vae', 'minimax_h3_audio_vae_fp32.safetensors'), implementations)
    if recipe == 'pdd-ref8':
        pdd_class = nodes.NODE_CLASS_MAPPINGS['MiniMaxH3PDDAccApply']
        pdd_root = Path(inspect.getfile(pdd_class)).parent
        identity = runtime.identify_pdd_ref8(identity,
            folder_paths.get_full_path_or_raise('pdd_acc', 'MiniMax-H3-Ref2VA-Acc-8Step.safetensors'),
            sorted(path for path in pdd_root.rglob('*') if path.is_file() and path.suffix in ('.py', '.json', '.safetensors')))
    if recipe in _initial_identities and identity != _initial_identities[recipe]:
        raise ValueError('Runtime files changed; restart ComfyUI before generating')
    _initial_identities[recipe] = identity
    return identity


def _verify_runtime(context):
    identity = _runtime_identity('pdd-ref8' if ':pdd-ref8:' in str(context.get('modelRevision', '')) else 'base')
    if any(context.get(key) != identity[key] for key in ('modelRevision', 'videoVaeRevision', 'audioVaeRevision')):
        raise ValueError('H3 state context does not match the active runtime')


@PromptServer.instance.routes.get('/h3/runtime')
async def h3_runtime_identity(request):
    recipe = request.query.get('recipe', 'base')
    if recipe not in ('base', 'pdd-ref8'):
        return web.json_response({'ready': False, 'error': 'Unsupported H3 recipe'}, status=400)
    task = _identity_tasks.get(recipe)
    if task is None:
        _identity_tasks[recipe] = asyncio.create_task(asyncio.to_thread(_runtime_identity, recipe))
        return web.json_response({'ready': False}, status=202)
    if not task.done():
        return web.json_response({'ready': False}, status=202)
    try:
        task.result()
        # Check current file identities on every response; unchanged hashes are cached.
        current = await asyncio.to_thread(_runtime_identity, recipe)
    except Exception:
        _identity_tasks.pop(recipe, None)
        return web.json_response({'ready': False, 'error': 'H3 runtime identity unavailable'}, status=503)
    return web.json_response({'ready': True, **current})

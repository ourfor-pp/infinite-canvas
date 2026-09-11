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

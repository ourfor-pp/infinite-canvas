import tempfile,unittest
from pathlib import Path
import torch
from safetensors.torch import save_file
import state
import runtime

class StateTest(unittest.TestCase):
    def setUp(self):
        self.directory=tempfile.TemporaryDirectory();self.addCleanup(self.directory.cleanup)
        self.path=Path(self.directory.name)/'av.safetensors'
        self.context=dict(schemaVersion=1,modelRevision='model-sha',videoVaeRevision='video-sha',audioVaeRevision='audio-sha',sourceId='project/segment/revision',width=32,height=32,frames=22,fps=24)
        self.video=torch.randn(1,24,7,2,2,dtype=torch.float16);self.audio=torch.randn(1,32,2,37)
    def test_exact_roundtrip(self):
        state.save(self.path,self.video,self.audio,self.context)
        v,a=state.load(self.path,self.context)
        self.assertTrue(torch.equal(v,self.video));self.assertTrue(torch.equal(a,self.audio))
        self.assertEqual(v.dtype,self.video.dtype);self.assertEqual(a.dtype,self.audio.dtype)
    def test_refuse_overwrite(self):
        state.save(self.path,self.video,self.audio,self.context);original=self.path.read_bytes()
        with self.assertRaises(FileExistsError):state.save(self.path,self.video+1,self.audio,self.context)
        self.assertEqual(self.path.read_bytes(),original)
    def test_source_and_revision_mismatch(self):
        state.save(self.path,self.video,self.audio,self.context)
        for key in ['sourceId','modelRevision','videoVaeRevision','audioVaeRevision']:
            with self.subTest(key=key),self.assertRaises(ValueError):state.load(self.path,{**self.context,key:'other'})
    def test_grid_and_audio_length(self):
        with self.assertRaises(ValueError):state.save(self.path,self.video,self.audio[..., :-1],self.context)
        with self.assertRaises(ValueError):state.save(self.path,self.video,self.audio,{**self.context,'frames':23})
    def test_nonfinite(self):
        self.video.flatten()[0]=float('nan')
        with self.assertRaises(ValueError):state.save(self.path,self.video,self.audio,self.context)
    def test_unknown_version(self):
        for version in [2, True, '1']:
            with self.subTest(version=version),self.assertRaises(ValueError):state.save(self.path,self.video,self.audio,{**self.context,'schemaVersion':version})
    def test_truncated_file(self):
        state.save(self.path,self.video,self.audio,self.context);self.path.write_bytes(self.path.read_bytes()[:30])
        with self.assertRaises(Exception):state.load(self.path,self.context)
    def test_new_segment_preserves_frame_and_audio_start(self):
        images=torch.arange(362).reshape(362,1,1,1)
        waveform=torch.arange(482400).reshape(1,1,-1).float()
        new_images,new_audio=state.new_av_segment(images,{'waveform':waveform,'sample_rate':32000},243)
        self.assertEqual(new_images.shape[0],119)
        self.assertEqual(new_images[0].item(),243)
        self.assertEqual(new_images[-1].item(),361)
        self.assertEqual(new_audio['waveform'].shape[-1],158667)
        self.assertTrue(torch.equal(new_audio['waveform'][...,:158400],waveform[...,324000:]))
        self.assertEqual(torch.count_nonzero(new_audio['waveform'][...,158400:]).item(),0)
    def test_new_segment_rejects_missing_audio_or_wrong_frame_grid(self):
        images=torch.zeros(362,1,1,1)
        audio={'waveform':torch.zeros(1,2,482400),'sample_rate':32000}
        for previous in [True,-1,242,362]:
            with self.subTest(previous=previous),self.assertRaises(ValueError):state.new_av_segment(images,audio,previous)
        with self.assertRaises(ValueError):state.new_av_segment(images,{**audio,'waveform':audio['waveform'][...,:100]},243)
    def test_runtime_fingerprint_invalidates_modified_files(self):
        self.path.write_bytes(b'original model')
        first=runtime.file_sha256(self.path)
        self.assertEqual(runtime.file_sha256(self.path),first)
        self.path.write_bytes(b'modified model')
        self.assertNotEqual(runtime.file_sha256(self.path),first)
    def test_runtime_identity_uses_content_not_install_path(self):
        self.path.write_bytes(b'model')
        code=Path(self.directory.name)/'code.py';code.write_text('implementation')
        copy=Path(self.directory.name)/'copy.py';copy.write_bytes(code.read_bytes())
        first=runtime.identify(self.path,self.path,self.path,[code])
        moved=runtime.identify(self.path,self.path,self.path,[copy])
        self.assertEqual(first,moved)
        copy.write_text('changed implementation')
        changed=runtime.identify(self.path,self.path,self.path,[copy])
        self.assertNotEqual(first['modelRevision'],changed['modelRevision'])
    def test_pdd_identity_and_state_are_bound_to_weights_and_implementation(self):
        weights=Path(self.directory.name)/'pdd.safetensors';weights.write_bytes(b'pdd weights')
        code=Path(self.directory.name)/'pdd.py';code.write_text('pdd implementation')
        base={'modelRevision':'base', 'videoVaeRevision':'video', 'audioVaeRevision':'audio'}
        first=runtime.identify_pdd_ref8(base,weights,[code])
        self.assertNotEqual(first['modelRevision'],base['modelRevision'])
        copied=Path(self.directory.name)/'copied.py';copied.write_bytes(code.read_bytes())
        self.assertEqual(first,runtime.identify_pdd_ref8(base,weights,[copied]))
        context={**self.context,'modelRevision':first['modelRevision']}
        state.save(self.path,self.video,self.audio,context)
        with self.assertRaises(ValueError):state.load(self.path,{**context,'modelRevision':base['modelRevision']})
        for target in [weights,code]:
            target.write_bytes(target.read_bytes()+b' changed')
            changed=runtime.identify_pdd_ref8(base,weights,[code])
            self.assertNotEqual(first['modelRevision'],changed['modelRevision'])
            with self.assertRaises(ValueError):state.load(self.path,{**context,'modelRevision':changed['modelRevision']})
        self.assertEqual(base['modelRevision'],'base')
    def test_decoder_and_shared_comfy_changes_invalidate_pipeline(self):
        root=Path(self.directory.name)/'comfy'
        for name in ['ldm/minimax/model.py','ldm/minimax/vae.py','ldm/minimax/audio_vae.py','ops.py']:
            path=root/name;path.parent.mkdir(parents=True,exist_ok=True);path.write_text(name)
        self.path.write_bytes(b'unchanged weights')
        def identity():return runtime.identify(self.path,self.path,self.path,runtime.comfy_sources(root))
        previous=identity()
        for name in ['ldm/minimax/vae.py','ldm/minimax/audio_vae.py','ops.py']:
            with self.subTest(name=name):
                (root/name).write_text(name+' changed')
                current=identity()
                self.assertNotEqual(previous['modelRevision'],current['modelRevision'])
                self.assertEqual(previous['videoVaeRevision'],current['videoVaeRevision'])
                previous=current
        (root/'ldm/minimax/vae.py').unlink()
        with self.assertRaises(ValueError):runtime.comfy_sources(root)
if __name__=='__main__':unittest.main()

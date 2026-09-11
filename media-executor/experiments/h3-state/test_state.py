import tempfile,unittest
from pathlib import Path
import torch
from safetensors.torch import save_file
import state

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
if __name__=='__main__':unittest.main()

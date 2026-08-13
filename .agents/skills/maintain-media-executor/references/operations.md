# Operations

## Upgrade

Pin code and model revisions. Install into a new checkout or revisioned model directory, run imports and smoke tests, drain the queue, switch paths, restart only affected units, and retain the previous revision until acceptance.

## Rollback

Drain or cancel work, restore the previous code/model paths, restart affected units, and verify health plus one minimal generation. Do not mutate application-server generation history.

## Offline runtime

Check `systemctl status`, `journalctl`, the runtime `.venv`, direct module imports, model directory and manifest, `nvidia-smi`, loopback port ownership, then `/health`. A gateway model declaration does not prove the runtime is ready.

For Qwen/MOSS, require both a direct runtime generation and a gateway job with result download plus ACK. For ACE, the small adapter environment is not the engine: require `third_party/ACE-Step-1.5/.venv/bin/acestep-api`, complete checkpoints, engine `/health`, and a music generation before marking it online.

If ACE reports success but produces electrical noise, inspect the actual stored file with `ffmpeg astats` and a spectrogram. For XL SFT ordinary generation, confirm 50 steps, shift 1, DCW disabled, and LM audio-code cover strength 0. The upstream REST request originally omitted DCW fields and defaulted code strength to 1; the repository patch `ace-step-rest-quality.patch` must remain applied. A valid container and nonzero waveform are not a quality smoke test.

The pinned ACE API constructs `<source>/checkpoints` internally in several paths even when `ACESTEP_CHECKPOINTS_DIR` is set. `install-ace-step.sh` therefore owns a symlink from that location to `/data/sas/models/ACE-Step1.5`; verify it with `readlink -f` before smoke testing. If a mistaken download has already started, stop and kill the entire ACE engine unit before moving the partial directory to a recoverable state location.

If MOSS inference finishes but WAV saving fails with missing TorchCodec, keep the adapter's `soundfile` path; do not add a large codec dependency only for PCM WAV output.

If VoxCPM2 fails during AudioVAE decode with `failed to open libnvrtc-builtins.so.13.0`, first compare `torch.version.cuda` with the libraries inside the exact ComfyUI virtual environment. For the current CUDA 13 wheel, verify both `nvidia/cu13/lib/libnvrtc.so.13` and `libnvrtc-builtins.so.13.0`, then inspect the service's `Environment`. Apply `systemd/comfyui-h3.service.d/10-infinite-media.conf` so that this directory is on `LD_LIBRARY_PATH`, reload and restart after checking `/queue`, and prove the repair with inference rather than `/system_stats`. Do not cross-link NVRTC builtins from CUDA 12.8; the compiler and builtins major versions must match.

## OOM

Confirm only one executor GPU job is active. Check `nvidia-smi`, then map every unexpected PID through `/proc/<pid>/cgroup` before stopping anything. ACE XL SFT plus the 1.7B LM uses about 22GB on the 32GB 5090; both project ComfyUI units must be drained for music tasks. Configure their real names with `configure-gpu-drain.sh` and verify they return active after the gateway job. Enable CPU/DiT offload and expandable CUDA segments; lower duration or steps only for smoke tests, not as a hidden quality fallback.

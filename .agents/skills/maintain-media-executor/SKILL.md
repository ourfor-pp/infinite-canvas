---
name: maintain-media-executor
description: Deploy, upgrade, inspect, test, and recover the Infinite Canvas GPU media executor and its ComfyUI, Qwen TTS, MOSS SoundEffect, ACE-Step, and Stable Audio runtimes. Use for media-executor installation, model download, systemd services, remote application-server connection, runtime offline states, GPU/OOM diagnosis, revision upgrades, rollback, and health verification.
---

# Maintain Media Executor

Treat `media-executor/` as an independently deployable GPU service. Keep the application server and authoritative media files outside it.

## Workflow

1. Read `media-executor/README.md`, `systemd/media-executor.env.example`, and `references/topology.md`.
2. Run `scripts/audit.sh` before changing anything. Record GPU, disk, ports, service state, configured revisions, and model paths.
3. Keep only port 8290 reachable from the application-server network. Bind ComfyUI and all native runtimes to `127.0.0.1`.
4. Use a long random Bearer token. Save the same token in the executor environment and application-server encrypted settings. Never print it in reports.
5. Install every native runtime in its own `.venv`. Do not reuse system Python or ComfyUI's environment.
6. Keep `/data/sas/models` as the stable model entrypoint. Put only models used by enabled runtimes on SSD/NVMe under `~/.local/share/infinite-media-executor/models`, then symlink each model directory from the entrypoint, matching the existing ComfyUI pattern. Verify link targets with `findmnt` and `lsblk` (`ROTA=0`). Run `media-executor/scripts/download-models.sh`; it uses pinned official ModelScope commits and writes `manifest.json`. Use official Hugging Face only when ModelScope lacks the repository.
7. Deploy or upgrade one runtime at a time. Verify import, `/health`, one minimal inference, output transfer, and GPU memory release before proceeding.
8. Keep Stable Audio disabled until the administrator explicitly confirms its license.
9. After changes, run `scripts/audit.sh`, executor tests, server tests, and a remote request from the application server.

Use Python 3.12 for Qwen, MOSS, and ACE environments. Qwen also requires system SoX. Install persistent development-host units with `media-executor/scripts/install-user-services.sh`; inspect the generated environment before starting services.

Install pinned ACE-Step with `media-executor/scripts/install-ace-step.sh`. It applies the repository-owned Linux/Python 3.12 lock patch, omits optional flash-attn in favor of SDPA, and links the upstream API's hard-coded `checkpoints` directory to the SSD model root. Never advertise ACE until the official engine imports and a real music generation succeeds.
For XL SFT text-to-music, keep `shift=1`, use 50 steps, and explicitly set both `dcw_enabled=false` and `audio_cover_strength=0` while `thinking=true`. Current upstream defaults combine DCW with full-strength LM audio-code conditioning and can produce broadband electrical noise or degenerate sounds. Cover/Remix may use their explicit reference strength; do not apply that strength to ordinary generation. Validate actual audio statistics/spectrum, not merely WAV readability.
ACE-Step XL SFT cannot coexist with the project's ComfyUI processes on a 32GB 5090. Configure exact host units with `scripts/configure-gpu-drain.sh`; the executor must reject a busy Comfy queue, pause active Comfy/Qwen/MOSS units, run ACE, unload ACE, restore only previously active units, then restart ACE in lazy-load health mode. System units require the narrow sudoers rules in `systemd/infinite-media-executor-sudoers`.
Keep `ACE_STEP_ENABLED=0` until that full smoke test passes; set it with `scripts/set-runtime-enabled.sh ace 1`, reinstall units, and restart the gateway only after success. Keep `STABLE_AUDIO_3_LICENSE_ACCEPTED=0` until license approval and inference verification.

VoxCPM2 runs inside the CUDA 13 ComfyUI environment. Its systemd service must include the environment's `nvidia/cu13/lib` directory in `LD_LIBRARY_PATH`; having the wheel installed is not sufficient because NVRTC loads `libnvrtc-builtins.so.13.0` by name at runtime. Run `media-executor/scripts/install-comfyui-h3-dropin.sh`; it refuses to restart a busy queue and installs the repository drop-in. Then run a real VoxCPM2 generation. Never symlink a CUDA 12 builtins library to satisfy CUDA 13.

## Safety

- Never delete model directories during an upgrade. Download into a revisioned sibling directory, verify it, then switch the environment path.
- Never expose ports 8189, 8001, or 8301–8304 to the LAN.
- Stop or drain generation work before restarting a GPU runtime.
- Never move or replace an ACE `checkpoints` directory while its API process is alive; stop and kill the complete unit cgroup first. A ModelScope snapshot thread may otherwise continue writing through the old directory inode.
- Diagnose `runtime offline` by checking the runtime unit, import errors, model path, CUDA visibility, and port binding in that order.
- Treat gateway health as insufficient: a declared model is usable only when its engine health is online and a smoke generation succeeds.

## Operations

- For first deployment or host migration, read `references/deployment.md`.
- For upgrades and rollback, read `references/operations.md`.
- Use `scripts/audit.sh` for a non-mutating status report.

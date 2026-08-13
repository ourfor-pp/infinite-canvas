# Topology

```text
Application server
  └─ HTTPS/LAN + Bearer → media executor :8290
       ├─ SQLite queue and temporary files
       ├─ ComfyUI proxy → 127.0.0.1:8189
       ├─ Qwen TTS     → 127.0.0.1:8301
       ├─ MOSS SFX     → 127.0.0.1:8302
       ├─ ACE adapter  → 127.0.0.1:8303 → ACE API :8001
       └─ Stable Audio → 127.0.0.1:8304
```

The application server owns generation records and final files. The executor owns only recoverable execution state and unacknowledged temporary files. A generation ID is the idempotency key.

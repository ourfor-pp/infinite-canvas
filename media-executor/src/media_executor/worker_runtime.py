"""Lazy isolated Python processes using private filesystem sockets, without TCP ports."""
import json
import os
import signal
import subprocess
import time
from pathlib import Path

import httpx

from .lifecycle import ManagedRuntime

RUNTIME_FOLDERS = {"qwen": "qwen_tts", "moss": "moss_sfx", "asr": "qwen_asr", "vox": "voxcpm", "index": "indextts", "ace": "ace_step", "stable": "stable_audio"}
RUNTIME_ROOT = Path(os.getenv("MEDIA_EXECUTOR_RUNTIME_ROOT", str(Path(__file__).resolve().parents[2] / "runtimes")))


class WorkerRuntime(ManagedRuntime):
    def __init__(self, name, root, memory, units=(), command=None):
        super().__init__("http://worker", units, command, memory, "ace" if name == "ace" else "native")
        self.folder = RUNTIME_ROOT / RUNTIME_FOLDERS[name]
        self.socket = root / f"{name}.sock"
        self.process = None

    def pid(self):
        if self.process is not None:
            self.process.poll()  # Reap exited children before inspecting procfs.
        try:
            record = json.loads(self.socket.with_suffix(".json").read_text())
            pid = record["pid"]
            proc = Path(f"/proc/{pid}")
            args = (proc / "cmdline").read_bytes().split(b"\0")
            ticks = (proc / "stat").read_text().rsplit(")", 1)[1].split()[19]
            if ticks == record["ticks"] and b"media_executor.worker" in args and os.fsencode(self.socket) in args and os.getpgid(pid) == pid:
                return pid
        except (OSError, ValueError, KeyError):
            pass
        return None

    def pids(self):
        pid = self.pid()
        result = super().pids() if self.units else []
        if pid:
            for path in Path("/proc").glob("[0-9]*/stat"):
                try:
                    if int(path.read_text().rsplit(")", 1)[1].split()[2]) == pid:
                        result.append(int(path.parent.name))
                except (OSError, ValueError):
                    pass
        return result

    def request(self, method, path, **kwargs):
        timeout = kwargs.pop("timeout", 15)
        with httpx.Client(transport=httpx.HTTPTransport(uds=str(self.socket)), timeout=timeout, trust_env=False) as client:
            response = client.request(method, self.url + path, **kwargs)
            response.raise_for_status()
            return response.json()

    def status(self):
        if not self.pid():
            return {"pids": self.pids(), "busy": False, "loaded": []}
        return {**self.request("GET", "/runtime"), "pids": self.pids()}

    def start(self):
        for scope, unit in reversed(self.units):
            self.command(scope, "start", [unit])
        if not self.pid():
            self.socket.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            env = {**os.environ, "PYTHONPATH": str(Path(__file__).resolve().parents[1])}
            libraries = list((self.folder / ".venv/lib").glob("python*/site-packages/nvidia/cu13/lib"))
            if libraries:
                env["LD_LIBRARY_PATH"] = ":".join([str(libraries[0]), env.get("LD_LIBRARY_PATH", "")]).rstrip(":")
            with self.socket.with_suffix(".log").open("ab") as log:
                self.process = subprocess.Popen([str(self.folder / ".venv/bin/python"), "-m", "media_executor.worker", str(self.socket)], cwd=self.folder, env=env, stdout=log, stderr=log, start_new_session=True)
        deadline = time.monotonic() + 180
        while True:
            if self.process is not None and self.process.poll() is not None:
                raise RuntimeError(f"Model worker exited; inspect {self.socket.with_suffix('.log')}")
            try:
                if self.pid():
                    if self.request("GET", "/health").get("ok"):
                        return self.request("GET", "/runtime")
            except httpx.HTTPError:
                pass
            if time.monotonic() >= deadline:
                self.stop()
                raise RuntimeError("Model worker startup timed out")
            time.sleep(.2)

    def stop(self):
        pid = self.pid()
        if pid:
            os.killpg(pid, signal.SIGTERM)
            deadline = time.monotonic() + 10
            while self.pid() and time.monotonic() < deadline:
                time.sleep(.1)
            # The group was verified as this worker before signaling it.
            try:
                os.killpg(pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            if self.process is not None:
                self.process.wait(timeout=10)
        for scope, unit in self.units:
            self.command(scope, "stop", [unit])
        if self.pids():
            raise RuntimeError("Model worker did not stop")

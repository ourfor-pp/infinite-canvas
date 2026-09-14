"""Lifecycle adapters; only explicitly configured systemd units may be stopped."""
import time
from pathlib import Path

import httpx


class ManagedRuntime:
    def __init__(self, url, units, command, memory, kind="native"):
        self.url, self.units, self.command, self.memory, self.kind = url.rstrip("/"), units, command, memory, kind

    def pids(self):
        result = []
        for scope, unit in self.units:
            value = self.command(scope, "show", [unit, "--property=ControlGroup", "--value"])
            group = value.stdout.strip()
            if not group:
                continue
            root = Path("/sys/fs/cgroup") / group.lstrip("/")
            for path in root.rglob("cgroup.procs"):
                result.extend(int(pid) for pid in path.read_text().split())
        return sorted(set(result))

    def request(self, method, path, **kwargs):
        with httpx.Client(timeout=15, trust_env=False) as client:
            response = client.request(method, self.url + path, **kwargs)
            response.raise_for_status()
            return response.json() if response.content else {}

    def status(self):
        pids = self.pids()
        if not pids:
            return {"pids": [], "busy": False, "loaded": []}
        if self.kind == "comfy":
            return {**self.request("GET", "/infinite/runtime"), "pids": pids}
        state = self.request("GET", "/runtime")
        return {**state, "pids": pids}

    def start(self):
        for scope, unit in reversed(self.units):
            self.command(scope, "start", [unit])
        deadline = time.monotonic() + 180
        while True:
            try:
                return self.status()
            except httpx.HTTPError:
                if time.monotonic() >= deadline:
                    raise
                time.sleep(.5)

    def stop(self):
        for scope, unit in self.units:
            self.command(scope, "stop", [unit])
        if self.pids():
            raise RuntimeError("managed runtime did not stop")

    def cancel(self, job_id):
        state = self.status()
        if state.get("busy") and state.get("jobId") != job_id:
            raise RuntimeError("refusing to cancel a different runtime job")
        if state.get("busy"):
            self.stop()

    def clear_cache(self):
        if self.status().get("busy"):
            raise RuntimeError("cannot free a busy runtime")
        if self.kind == "comfy":
            self.request("POST", "/free", json={"free_memory": True, "unload_models": False})
        else:
            self.request("POST", "/runtime/clear-cache")

    def unload(self):
        state = self.status()
        if state.get("busy"):
            raise RuntimeError("cannot evict a busy runtime")
        before = sum(self.memory().processes.get(pid, 0) for pid in state["pids"])
        if self.kind == "ace":
            self.stop()
            return
        if self.kind == "comfy":
            self.request("POST", "/free", json={"free_memory": True, "unload_models": True})
        else:
            self.request("POST", "/runtime/unload")
        deadline = time.monotonic() + 10
        while True:
            current = self.status()
            after = sum(self.memory().processes.get(pid, 0) for pid in current["pids"])
            if after < before or before == 0 and not current.get("loaded"):
                return
            if time.monotonic() >= deadline:
                if current.get("busy"):
                    raise RuntimeError("runtime became busy during eviction")
                # Leave stopped. The target is started only when its next job arrives.
                self.stop()
                return
            time.sleep(.25)

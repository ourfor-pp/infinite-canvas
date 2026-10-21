"""Single-device admission and pressure-driven eviction of idle runtimes."""
import hashlib
import json
import threading
import time
from dataclasses import dataclass
from typing import Callable

GIB = 1024 ** 3


@dataclass(frozen=True)
class Memory:
    total: int
    free: int
    processes: dict[int, int]


class Nvml:
    def __init__(self, index=0):
        import pynvml
        self.api = pynvml
        pynvml.nvmlInit()
        self.device = pynvml.nvmlDeviceGetHandleByIndex(index)

    def read(self):
        info = self.api.nvmlDeviceGetMemoryInfo(self.device)
        processes = self.api.nvmlDeviceGetComputeRunningProcesses(self.device)
        return Memory(info.total, info.free, {p.pid: p.usedGpuMemory for p in processes if 0 <= p.usedGpuMemory <= info.total})


def profile_key(request, revision):
    # Exact input/recipe shapes only: a shorter sample never budgets a longer job.
    params = {k: v for k, v in request.get("params", {}).items() if k != "seed"}
    refs = [{k: v for k, v in ref.items() if k != "fileId"} for ref in request.get("references", [])]
    shape = {"model": request["model"], "revision": revision, "mode": request.get("mode"),
             "operation": request.get("operation"), "params": params, "references": refs,
             "textLength": len(request.get("prompt", "")), "continuation": request.get("continuation")}
    return hashlib.sha256(json.dumps(shape, sort_keys=True).encode()).hexdigest()


class Scheduler:
    def __init__(self, connect, memory: Callable[[], Memory], runtimes, wait_seconds=600):
        self.connect, self.memory, self.runtimes = connect, memory, runtimes
        self.wait_seconds = wait_seconds
        self.lock = threading.Lock()
        self.owner = None
        with connect() as db:
            db.execute("CREATE TABLE IF NOT EXISTS gpu_profiles (key TEXT PRIMARY KEY, peak INTEGER NOT NULL, samples INTEGER NOT NULL, resident INTEGER NOT NULL, load_seconds REAL NOT NULL, loaded TEXT NOT NULL)")
            db.execute("CREATE TABLE IF NOT EXISTS gpu_usage (runtime TEXT PRIMARY KEY, last_used REAL NOT NULL)")

    def acquire(self, job_id):
        with self.lock:
            if self.owner is not None:
                return False
            self.owner = job_id
            return True

    def release(self, job_id):
        with self.lock:
            if self.owner != job_id:
                raise RuntimeError("GPU lease owner mismatch")
            self.owner = None

    def prepare(self, job_id, target, key, canceled=lambda: False, report=lambda _: None, force=False, budget=None):
        if self.owner != job_id:
            raise RuntimeError("GPU admission requires lease")
        with self.connect() as db:
            row = db.execute("SELECT peak,resident,loaded FROM gpu_profiles WHERE key=?", (key,)).fetchone()
            used = dict(db.execute("SELECT runtime,last_used FROM gpu_usage"))
        deadline = time.monotonic() + self.wait_seconds
        events = []
        cleared = set()
        evicted = set()
        stopped = set()
        while True:
            if canceled():
                raise RuntimeError("canceled")
            memory = self.memory()
            states = {name: runtime.status() for name, runtime in self.runtimes.items()}
            target_pids = states[target].get("pids", [])
            resident = sum(memory.processes.get(pid, 0) for pid in target_pids)
            reserve = max(GIB, int(memory.total * .05))
            # Unknown shapes get the whole device budget, minus fixed foreign usage.
            managed = {pid for state in states.values() for pid in state.get("pids", [])}
            foreign = sum(size for pid, size in memory.processes.items() if pid not in managed)
            reusable = resident if target == "comfy" or budget is not None or row and json.dumps(states[target].get("loaded"), sort_keys=True) == row[2] else 0
            peak = max(row[0] if row else 0, budget or 0)
            required = max(0, peak - reusable) + reserve if row or budget is not None else max(0, memory.total - foreign - resident - reserve)
            candidates = [name for name, state in states.items() if name != target and not state.get("busy") and (state.get("loaded") or any(memory.processes.get(pid, 0) for pid in state.get("pids", [])))]
            candidates.sort(key=lambda name: used.get(name, 0))
            must_evict = (force or row is None and budget is None) and any(name not in evicted for name in candidates)
            busy = [name for name, state in states.items() if name != target and state.get("busy")]
            report({"phase": "reclaiming" if memory.free < required or must_evict else "loading", "freeBytes": memory.free,
                    "requiredBytes": required, "foreignBytes": foreign, "profileKnown": row is not None, "qualifiedBudgetBytes": budget, "events": events})
            if memory.free >= required and not must_evict and not busy:
                return events
            cache = next((name for name in candidates if name not in cleared), None)
            victim = next((name for name in candidates if name not in evicted), None)
            residual = next((name for name in candidates if name in evicted and name not in stopped), None)
            if cache:
                cleared.add(cache)
                try:
                    self.runtimes[cache].clear_cache()
                    events.append({"runtime": cache, "action": "clear_cache"})
                except Exception as error:
                    events.append({"runtime": cache, "action": "clear_cache_failed", "error": str(error)})
            elif victim:
                evicted.add(victim)
                try:
                    self.runtimes[victim].unload()
                    events.append({"runtime": victim, "action": "unload", "reason": "oom" if force else "memory_budget"})
                except Exception as error:
                    events.append({"runtime": victim, "action": "unload_failed", "error": str(error)})
            elif residual and memory.free < required:
                stopped.add(residual)
                try:
                    if self.runtimes[residual].status().get("busy"):
                        raise RuntimeError("runtime became busy after unload")
                    self.runtimes[residual].stop()
                    events.append({"runtime": residual, "action": "stop", "reason": "residual_memory_after_unload"})
                except Exception as error:
                    events.append({"runtime": residual, "action": "stop_failed", "error": str(error)})
            elif time.monotonic() >= deadline:
                raise RuntimeError("GPU memory admission timed out; external or busy allocations remain")
            else:
                time.sleep(.5)

    def record(self, target, key, peak, resident=0, load_seconds=0):
        loaded = json.dumps(self.runtimes[target].status().get("loaded"), sort_keys=True)
        with self.connect() as db:
            db.execute("INSERT INTO gpu_profiles VALUES(?,?,1,?,?,?) ON CONFLICT(key) DO UPDATE SET peak=max(peak,excluded.peak),samples=samples+1,resident=excluded.resident,load_seconds=excluded.load_seconds,loaded=excluded.loaded", (key, peak, resident, load_seconds, loaded))
            db.execute("INSERT INTO gpu_usage VALUES(?,?) ON CONFLICT(runtime) DO UPDATE SET last_used=excluded.last_used", (target, time.time()))


class PeakMonitor:
    def __init__(self, memory, pids):
        self.memory, self.pids = memory, pids
        self.peak = 0
        self.error = None
        self.stop = threading.Event()

    def __enter__(self):
        def sample():
            while not self.stop.is_set():
                try:
                    snapshot = self.memory()
                    self.peak = max(self.peak, sum(snapshot.processes.get(pid, 0) for pid in self.pids()))
                except Exception as error:
                    self.error = error
                self.stop.wait(.1)
        self.thread = threading.Thread(target=sample, daemon=True)
        self.thread.start()
        return self

    def __exit__(self, *_):
        self.stop.set()
        self.thread.join()

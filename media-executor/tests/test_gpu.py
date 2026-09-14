import sqlite3

import pytest

from media_executor.gpu import GIB, Memory, Scheduler, profile_key


class Runtime:
    def __init__(self, pid, allocations, busy=False):
        self.pid, self.allocations, self.busy = pid, allocations, busy
        self.actions = []

    def status(self):
        return {"pids": [self.pid], "loaded": self.allocations.get(self.pid, 0) > 0, "busy": self.busy}

    def clear_cache(self):
        self.actions.append("cache")

    def unload(self):
        self.actions.append("unload")
        self.allocations.pop(self.pid, None)


def setup(tmp_path, allocations, busy=False):
    connect = lambda: sqlite3.connect(tmp_path / "gpu.db")
    memory = lambda: Memory(32 * GIB, 32 * GIB - sum(allocations.values()), dict(allocations))
    runtimes = {"target": Runtime(1, allocations), "old": Runtime(2, allocations, busy), "new": Runtime(3, allocations)}
    scheduler = Scheduler(connect, memory, runtimes, wait_seconds=0)
    scheduler.acquire("job")
    return scheduler, runtimes


def test_enough_memory_retains_idle_models(tmp_path):
    scheduler, runtimes = setup(tmp_path, {1: 3 * GIB, 2: 4 * GIB})
    scheduler.record("target", "small", 6 * GIB)
    scheduler.prepare("job", "target", "small")
    assert not runtimes["old"].actions


def test_pressure_evicts_lru_only_until_budget_fits(tmp_path):
    scheduler, runtimes = setup(tmp_path, {1: 3 * GIB, 2: 10 * GIB, 3: 8 * GIB})
    scheduler.record("old", "other", 10 * GIB)
    scheduler.record("new", "other2", 8 * GIB)
    scheduler.record("target", "large", 20 * GIB)
    scheduler.prepare("job", "target", "large")
    assert "unload" in runtimes["old"].actions
    assert "unload" not in runtimes["new"].actions


def test_unknown_profile_clears_idle_models_but_never_foreign(tmp_path):
    allocations = {1: GIB, 2: 2 * GIB, 99: 3 * GIB}
    scheduler, runtimes = setup(tmp_path, allocations)
    scheduler.prepare("job", "target", "unknown")
    assert allocations[99] == 3 * GIB
    assert "unload" in runtimes["old"].actions


def test_busy_and_foreign_pressure_timeout(tmp_path):
    scheduler, runtimes = setup(tmp_path, {2: 20 * GIB, 99: 10 * GIB}, busy=True)
    scheduler.record("target", "large", 20 * GIB)
    with pytest.raises(RuntimeError, match="timed out"):
        scheduler.prepare("job", "target", "large")
    assert not runtimes["old"].actions


def test_lease_cancel_and_exact_profiles(tmp_path):
    scheduler, _ = setup(tmp_path, {})
    assert not scheduler.acquire("other")
    with pytest.raises(RuntimeError, match="owner"):
        scheduler.release("other")
    with pytest.raises(RuntimeError, match="canceled"):
        scheduler.prepare("job", "target", "unknown", canceled=lambda: True)
    scheduler.release("job")
    assert scheduler.acquire("other")
    request = {"model": "m", "prompt": "a", "params": {"seconds": 10, "seed": 1}}
    assert profile_key(request, "r1") != profile_key(request, "r2")
    assert profile_key(request, "r1") != profile_key({**request, "params": {"seconds": 11}}, "r1")


def test_failed_eviction_does_not_authorize_an_over_budget_job(tmp_path):
    scheduler, runtimes = setup(tmp_path, {2: 20 * GIB})
    scheduler.record("target", "large", 28 * GIB)
    runtimes["old"].unload = lambda: (_ for _ in ()).throw(RuntimeError("release failed"))
    reports = []
    with pytest.raises(RuntimeError, match="timed out"):
        scheduler.prepare("job", "target", "large", report=reports.append)
    assert any(event["action"] == "unload_failed" for event in reports[-1]["events"])


def test_residual_memory_after_unload_stops_idle_worker_only_when_needed(tmp_path):
    allocations = {2: 8 * GIB}
    scheduler, runtimes = setup(tmp_path, allocations)
    scheduler.record("target", "large", 28 * GIB)
    runtimes["old"].unload = lambda: allocations.__setitem__(2, 4 * GIB)
    runtimes["old"].stop = lambda: allocations.pop(2)
    events = scheduler.prepare("job", "target", "large")
    assert not allocations
    assert events[-1] == {"runtime": "old", "action": "stop", "reason": "residual_memory_after_unload"}

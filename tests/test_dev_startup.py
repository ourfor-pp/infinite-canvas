"""Exercise dev.sh startup decisions without touching host services."""
import subprocess
import unittest
from pathlib import Path


SCRIPT = (Path(__file__).resolve().parents[1] / "dev.sh").read_text()
FUNCTIONS = SCRIPT.split("require_command bun\n", 1)[0]


class ComfyStartupTest(unittest.TestCase):
    def run_start(self, user=False, system=False, online=False, loopback=True):
        setup = f"""
comfy_user_unit_loaded() {{ {str(user).lower()}; }}
comfy_system_unit_loaded() {{ {str(system).lower()}; }}
comfy_is_backend_only() {{ {str(loopback).lower()}; }}
comfy_queue_idle() {{ true; }}
ready={int(online)}
curl() {{ (( ready )); }}
systemctl() {{ echo "systemctl $*"; ready=1; }}
systemd-run() {{ echo "systemd-run"; ready=1; }}
comfy_python=/bin/true
comfy_models_dir=/tmp
start_comfyui
"""
        return subprocess.run(
            ["bash", "-c", "source /dev/stdin"], input=FUNCTIONS + setup,
            capture_output=True, text=True,
            timeout=5,
        )

    def test_existing_user_service_starts_without_recreating(self):
        result = self.run_start(user=True, system=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("systemctl --user start arcreel-comfyui-8189.service", result.stdout)
        self.assertNotIn("systemd-run", result.stdout)

    def test_existing_system_service_starts_without_recreating(self):
        result = self.run_start(system=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("systemctl start comfyui-h3.service", result.stdout)
        self.assertNotIn("systemd-run", result.stdout)

    def test_no_service_creates_transient_unit(self):
        result = self.run_start()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("systemd-run", result.stdout)

    def test_healthy_service_is_reused(self):
        result = self.run_start(user=True, online=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertNotIn("systemctl", result.stdout)
        self.assertNotIn("systemd-run", result.stdout)

    def test_non_loopback_service_is_rejected(self):
        for online in (False, True):
            with self.subTest(online=online):
                result = self.run_start(user=True, online=online, loopback=False)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("127.0.0.1", result.stderr)
                self.assertNotIn("systemd-run", result.stdout)


class ExecutorStartupTest(unittest.TestCase):
    def run_start(self, status=200, running=True):
        setup = f'''
executor_token=test-token
executor_dir=/nonexistent-executor
ready={int(running)}
curl() {{
    if [[ " $* " == *" -w "* ]]; then
        if (( ready )); then printf '%s' '{status}'; else printf '000'; return 7; fi
        return
    fi
    (( ready )) || return 7
    [[ " $* " == *"Authorization: Bearer test-token"* ]] || return 22
    [[ " $* " == *"X-Media-Protocol: 2"* ]] || return 22
    [[ {status} == 200 ]]
}}
systemctl() {{ echo "systemctl $*"; ready=1; }}
uv() {{ echo 'unexpected installation'; return 1; }}
start_media_executor
'''
        return subprocess.run(
            ["bash", "-c", "source /dev/stdin"], input=FUNCTIONS + setup,
            capture_output=True, text=True, timeout=5,
        )

    def test_protocol_two_service_is_reused(self):
        result = self.run_start()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("媒体执行器已运行", result.stdout)
        self.assertNotIn("systemctl", result.stdout)

    def test_http_error_does_not_start_another_process(self):
        for status in (401, 426, 503):
            with self.subTest(status=status):
                result = self.run_start(status=status)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("8290 已有 HTTP 服务响应", result.stderr)
                self.assertNotIn("systemctl", result.stdout)
                self.assertNotIn("正在启动", result.stdout)
                self.assertNotIn("unexpected installation", result.stdout)

    def test_stopped_installed_service_starts_without_local_installation(self):
        result = self.run_start(running=False)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("systemctl --user start infinite-media-executor.service", result.stdout)
        self.assertIn("媒体执行器已就绪", result.stdout)
        self.assertNotIn("unexpected installation", result.stdout)


if __name__ == "__main__":
    unittest.main()

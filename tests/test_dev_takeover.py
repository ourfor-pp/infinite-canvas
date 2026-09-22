"""Real isolated listeners: takeover must never kill another application's port."""
from pathlib import Path
import socket
import subprocess
import tempfile
import time
import unittest

HELPER = Path(__file__).resolve().parents[1] / 'scripts/stop-dev.py'


class DevTakeoverTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.web = self.root / 'web'
        self.web.mkdir()
        self.vite = self.web / 'vite'
        self.vite.write_text("require('net').createServer().listen(Number(process.argv[2]),'127.0.0.1')")
        self.children = []

    def tearDown(self):
        for child in self.children:
            if child.poll() is None:
                child.kill()
            child.wait(timeout=5)
        self.temp.cleanup()

    def listener(self, owned=True):
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', 0))
            port = sock.getsockname()[1]
        args = ['node', str(self.vite), str(port)] if owned else ['python3', '-m', 'http.server', str(port), '--bind', '127.0.0.1']
        child = subprocess.Popen(args, cwd=self.web, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        self.children.append(child)
        for _ in range(100):
            try:
                with socket.create_connection(('127.0.0.1', port), timeout=.1):
                    return child, port
            except OSError:
                time.sleep(.03)
        self.fail('listener did not start')

    def stop(self, *ports):
        return subprocess.run(['python3', str(HELPER), str(self.root), *map(str, ports)], capture_output=True, text=True, timeout=15)

    def test_stops_owned_listener_and_allows_repeat(self):
        child, port = self.listener()
        result = self.stop(port)
        self.assertEqual(result.returncode, 0, result.stderr)
        child.wait(timeout=3)
        self.assertEqual(self.stop(port).returncode, 0)

    def test_foreign_listener_prevents_any_shutdown(self):
        ours, owned_port = self.listener()
        foreign, foreign_port = self.listener(owned=False)
        result = self.stop(owned_port, foreign_port)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('拒绝停止', result.stderr)
        self.assertIsNone(ours.poll())
        self.assertIsNone(foreign.poll())

    def test_stops_watcher_and_child(self):
        self.vite.write_text("if(process.argv[3]==='child'){require('net').createServer().listen(Number(process.argv[2]),'127.0.0.1')}else{require('child_process').spawn(process.execPath,[__filename,process.argv[2],'child'],{stdio:'ignore'});setInterval(()=>{},1000)}")
        watcher, port = self.listener()
        result = self.stop(port)
        self.assertEqual(result.returncode, 0, result.stderr)
        watcher.wait(timeout=3)
        with self.assertRaises(OSError):
            socket.create_connection(('127.0.0.1', port), timeout=.2)


if __name__ == '__main__':
    unittest.main()

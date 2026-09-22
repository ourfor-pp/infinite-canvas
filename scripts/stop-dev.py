"""Stop only this checkout's API/Vite trees before a development restart."""
import os
from pathlib import Path
import re
import signal
import socket
import subprocess
import sys
import time


def processes():
    result = {}
    for line in subprocess.check_output(['ps', '-eo', 'pid=,ppid='], text=True).splitlines():
        pid, parent = map(int, line.split())
        try:
            root = Path(f'/proc/{pid}')
            result[pid] = (parent, Path(os.readlink(root / 'cwd')), (root / 'cmdline').read_bytes().decode().split('\0')[:-1])
        except (OSError, UnicodeError):
            pass
    return result


def owned(info, project):
    _, cwd, args = info
    if cwd not in (project, project / 'web', project / 'server') or not args:
        return False
    executable = Path(args[0]).name
    if executable in ('bash', 'sh'):
        return len(args) > 1 and not args[1].startswith('-') and Path(args[1]).name == 'dev.sh'
    names = [Path(arg).name for arg in args[1:] if not any(char.isspace() for char in arg)]
    return (executable in ('node', 'bun') and
            ('vite' in names or ('run' in args and 'dev' in args) or
             ('index.ts' in names and cwd == project / 'server')))


def stop(project, ports):
    snapshot = processes()
    roots = set()
    # Validate every listener before stopping any process.
    for port in ports:
        output = subprocess.check_output(['ss', '-H', '-ltnp', f'sport = :{port}'], text=True)
        pids = {int(pid) for pid in re.findall(r'pid=(\d+)', output)}
        if output.strip() and (not pids or any(pid not in snapshot or not owned(snapshot[pid], project) for pid in pids)):
            raise RuntimeError(f'端口 {port} 被非本项目进程占用或无法确认归属，拒绝停止：{output.strip()}')
        for pid in pids:
            while snapshot[pid][0] in snapshot and snapshot[pid][0] != os.getppid() and owned(snapshot[snapshot[pid][0]], project):
                pid = snapshot[pid][0]
            roots.add(pid)
    victims = set(roots)
    while True:
        children = {pid for pid, (parent, _, _) in snapshot.items() if parent in victims}
        if children <= victims:
            break
        victims.update(children)
    if victims:
        print('停止本项目旧开发进程：' + ', '.join(map(str, sorted(roots))), flush=True)
        for sig, timeout in ((signal.SIGTERM, 8), (signal.SIGKILL, 2)):
            current = processes()
            for pid in victims:
                # Do not signal a PID now belonging to a different process.
                if current.get(pid) == snapshot.get(pid):
                    try:
                        os.kill(pid, sig)
                    except ProcessLookupError:
                        pass
            deadline = time.monotonic() + timeout
            while time.monotonic() < deadline:
                current = processes()
                if not any(current.get(pid) == snapshot.get(pid) for pid in victims):
                    break
                time.sleep(.1)
    # Also catches a replacement process that bound a port during shutdown.
    for port in ports:
        with socket.socket() as probe:
            probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            try:
                probe.bind(('0.0.0.0', port))
            except OSError as error:
                raise RuntimeError(f'端口 {port} 尚未释放：{error}') from error


if __name__ == '__main__':
    try:
        stop(Path(sys.argv[1]).resolve(), [int(port) for port in sys.argv[2:]])
    except (RuntimeError, OSError, subprocess.CalledProcessError) as error:
        sys.exit(str(error))

"""Private Unix-socket worker, launched and owned by the executor."""
import fcntl
import json
import os
import socket as sockets
import sys
from pathlib import Path


def main():
    socket = Path(sys.argv[1])
    os.umask(0o077)
    socket.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    with socket.with_suffix(".lock").open("w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        identity = socket.with_suffix(".json")
        temporary = identity.with_suffix(".tmp")
        ticks = Path(f"/proc/{os.getpid()}/stat").read_text().rsplit(")", 1)[1].split()[19]
        temporary.write_text(json.dumps({"pid": os.getpid(), "ticks": ticks}))
        temporary.replace(identity)
        socket.unlink(missing_ok=True)
        import uvicorn
        with sockets.socket(sockets.AF_UNIX, sockets.SOCK_STREAM) as listener:
            listener.bind(str(socket))
            socket.chmod(0o600)
            uvicorn.Server(uvicorn.Config("app:app", access_log=False)).run(sockets=[listener])


if __name__ == "__main__":
    main()

"""Observe Comfy sampling progress without changing execution or recovery semantics."""
import json
import logging
import time
from urllib.parse import urlencode

from websockets.exceptions import WebSocketException
from websockets.sync.client import connect


class ComfyProgress:
    def __init__(self, app, job_id):
        self.app, self.job_id, self.socket = app, job_id, None

    def __enter__(self):
        try:
            url = self.app.COMFY_URL.replace("https://", "wss://", 1).replace("http://", "ws://", 1)
            self.socket = connect(f"{url.rstrip('/')}/ws?{urlencode({'clientId': self.job_id})}", proxy=None, open_timeout=2, close_timeout=1, max_size=16 * 1024 * 1024)
        except (OSError, WebSocketException) as error:
            logging.getLogger(__name__).warning("Comfy progress unavailable: %s", error)
        return self

    def __exit__(self, *_):
        if self.socket:
            self.socket.close()

    def poll(self, prompt_id):
        if not self.socket:
            self.__enter__()
        latest = None
        for _ in range(200):
            if not self.socket:
                break
            try:
                message = self.socket.recv(timeout=0)
            except TimeoutError:
                break
            except (OSError, WebSocketException):
                self.socket.close()
                self.socket = None
                break
            if not isinstance(message, str):
                continue  # Binary previews aren't progress updates.
            try:
                event = json.loads(message)
            except ValueError:
                continue
            data = event.get("data", {})
            if event.get("type") != "progress" or data.get("prompt_id") != prompt_id:
                continue
            value, total = data.get("value"), data.get("max")
            if not isinstance(value, (int, float)) or not isinstance(total, (int, float)) or total <= 0:
                continue
            latest = {"phase": "processing" if value >= total else "sampling", "nodeId": data.get("node"), "step": value, "totalSteps": total, "progress": min(1, max(0, value / total))}
        if latest:
            with self.app.connect() as db:
                db.execute("UPDATE jobs SET progress=?,updated_at=? WHERE id=? AND status='running'", (latest["progress"], time.time(), self.job_id))
            self.app.report(self.job_id, latest)

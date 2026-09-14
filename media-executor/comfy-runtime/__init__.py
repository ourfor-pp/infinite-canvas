"""Read-only GPU lifecycle status; ComfyUI keeps ownership of model switching."""
import os

from aiohttp import web
from server import PromptServer
import comfy.model_management as memory


@PromptServer.instance.routes.get("/infinite/runtime")
async def runtime_status(request):
    if request.remote not in ("127.0.0.1", "::1"):
        raise web.HTTPForbidden()
    running, pending = PromptServer.instance.prompt_queue.get_current_queue()
    loaded = [type(item.model.model).__name__ for item in memory.current_loaded_models]
    return web.json_response({"pids": [os.getpid()], "busy": bool(running or pending), "loaded": loaded})


NODE_CLASS_MAPPINGS = {}

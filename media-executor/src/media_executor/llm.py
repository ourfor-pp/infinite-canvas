"""Bounded text/image-to-text capability; prompts remain caller-owned."""
import math

MODEL = "qwen3.5-4b-q4-local"


def describe():
    return {"engine": "llm", "output": "text", "modes": ["text"], "operations": ["generate"],
            "inputs": ["text", "image"], "maxReferenceImages": 1, "referenceLimits": {"image": 1, "total": 1},
            "contextLength": 8192, "thinking": False,
            "parameters": {"maxTokens": {"min": 1, "max": 2048, "default": 768},
                           "temperature": {"min": 0, "max": 2, "default": 0.2},
                           "responseFormat": ["text", "json_object"], "systemPrompt": "string"}}


def validate(request):
    params, refs = request.get("params", {}), request.get("references", [])
    if request["mode"] != "text" or request["operation"] != "generate" or request.get("continuation"):
        raise ValueError("LLM capability mismatch")
    if not request.get("prompt", "").strip() or len(request["prompt"]) > 24000:
        raise ValueError("LLM prompt must contain 1 to 24000 characters; total token context is 8192")
    if len(refs) > 1 or any(r["kind"] != "image" or r.get("role", "reference") != "reference" or r.get("frameIndex") is not None for r in refs):
        raise ValueError("LLM accepts at most one image reference")
    if set(params) - {"seed", "maxTokens", "temperature", "systemPrompt", "responseFormat"}:
        raise ValueError("unsupported LLM parameter")
    tokens, temperature = params.get("maxTokens", 768), params.get("temperature", .2)
    if type(tokens) is not int or not 1 <= tokens <= 2048:
        raise ValueError("maxTokens must be an integer from 1 to 2048")
    if type(temperature) not in (int, float) or not math.isfinite(temperature) or not 0 <= temperature <= 2:
        raise ValueError("temperature must be from 0 to 2")
    if not isinstance(params.get("systemPrompt", ""), str) or len(params.get("systemPrompt", "")) > 8000:
        raise ValueError("systemPrompt must be a string up to 8000 characters")
    if params.get("responseFormat", "text") not in ("text", "json_object"):
        raise ValueError("responseFormat must be text or json_object")
    return {"capabilityVersion": "1", "mode": "text", "contextLength": 8192, "imageMaxTokens": 1024}

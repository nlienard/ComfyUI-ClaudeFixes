"""ClaudeFixes: fixes for other ComfyUI custom nodes (no nodes of its own).
- web/h3_continue_toggle.js: frontend fixes for MiniMax H3 Extender (CONTINUE toggle, stored refs, SCENE DURATION node)
- h3_cache_guard.py: backend, clears an Extender's cache when its input photos / voices / video change
"""
from . import h3_cache_guard

h3_cache_guard.install()

NODE_CLASS_MAPPINGS = {}
NODE_DISPLAY_NAME_MAPPINGS = {}
WEB_DIRECTORY = "./web"
__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]

"""ClaudeFixes: fixes for other ComfyUI custom nodes (no nodes of its own).
- web/h3_continue_toggle.js: frontend fixes for MiniMax H3 Extender (CONTINUE toggle, stored refs, SCENE DURATION node)
- h3_cache_guard.py: backend, clears an Extender's cache when its input photos / voices / video change
- h3_locked_output.py: backend, clip-by-clip autosave mp4 open in VLC -> saved as <name>_2.mp4 instead of crashing
"""
from . import h3_cache_guard, h3_locked_output

h3_cache_guard.install()
h3_locked_output.install()

NODE_CLASS_MAPPINGS = {}
NODE_DISPLAY_NAME_MAPPINGS = {}
WEB_DIRECTORY = "./web"
__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]

"""ClaudeFixes: fixes for other ComfyUI custom nodes (+ 1 helper node).
- web/h3_continue_toggle.js: frontend fixes for MiniMax H3 Extender (CONTINUE toggle, stored refs, SCENE DURATION node)
- h3_cache_guard.py: backend, clears an Extender's cache when its input photos / voices / video change
- h3_voice_pack.py: node "H3 Voices 4 -> Extender (3 max)" (4 voices, toggles, auto voice sentence) + no voice leak in clips without <Audio n>
- h3_autosave_names.py: backend, clip-by-clip autosave = <name>_scene1.mp4, _scene1-2.mp4 … (no overwrite, no crash if open in VLC)
"""
from . import h3_cache_guard, h3_autosave_names, h3_voice_pack

h3_cache_guard.install()
h3_autosave_names.install()
h3_voice_pack.install()

NODE_CLASS_MAPPINGS = {"H3VoicePack4": h3_voice_pack.H3VoicePack4}
NODE_DISPLAY_NAME_MAPPINGS = {"H3VoicePack4": "H3 Voices 4 -> Extender (3 max)"}
WEB_DIRECTORY = "./web"
__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]

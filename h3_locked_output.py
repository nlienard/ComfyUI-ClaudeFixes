"""MiniMax H3 Extender: do not crash when the clip-by-clip autosave mp4 is open in a player (backend).

In clip_by_clip mode the Extender overwrites output/<prefix>.mp4 after every clip (os.replace of a temp file). On
Windows that fails with "[WinError 5] Access denied" when the previous mp4 is open in VLC / a browser tab / the
Explorer preview pane, and the whole run ends in an exception (the clip itself was generated and cached).

This wraps motion_context_disk._replace_output_from_preview (looked up at call time by both the ref2va and the FL2VA
engines): on PermissionError it retries for ~3 s, then saves to <prefix>_2.mp4 (… _9) instead and logs a warning.
"""
import logging
import sys
import time

_LOG = logging.getLogger("ClaudeFixes")
_PATCHED = False


def _find_module():
    for name, mod in list(sys.modules.items()):
        if name.endswith("motion_context_disk") and hasattr(mod, "_replace_output_from_preview"):
            return mod
    return None


def patch():
    global _PATCHED
    if _PATCHED:
        return True
    mod = _find_module()
    if mod is None:
        return False
    original = mod._replace_output_from_preview
    if getattr(original, "_claude_locked_output", False):
        _PATCHED = True
        return True

    def replace_output(preview_path, output_dir, filename_prefix, *args, **kwargs):
        for attempt in range(4):
            try:
                return original(preview_path, output_dir, filename_prefix, *args, **kwargs)
            except PermissionError as exc:
                last = exc
                time.sleep(1.0)
        for n in range(2, 10):
            alt = f"{filename_prefix}_{n}"
            try:
                path = original(preview_path, output_dir, alt, *args, **kwargs)
                _LOG.warning("ClaudeFixes h3_locked_output: %s.mp4 is locked (open in a player?) -> saved as %s",
                             filename_prefix, path)
                return path
            except PermissionError as exc:
                last = exc
        raise last

    replace_output._claude_locked_output = True
    replace_output.__wrapped__ = original
    mod._replace_output_from_preview = replace_output
    _PATCHED = True
    _LOG.info("ClaudeFixes h3_locked_output: %s._replace_output_from_preview wrapped", mod.__name__)
    return True


def install():
    """Patch now if the Extender is already loaded, else on the first queued prompt."""
    if patch():
        return
    try:
        from server import PromptServer

        def on_prompt(json_data):
            patch()
            return json_data

        PromptServer.instance.add_on_prompt_handler(on_prompt)
    except Exception as exc:
        _LOG.warning("ClaudeFixes h3_locked_output: cannot install (%s)", exc)

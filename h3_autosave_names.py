"""MiniMax H3 Extender clip-by-clip autosave: one file per stage, named by the clips it contains (backend).

Stock behaviour: after every clip the Extender overwrites output/<prefix>.mp4 (os.replace of a temp file). You lose the
previous stage, and on Windows the replace fails with "[WinError 5] Access denied" when that mp4 is open in VLC / a
browser tab / the Explorer preview pane, which ends the whole run in an exception.

Here the autosave is written as <prefix>_scene1.mp4, then <prefix>_scene1-2.mp4, <prefix>_scene1-3.mp4 … (count = clips
in the current sequence). Re-rendering the same stage replaces that one file; if it is locked, retry ~3 s then
<prefix>_scene1-3_2.mp4 (… _9). Clip count comes from the `segments` handed to _export_live_candidate_preview (ref2va)
or to fl2va_engine._timeline_segments (FL2VA); both are looked up at call time, so wrapping the module attributes works.
"""
import importlib
import logging
import sys
import threading
import time

_LOG = logging.getLogger("ClaudeFixes")
_PATCHED = False
_TLS = threading.local()


def _find_module():
    for name, mod in list(sys.modules.items()):
        if name.endswith("motion_context_disk") and hasattr(mod, "_replace_output_from_preview"):
            return mod
    return None


def _record_count(fn):
    def wrapper(*args, **kwargs):
        segs = kwargs.get("segments")
        if segs is None:
            segs = next((a for a in args if isinstance(a, list)), None)
        if isinstance(segs, list) and segs:
            _TLS.clips = len(segs)
        return fn(*args, **kwargs)
    wrapper.__wrapped__ = fn
    wrapper._claude_autosave = True
    return wrapper


def stage_prefix(prefix, clips):
    if not clips:
        return prefix
    return f"{prefix}_scene1" if clips == 1 else f"{prefix}_scene1-{clips}"


def patch():
    global _PATCHED
    if _PATCHED:
        return True
    mod = _find_module()
    if mod is None:
        return False
    original = mod._replace_output_from_preview
    if getattr(original, "_claude_autosave", False):
        _PATCHED = True
        return True

    def replace_output(preview_path, output_dir, filename_prefix, *args, **kwargs):
        clips = getattr(_TLS, "clips", None)
        _TLS.clips = None
        base = stage_prefix(filename_prefix, clips)
        last = None
        for attempt in range(4):
            try:
                return original(preview_path, output_dir, base, *args, **kwargs)
            except PermissionError as exc:
                last = exc
                time.sleep(1.0)
        for n in range(2, 10):
            try:
                path = original(preview_path, output_dir, f"{base}_{n}", *args, **kwargs)
                _LOG.warning("ClaudeFixes h3_autosave_names: %s.mp4 is locked (open in a player?) -> saved as %s",
                             base, path)
                return path
            except PermissionError as exc:
                last = exc
        raise last

    replace_output._claude_autosave = True
    replace_output.__wrapped__ = original
    mod._replace_output_from_preview = replace_output
    if not getattr(mod._export_live_candidate_preview, "_claude_autosave", False):
        mod._export_live_candidate_preview = _record_count(mod._export_live_candidate_preview)
    try:
        fl = importlib.import_module(mod.__name__.rsplit(".", 1)[0] + ".fl2va_engine")
        if not getattr(fl._timeline_segments, "_claude_autosave", False):
            fl._timeline_segments = _record_count(fl._timeline_segments)
    except Exception as exc:
        _LOG.warning("ClaudeFixes h3_autosave_names: FL2VA clip count not hooked (%s)", exc)
    _PATCHED = True
    _LOG.info("ClaudeFixes h3_autosave_names: clip-by-clip autosave -> <prefix>_scene1-N.mp4")
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
        _LOG.warning("ClaudeFixes h3_autosave_names: cannot install (%s)", exc)

"""MiniMax H3 Extender cache guard (backend).

The Extender keys its disk cache on its node id only. Re-running the same workflow with another face photo, BODY
image, voice or continue video re-used the clips cached by the first run (the old face came back).

This wraps MiniMaxH3Extender.extend: right before it runs, it fingerprints the inputs it actually received (Reference
Pack image tensors, ref_audio_1..4 waveforms, continue_existing_video). If the fingerprint differs from the previous run
of the same Extender, that Extender's generated chain is cleared (the Extender's own _clear_continue_mode_caches, owner
only) and every clip is sent unvalidated. Runs execute one after another, so a reset can never touch a running job and
several runs with different inputs can be queued in a row.
"""
import hashlib
import json
import logging
import os
import sys
import threading

_LOG = logging.getLogger("ClaudeFixes")
_STATE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "h3_cache_guard_state.json")
_LOCK = threading.Lock()
_PATCHED = False
_RUNNING = set()   # Extender owners currently executing


def _tensor_digest(h, t):
    try:
        import torch
        if isinstance(t, torch.Tensor):
            h.update(str(tuple(t.shape)).encode())
            h.update(t.detach().to("cpu").contiguous().numpy().tobytes())
            return
    except Exception:
        pass
    h.update(repr(t).encode())


def _fingerprint(ref_pack, kwargs):
    h = hashlib.sha256()
    slots = (ref_pack or {}).get("slots") if isinstance(ref_pack, dict) else None
    for i, img in enumerate(slots or []):
        h.update(f"|ref{i + 1}:".encode())
        if img is None:
            h.update(b"-")
        else:
            _tensor_digest(h, img)
    for k in ("ref_audio_1", "ref_audio_2", "ref_audio_3", "ref_audio_4"):
        a = kwargs.get(k)
        h.update(f"|{k}:".encode())
        if a is None:
            h.update(b"-")
        elif isinstance(a, dict) and "waveform" in a:
            h.update(str(a.get("sample_rate")).encode())
            _tensor_digest(h, a["waveform"])
        else:
            h.update(repr(type(a)).encode())
    v = kwargs.get("continue_existing_video")
    h.update(b"|continue:")
    if v is None:
        h.update(b"-")
    else:
        src = None
        for attr in ("get_stream_source", "get_source"):
            try:
                src = getattr(v, attr)()
                break
            except Exception:
                pass
        h.update(repr(src if src is not None else v).encode())
    return h.hexdigest()


def _load_state():
    try:
        with open(_STATE, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def _save_state(state):
    try:
        with open(_STATE, "w", encoding="utf-8") as f:
            json.dump(state, f, indent=1)
    except Exception as exc:
        _LOG.warning("ClaudeFixes h3_cache_guard: cannot save state: %s", exc)


def _unvalidate(clips_json):
    try:
        cj = json.loads(clips_json)
    except Exception:
        return clips_json, False
    lists = [cj.get("clips")] + list((cj.get("mode_clips") or {}).values())
    any_valid = False
    for lst in lists:
        if isinstance(lst, list):
            for c in lst:
                if isinstance(c, dict):
                    any_valid = any_valid or bool(c.get("validated"))
                    c["validated"] = False
    return json.dumps(cj, ensure_ascii=False), any_valid


def patch():
    """Wrap MiniMaxH3Extender.extend once (needs the Extender to be loaded). Returns True when patched."""
    global _PATCHED
    if _PATCHED:
        return True
    try:
        import nodes
        cls = nodes.NODE_CLASS_MAPPINGS.get("MiniMaxH3Extender")
    except Exception:
        cls = None
    if cls is None:
        return False
    mod = sys.modules.get(cls.__module__)
    clear = getattr(mod, "_clear_continue_mode_caches", None)
    if clear is None:
        _LOG.warning("ClaudeFixes h3_cache_guard: Extender has no _clear_continue_mode_caches, guard disabled")
        _PATCHED = True
        return True
    original = getattr(cls, cls.FUNCTION)

    # The Extender UI calls /h3_extender/continue_video/reset_cache (-> _clear_continue_mode_caches) when it (re)loads
    # the graph and inspects the wired CONTINUE LoadVideo, even a muted one, and even while that Extender is running
    # (workflow opened in a new tab during a run -> "manifest not found", run lost). Both routes look the function up
    # in the module at call time, so replacing it here blocks any clear of an owner that is executing.
    def guarded_clear(owner_id, *a, **k):
        if str(owner_id) in _RUNNING:
            _LOG.warning("ClaudeFixes h3_cache_guard: refused to clear the cache of Extender %s while it is running", owner_id)
            return False
        return clear(owner_id, *a, **k)

    setattr(mod, "_clear_continue_mode_caches", guarded_clear)

    def extend(self, *args, **kwargs):
        try:
            owner = str(kwargs.get("unique_id") if kwargs.get("unique_id") is not None else "h3_extender")
            fp = _fingerprint(kwargs.get("ref_pack"), kwargs)
            with _LOCK:
                state = _load_state()
                prev = state.get(owner)
                if prev != fp:
                    clips_json = kwargs.get("clips_json")
                    new_cj, any_valid = _unvalidate(clips_json) if isinstance(clips_json, str) else (clips_json, False)
                    if prev is not None or not any_valid:   # first sight + validated clips: keep them, just record
                        clear(owner, preserve_for=None)
                        if isinstance(clips_json, str):
                            kwargs["clips_json"] = new_cj
                        _LOG.info("ClaudeFixes h3_cache_guard: Extender %s inputs changed (photos/voices/video) -> its cache cleared, clips unvalidated", owner)
                    state[owner] = fp
                    _save_state(state)
        except Exception as exc:
            _LOG.warning("ClaudeFixes h3_cache_guard: skipped (%s)", exc)
            owner = str(kwargs.get("unique_id") if kwargs.get("unique_id") is not None else "h3_extender")
        _RUNNING.add(owner)
        try:
            return original(self, *args, **kwargs)
        finally:
            _RUNNING.discard(owner)

    extend.__wrapped__ = original
    setattr(cls, cls.FUNCTION, extend)
    _PATCHED = True
    _LOG.info("ClaudeFixes h3_cache_guard: MiniMaxH3Extender.%s wrapped", cls.FUNCTION)
    return True


def install():
    """Patch now if the Extender is already loaded, else on the first queued prompt (all custom nodes loaded by then)."""
    if patch():
        return
    try:
        from server import PromptServer

        def on_prompt(json_data):
            patch()
            return json_data

        PromptServer.instance.add_on_prompt_handler(on_prompt)
    except Exception as exc:
        _LOG.warning("ClaudeFixes h3_cache_guard: cannot install (%s)", exc)

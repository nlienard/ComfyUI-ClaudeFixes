"""H3 Voices (4 -> 3): pick up to 3 of 4 loaded voices for the MiniMax H3 Extender (which has only 3 audio slots).

Node "H3 Voices 4 -> Extender (3 max)":
- voice_1..voice_4 (AUDIO) wired to 4 loaders, use_voice_1..4 toggles: more than 3 ON -> error "3 voices MAX".
- The ON voices fill ref_audio_1..3 in order (e.g. voices 2 and 4 ON -> slot 1 = voice 2, slot 2 = voice 4).
- text: after every line '<Subject n> says ...: "..."' of a person whose voice is ON, it adds
  'The voice of <Subject n> is the voice of <Audio k> (timbre only ...)' with k = the slot of that voice.
  A clip then receives only the voices of the people who speak in it.

Patch (only for audio coming from this node, marked "claude_voice_pack"): the Extender gives a clip with no <Audio n>
tag the first connected voice (voice leak = mumbling in scenes with no line). With this node's audio, a clip with no
tag gets no voice at all.
"""
import logging
import re
import sys

_LOG = logging.getLogger("ClaudeFixes")
_FLAG = "claude_voice_pack"
_PATCHED = False


def _says_re(n):
    return re.compile(rf'(<Subject {n}>[^\n"]*?\bsays\b[^\n"]*"[^"\n]*")', re.IGNORECASE)


class H3VoicePack4:
    @classmethod
    def INPUT_TYPES(cls):
        req = {"text": ("STRING", {"forceInput": True})}
        for i in range(1, 5):
            req[f"use_voice_{i}"] = ("BOOLEAN", {"default": False, "label_on": f"voice {i} ON", "label_off": f"voice {i} off"})
        return {"required": req, "optional": {f"voice_{i}": ("AUDIO",) for i in range(1, 5)}}

    RETURN_TYPES = ("STRING", "AUDIO", "AUDIO", "AUDIO")
    RETURN_NAMES = ("text", "audio_1", "audio_2", "audio_3")
    FUNCTION = "pack"
    CATEGORY = "ClaudeFixes"
    DESCRIPTION = "Up to 3 of 4 voices for the H3 Extender (3 audio slots): toggles + automatic voice sentence after each '<Subject n> says' line."

    def pack(self, text, use_voice_1, use_voice_2, use_voice_3, use_voice_4, **voices):
        use = [use_voice_1, use_voice_2, use_voice_3, use_voice_4]
        on = [i for i in range(1, 5) if use[i - 1]]
        if len(on) > 3:
            raise ValueError(f"H3 Voices: 3 voices MAX (the Extender has 3 audio slots). ON now: {', '.join(f'voice {i}' for i in on)}. Turn one off.")
        missing = [i for i in on if voices.get(f"voice_{i}") is None]
        if missing:
            raise ValueError(f"H3 Voices: voice {missing[0]} is ON but its loader is muted or not wired.")
        out = [None, None, None]
        for slot, i in enumerate(on, start=1):
            a = dict(voices[f"voice_{i}"])
            a[_FLAG] = True
            out[slot - 1] = a
            text = _says_re(i).sub(
                rf"\1 The voice of <Subject {i}> is the voice of <Audio {slot}> (timbre only: never repeat any word from <Audio {slot}>).",
                text)
        if on:
            _LOG.info("ClaudeFixes H3 Voices: %s", ", ".join(f"voice {i} -> <Audio {s}>" for s, i in enumerate(on, start=1)))
        return (text, out[0], out[1], out[2])


def patch():
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
    orig = getattr(mod, "_select_standalone_audio_refs_for_prompt", None)
    tag_re = getattr(mod, "_AUDIO_TAG_RE", None)
    if orig is None or tag_re is None:
        _LOG.warning("ClaudeFixes h3_voice_pack: Extender audio selector not found, no-leak patch disabled")
        _PATCHED = True
        return True

    def select(prompt, ref_audios):
        audios = list(ref_audios or [])
        if not any(isinstance(a, dict) and a.get(_FLAG) for a in audios):
            return orig(prompt, ref_audios)
        sel, slots = orig(prompt, ref_audios)
        tagged = {int(m.group(1)) for m in tag_re.finditer(str(prompt or ""))}
        keep = [s for s in slots if s in tagged]
        if keep != list(slots):
            sel = [a if (i + 1) in keep else None for i, a in enumerate(sel)]
        return sel, keep

    select.__wrapped__ = orig
    setattr(mod, "_select_standalone_audio_refs_for_prompt", select)
    _PATCHED = True
    _LOG.info("ClaudeFixes h3_voice_pack: Extender audio selector patched (no voice for clips without <Audio n>, H3 Voices audio only)")
    return True


def install():
    if patch():
        return
    try:
        from server import PromptServer

        def on_prompt(json_data):
            patch()
            return json_data

        PromptServer.instance.add_on_prompt_handler(on_prompt)
    except Exception as exc:
        _LOG.warning("ClaudeFixes h3_voice_pack: cannot install (%s)", exc)

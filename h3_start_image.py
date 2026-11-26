"""H3 Start Image: pin a start image at frame 0 of clip 1 of the MiniMax H3 Extender (Ref2VA mode).

Node "H3 Start Image (clip 1)": sits between the Reference Pack Bridge and the Extender (ref_pack in -> ref_pack out).
- use_start_image OFF (default): the ref_pack goes through unchanged, the image is never loaded (lazy input).
- ON: the image is attached to the ref_pack; the photos keep the identity (<Picture n>) and the start image becomes the
  first frame of clip 1 (same as a native MiniMaxH3AddGuide image at frame_idx 0: cover-crop to the canvas, VAE encode,
  one entry in minimax_keyframes).

Patch: wraps the Extender's _make_ref2va_conditioning; the keyframe is added only for clip 1 (i == 0) of a run that does
not continue an existing video (CONTINUE ON = clip 1 already starts from that video). Clips 2+ are untouched (motion
context from the previous clip). The cache guard fingerprints the start image too (changed image -> clip 1 regenerated).
"""
import logging
import sys

_LOG = logging.getLogger("ClaudeFixes")
KEY = "claude_start_image"
_PATCHED = False
_CURRENT = {"image": None}   # runs execute one after another


class H3StartImage:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "ref_pack": ("H3_REF_PACK",),
                "use_start_image": ("BOOLEAN", {"default": False, "label_on": "START IMAGE ON (clip 1 starts on it)",
                                                "label_off": "off (normal ref2va)"}),
            },
            "optional": {"image": ("IMAGE", {"lazy": True})},
        }

    RETURN_TYPES = ("H3_REF_PACK",)
    RETURN_NAMES = ("ref_pack",)
    FUNCTION = "attach"
    CATEGORY = "ClaudeFixes"
    DESCRIPTION = ("ON: clip 1 of the H3 Extender starts on this image (frame 0 keyframe), the photos still give the identity. "
                   "OFF: nothing changes and the image is not loaded.")

    def check_lazy_status(self, ref_pack, use_start_image, image=None):
        return ["image"] if use_start_image and image is None else []

    def attach(self, ref_pack, use_start_image, image=None):
        if not use_start_image:
            return (ref_pack,)
        if image is None:
            raise ValueError("H3 Start Image: START IMAGE is ON but its Load Image is muted or not wired.")
        pack = dict(ref_pack or {})
        pack[KEY] = image[:1]
        _LOG.info("ClaudeFixes H3 Start Image: clip 1 will start on the start image (%dx%d)", image.shape[2], image.shape[1])
        return (pack,)


def _resize_cover(image, width, height):
    import comfy.utils
    s = image[..., :3].movedim(-1, 1)
    s = comfy.utils.common_upscale(s, int(width), int(height), "lanczos", "center")
    return s.movedim(1, -1)


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
    orig_cond = getattr(mod, "_make_ref2va_conditioning", None)
    if orig_cond is None:
        _LOG.warning("ClaudeFixes h3_start_image: _make_ref2va_conditioning not found, start image disabled")
        _PATCHED = True
        return True
    import node_helpers

    def make_cond(clip, vae, prompt, width, height, frame_count, *a, **k):
        cond, latent = orig_cond(clip, vae, prompt, width, height, frame_count, *a, **k)
        img = _CURRENT["image"]
        if img is None:
            return cond, latent
        caller = sys._getframe(1).f_locals
        # clip loop of the main pass only (the refine pass has no 'source_meta'), clip 1, no CONTINUE video
        if "source_meta" not in caller or caller.get("i") != 0 or caller.get("source_meta") is not None:
            return cond, latent
        frames = _resize_cover(img, width, height)
        kfs = list(cond[0][1].get("minimax_keyframes", []) or [])
        kfs.append({"resolved_frame_index": 0, "latent": vae.encode(frames)})
        cond = node_helpers.conditioning_set_values(cond, {"minimax_keyframes": kfs})
        _LOG.info("ClaudeFixes h3_start_image: start image pinned at frame 0 of clip 1 (%dx%d)", width, height)
        return cond, latent

    make_cond.__wrapped__ = orig_cond
    setattr(mod, "_make_ref2va_conditioning", make_cond)

    fn = cls.FUNCTION
    orig_extend = getattr(cls, fn)

    def extend(self, *args, **kwargs):
        rp = kwargs.get("ref_pack")
        _CURRENT["image"] = rp.get(KEY) if isinstance(rp, dict) else None
        try:
            return orig_extend(self, *args, **kwargs)
        finally:
            _CURRENT["image"] = None

    extend.__wrapped__ = orig_extend
    setattr(cls, fn, extend)
    _PATCHED = True
    _LOG.info("ClaudeFixes h3_start_image: Extender patched (H3 Start Image node -> frame 0 of clip 1)")
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
        _LOG.warning("ClaudeFixes h3_start_image: cannot install (%s)", exc)

# ComfyUI-ClaudeFixes

Fixes for other ComfyUI custom nodes. The pack adds no nodes: browser extensions (`web/*.js`) and one backend patch (`h3_cache_guard.py`).

## h3_continue_toggle.js — MiniMax H3 Extender: muting CONTINUE really stops the extend

**Bug.** [MiniMax H3 Extender](https://github.com/tritant/ComfyUI_MiniMax_H3_Extender) stores the last source video in
its `clips_json` state (`continue_existing_video`) after a run. Its frontend clears that state only when the wire to
`continue_existing_video` is **unplugged**. If the upstream video node is **muted or bypassed** instead (for example
with an rgthree group toggle), the socket sends nothing and the backend falls back to the stored video
(`_continue_video_from_state`). Every run then keeps prepending the old video, even though the toggle says OFF.

**Fix.** At queue time (`app.graphToPrompt`), for each `MiniMaxH3Extender` node whose `continue_existing_video`
socket is **wired** but missing from the API prompt (upstream muted or bypassed), the stored Clip 0
(`continue_existing_video`, `continue_video_resize`) is removed from the `clips_json` sent to the backend.

- Toggle ON (wired, active): the video is sent and the Extender extends it, unchanged.
- Toggle OFF (wired, muted or bypassed): no extend.
- Unplugged: unchanged (the Extender already clears its state on disconnect).

The browser console logs `[ClaudeFixes] Extender #<id>: CONTINUE muted -> stored Clip 0 ignored` when the fix acts.

## Same file — muted reference photos are really removed

The Extender never clears a stored `Ref N` when the matching Reference Pack slot is empty ("empty external slots
are deliberately no-ops"). A photo that was ON once (PERSON n, BODY n, DECOR...) and is then muted keeps being sent
to H3 as `<Picture n>`. When a `ref_pack` is wired and active, the fix sends the stored refs empty at queue time:
the backend re-imports only the active slots. Ref ids are pixel hashes, so validated clip caches stay valid.
Console: `[ClaudeFixes] Extender #<id>: stored refs cleared, Reference Pack only`.

## Same file — global SCENE DURATION node

The Extender has no duration input: each clip card stores its own duration in `clips_json`. Add a `PrimitiveFloat`
with `properties.claude_role = "h3_scene_duration"` (it does not need to be wired). When its value is > 0 and the node
is not muted, every clip card is sent with that duration at queue time (clamped 0.25-150 s). 0 = keep the cards.
Handy for quick 2 s identity tests. Console: `[ClaudeFixes] Extender #<id>: every scene = <d> s`.

## h3_cache_guard.py — backend: new photo / voice / video = fresh Extender cache

The Extender keys its disk cache on its node id only. Run the same workflow again with another face photo, BODY
image or voice and it re-used the clips cached by the first run (the old face came back).

`h3_cache_guard.py` wraps `MiniMaxH3Extender.extend`. Right before the Extender runs, it fingerprints the inputs it
really received: the Reference Pack image tensors, `ref_audio_1..4` waveforms and `continue_existing_video`. If the
fingerprint differs from the previous run of the same Extender (state in `h3_cache_guard_state.json`), that
Extender's generated chain is cleared (`_clear_continue_mode_caches`, this owner only; the built-in New Project wipes
every Extender) and every clip is sent unvalidated. Same inputs: cache kept, so clip_by_clip validations survive and
editing a scene prompt resets nothing.

Runs execute one after another, so several runs with different photos can be queued in a row: each one resets the
cache when it starts, never during another run. The first time an Extender is seen with validated clips, its cache
is kept and only the fingerprint is recorded. Log: `ClaudeFixes h3_cache_guard: Extender <id> inputs changed ... -> its cache cleared`.

## Install

```
cd ComfyUI/custom_nodes
git clone https://github.com/nlienard/ComfyUI-ClaudeFixes.git
```

Restart ComfyUI after installing or updating (the backend patch is Python). JS-only changes need a browser refresh.

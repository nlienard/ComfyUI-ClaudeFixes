# ComfyUI-ClaudeFixes

Frontend-only fixes for ComfyUI custom nodes. The pack adds no nodes, only browser extensions (`web/*.js`).

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

## Install

```
cd ComfyUI/custom_nodes
git clone https://github.com/nlienard/ComfyUI-ClaudeFixes.git
```

Restart ComfyUI once. Later updates of the JS only need a browser refresh.

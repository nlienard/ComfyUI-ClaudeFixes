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

## Install

```
cd ComfyUI/custom_nodes
git clone https://github.com/nlienard/ComfyUI-ClaudeFixes.git
```

Restart ComfyUI once. Later updates of the JS only need a browser refresh.

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

## Extender cache never wiped during a run or by a muted CONTINUE

The Extender UI inspects the LoadVideo wired to `continue_existing_video` each time the graph is (re)loaded (new
tab, tab switch, F5) and calls `/h3_extender/continue_video/reset_cache` when it differs from its stored Clip 0, even
when that LoadVideo is muted, and even while the same Extender is running. Opening the workflow in a new tab during a
run deleted the running chain ("H3 Disk Cache manifest not found"); with CONTINUE OFF, validated clips were wiped.

- `h3_cache_guard.py` (backend): `_clear_continue_mode_caches` refuses to clear an Extender that is executing.
- `web/h3_continue_reset_block.js` (frontend): reset / invalidate calls are blocked while the wired CONTINUE source
  is muted or bypassed. An active CONTINUE keeps the Extender's normal behaviour.

## h3_unique_extender.js — similar workflows open side by side get separate caches

The Extender cache is keyed on its node id. Two open workflows whose Extenders share an id (the same workflow opened
twice, two copies of a preset) share one cache and break each other's runs. When a workflow is opened (file, drag &
drop, new tab, F5 restore) and its Extender id is already claimed by another workflow opened in this browser session,
the Extender is renumbered to a random free id (70000-89999) before the graph is built: own cache, clips sent
unvalidated (the new cache is empty). Switching tabs never renumbers (a session stamp in `extra`), so the cache and
validated clips of each tab are kept. Pure helpers in `web/lib_h3_ids.js`.

## h3_validated_in_header.js — Validated in the card header, LoRA + Seed above the prompt

The Extender puts the `Validated` checkbox at the bottom of each clip card, where the preview player or a small node
hides it, like the LoRA selectors and the Seed / Duration row. The same elements (listeners kept) are moved:
`Validated` into the card header next to `CLIP n ... CANDIDATE`, LoRA + Seed/Duration just above the prompt. A
MutationObserver re-applies the moves after each Extender re-render.

## tab_state_fix.js — rgthree toggles survive a workflow tab switch

rgthree panels (Fast Groups Muter / Bypasser) set `node.mode` directly. The ComfyUI ChangeTracker captures the graph
on a window `mouseup`, which canvas pointer handling does not always produce, so it kept the state from before the
toggles and restored it when coming back to the tab (PERSON 2 OFF came back ON). The fix also captures the canvas
state after every `pointerup`.

## h3_autosave_names.py — backend: clip-by-clip autosave = one file per stage, no crash if open in VLC

Stock `clip_by_clip` overwrites `output/<prefix>.mp4` after every clip: the previous stage is lost, and on Windows the
replace fails with `[WinError 5] Access denied` when that mp4 is open in VLC / a browser tab / the Explorer preview pane,
which ends the run in an exception (the clip was generated and cached, only the export failed).

Fix: the autosave is written as `<prefix>_scene1.mp4`, then `<prefix>_scene1-2.mp4`, `<prefix>_scene1-3.mp4` … (number
of clips in the current sequence; ref2va and FL2VA engines). Re-rendering the same stage replaces only that file; if it
is locked, retry ~3 s then `<prefix>_scene1-3_2.mp4` (… `_9`). Watch the previous stage while the next clip renders.
No workflow change needed. Needs a ComfyUI restart once.

## Install

```
cd ComfyUI/custom_nodes
git clone https://github.com/nlienard/ComfyUI-ClaudeFixes.git
```

Restart ComfyUI after installing or updating (the backend patch is Python). JS-only changes need a browser refresh.

## h3_voice_pack.py — node "H3 Voices 4 -> Extender (3 max)" + no voice leak

The MiniMax H3 Extender has only 3 audio slots, and a clip whose prompt has no `<Audio n>` tag still receives the first
connected voice (the person mumbles in scenes with no line).

- Node **H3 Voices 4 -> Extender (3 max)**: `text` + `voice_1..voice_4` (4 loaders) + toggles `use_voice_1..4`.
  More than 3 ON = error "3 voices MAX". The ON voices fill `audio_1..3` in order (voices 2 and 4 ON → `<Audio 1>` = voice 2,
  `<Audio 2>` = voice 4). After every line `<Subject n> says ...: "..."` of a person whose voice is ON, the text gets
  `The voice of <Subject n> is the voice of <Audio k> (timbre only ...)`.
- Patch (only for audio coming from this node): a clip with no `<Audio n>` tag gets no voice at all.

## Bionic: unload the LLM at each Run (1.11.0)
`web/bionic_unload_on_queue.js`: when a workflow containing an active Bionic node is queued, the Bionic LLM is unloaded (`POST /bionic_chat/unload`, same as its unload button), so a local 27B model no longer steals VRAM from the video model (H3: 107 s/step instead of ~50 s/step). Needs an LLM server that can unload (llama.cpp router mode `--models-preset`, LM Studio, Ollama).

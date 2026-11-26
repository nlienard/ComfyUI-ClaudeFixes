// Make muting / bypassing the CONTINUE video really turn the extend OFF.
// MiniMax H3 Extender stores the last source video in its clips_json state (continue_existing_video) and the backend
// falls back to that state when the socket sends nothing (muted/bypassed upstream). Its JS only clears the state when
// the wire is unplugged. Here, at queue time: if the continue_existing_video socket is WIRED but absent from the API
// prompt (upstream muted or bypassed), the stored Clip 0 is stripped from the prompt sent to the backend.
import { app } from "../../scripts/app.js";

const STRIP = ["continue_existing_video", "continue_video_resize"];

app.registerExtension({
    name: "claude.fixes.h3ContinueToggle",
    setup() {
        const orig = app.graphToPrompt;
        app.graphToPrompt = async function (...args) {
            const res = await orig.apply(this, args);
            try {
                const out = res?.output || {};
                // Global SCENE DURATION: a primitive node with properties.claude_role = "h3_scene_duration".
                // Value > 0 overrides the duration of every clip card at queue time (0 = keep the cards).
                const durNode = (app.graph?._nodes || []).find((n) => n?.properties?.claude_role === "h3_scene_duration");
                const durVal = durNode && durNode.mode === 0 ? Number(durNode.widgets?.[0]?.value) : 0;
                for (const node of app.graph?._nodes || []) {
                    if (node?.type !== "MiniMaxH3Extender") continue;
                    const e0 = out[String(node.id)];
                    if (typeof e0?.inputs?.clips_json === "string" && (durVal > 0 || "prompt_pack" in (e0.inputs || {}))) {
                        const cj = JSON.parse(e0.inputs.clips_json);
                        const d = durVal > 0 ? Math.max(0.25, Math.min(150, durVal)) : 0;
                        // Prompt Pack wired: when the pack has more prompts than cards, the backend appends cards with
                        // ITS defaults (10 s, random seed). Pad the card list with spare cards (SCENE DURATION, or the
                        // last card's duration) up to PAD; the backend trims the list to the pack size, so the spares
                        // are only used as new cards.
                        const PAD = 12;
                        if ("prompt_pack" in e0.inputs && Array.isArray(cj.clips) && cj.clips.length && cj.clips.length < PAD) {
                            const last = cj.clips[cj.clips.length - 1] || {};
                            const used = new Set(cj.clips.map((c) => String(c?.id)));
                            for (let i = cj.clips.length; i < PAD; i++) {
                                let id = `clip_${i + 1}`;
                                while (used.has(id)) id = `clip_${i + 1}_${Math.random().toString(36).slice(2, 7)}`;
                                used.add(id);
                                cj.clips.push({ id, name: "", prompt: "", seed: Math.floor(Math.random() * 2 ** 31),
                                    seed_mode: last.seed_mode || "randomize", duration: d || last.duration || 5,
                                    validated: false, loras: [], local_refs: null, first_frame: null, last_frame: null,
                                    guides: [], first_source: "manual" });
                            }
                        }
                        // SCENE DURATION: NOT validated cards only (a validated clip keeps the duration it was made with).
                        if (d > 0) {
                            const lists = [cj.clips, ...Object.values(cj.mode_clips || {})].filter(Array.isArray);
                            for (const list of lists) for (const c of list) if (c && typeof c === "object" && !c.validated) c.duration = d;
                            console.info(`[ClaudeFixes] Extender #${node.id}: every NOT validated scene = ${d} s (SCENE DURATION node)`);
                        }
                        e0.inputs.clips_json = JSON.stringify(cj);
                    }
                    // Refs: the Extender never clears a stored Ref N when its Reference Pack slot is empty, so a
                    // muted photo (PERSON n / BODY n / DECOR) kept being sent. With a pack wired, the pack is the
                    // only source: send empty stored refs, the backend re-imports the active slots (same pixel
                    // hash -> same ref id -> clip caches stay valid).
                    const ent = out[String(node.id)];
                    if (ent?.inputs && "ref_pack" in ent.inputs && typeof ent.inputs.refs_json === "string") {
                        const rj = JSON.parse(ent.inputs.refs_json);
                        if (Array.isArray(rj.refs) && rj.refs.some((r) => r)) {
                            rj.refs = [];
                            ent.inputs.refs_json = JSON.stringify(rj);
                            console.info(`[ClaudeFixes] Extender #${node.id}: stored refs cleared, Reference Pack only`);
                        }
                    }
                    const inp = (node.inputs || []).find((i) => i?.name === "continue_existing_video");
                    if (!inp || inp.link == null) continue;            // unplugged: the Extender clears it itself
                    const entry = out[String(node.id)];
                    if (!entry?.inputs || "continue_existing_video" in entry.inputs) continue;  // wired + active = extend
                    const raw = entry.inputs.clips_json;
                    if (typeof raw !== "string") continue;
                    const cj = JSON.parse(raw);
                    if (!STRIP.some((k) => k in cj)) continue;
                    for (const k of STRIP) delete cj[k];
                    entry.inputs.clips_json = JSON.stringify(cj);
                    console.info(`[ClaudeFixes] Extender #${node.id}: CONTINUE muted -> stored Clip 0 ignored`);
                }
            } catch (e) {
                console.warn("[ClaudeFixes] h3ContinueToggle failed", e);
            }
            return res;
        };
    },
});

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
                for (const node of app.graph?._nodes || []) {
                    if (node?.type !== "MiniMaxH3Extender") continue;
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

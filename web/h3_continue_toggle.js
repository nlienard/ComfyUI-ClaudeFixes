// Make muting / bypassing the CONTINUE video really turn the extend OFF.
// MiniMax H3 Extender stores the last source video in its clips_json state (continue_existing_video) and the backend
// falls back to that state when the socket sends nothing (muted/bypassed upstream). Its JS only clears the state when
// the wire is unplugged. Here, at queue time: if the continue_existing_video socket is WIRED but absent from the API
// prompt (upstream muted or bypassed), the stored Clip 0 is stripped from the prompt sent to the backend.
import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const STRIP = ["continue_existing_video", "continue_video_resize"];

// Auto "new project" for ONE Extender: its disk cache is keyed on the node id only, so another workflow or other input
// files (photos / voices / video) would reuse stale clips. Key = workflow path + the files of the ACTIVE Load* nodes.
// Key changed -> reset that Extender's generated chain (/h3_extender/continue_video/reset_cache, per owner; the
// Extender's own New Project wipes every Extender) and send all clips unvalidated. Same key -> cache kept
// (clip_by_clip validations survive, editing the next scene prompt does not reset anything).
const LOADERS = new Set(["LoadImage", "LoadAudio", "LoadVideo", "VHS_LoadVideo", "LoadImageCrop"]);

function workflowPath() {
    const wf = app.extensionManager?.workflow?.activeWorkflow;
    return String(wf?.path || wf?.filename || app.graph?.extra?.claude_project || "");
}

function inputsKey() {
    const files = [];
    for (const n of app.graph?._nodes || []) {
        if (n?.mode !== 0) continue;
        if (LOADERS.has(n.type)) files.push(`${n.id}=${n.widgets?.[0]?.value ?? ""}`);
        // BODY n settings (sheet vignette 1/2/3, sheet or whole image) change the body ref too
        else if (/^BODY \d/.test(n.title || "")) files.push(`${n.id}=${(n.widgets || []).map((w) => w?.value).join("/")}`);
    }
    return `${workflowPath()}|${files.sort().join(",")}`;
}

async function autoNewProject(node, entry) {
    const store = `claudefixes.h3.projectKey.${node.id}`;
    const key = inputsKey();
    let prev = null;
    try { prev = localStorage.getItem(store); } catch (_) {}
    if (prev === key) return;
    let anyValidated = false;
    let cj = null;
    if (typeof entry?.inputs?.clips_json === "string") {
        cj = JSON.parse(entry.inputs.clips_json);
        const lists = [cj.clips, ...Object.values(cj.mode_clips || {})].filter(Array.isArray);
        anyValidated = lists.some((l) => l.some((c) => c?.validated));
    }
    if (prev !== null || !anyValidated) {   // no record yet + validated clips: keep them (just record the key)
        // NEVER reset while ComfyUI runs or holds jobs: the running Extender would lose its cache file mid-run
        // (FileNotFoundError chain_extender_<id>.h3cache, 2026-11-23). Key not recorded -> reset at the next idle queue.
        try {
            const q = await (await fetch(api.apiURL("/queue"))).json();
            if ((q?.queue_running?.length || 0) + (q?.queue_pending?.length || 0) > 0) {
                console.warn(`[ClaudeFixes] Extender #${node.id}: inputs changed but ComfyUI is busy -> cache reset postponed to the next queue when idle`);
                return;
            }
        } catch (e) {
            console.warn("[ClaudeFixes] queue check failed -> no cache reset", e);
            return;
        }
        try {
            const r = await fetch(api.apiURL("/h3_extender/continue_video/reset_cache"), {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ owner_id: String(node.id) }),
            });
            if (cj) {
                const lists = [cj.clips, ...Object.values(cj.mode_clips || {})].filter(Array.isArray);
                for (const l of lists) for (const c of l) if (c && typeof c === "object") c.validated = false;
                entry.inputs.clips_json = JSON.stringify(cj);
            }
            console.info(`[ClaudeFixes] Extender #${node.id}: new workflow or new input files -> its cache reset (${r.status})`);
        } catch (e) {
            console.warn("[ClaudeFixes] auto new project failed", e);
            return;
        }
    }
    try { localStorage.setItem(store, key); } catch (_) {}
}

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
                    await autoNewProject(node, e0);
                    if (durVal > 0 && typeof e0?.inputs?.clips_json === "string") {
                        const cj = JSON.parse(e0.inputs.clips_json);
                        const d = Math.max(0.25, Math.min(150, durVal));
                        const lists = [cj.clips, ...Object.values(cj.mode_clips || {})].filter(Array.isArray);
                        for (const list of lists) for (const c of list) if (c && typeof c === "object") c.duration = d;
                        e0.inputs.clips_json = JSON.stringify(cj);
                        console.info(`[ClaudeFixes] Extender #${node.id}: every scene = ${d} s (SCENE DURATION node)`);
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

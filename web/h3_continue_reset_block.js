// MiniMax H3 Extender: its UI inspects the CONTINUE LoadVideo wired to continue_existing_video every time the graph is
// (re)loaded (new tab, tab switch, F5) and calls /h3_extender/continue_video/reset_cache when that source differs from
// its stored Clip 0, even when the LoadVideo is MUTED. With the CONTINUE toggle OFF, that wiped the Extender cache
// (validated clips lost, or a running job crashing with "manifest not found"). Block those reset calls while the wired
// source is muted / bypassed. Unmuted CONTINUE (a real extend) keeps the Extender's normal behaviour.
import { app } from "../../scripts/app.js";

const BLOCKED = ["/h3_extender/continue_video/reset_cache", "/h3_extender/continue_video/invalidate_modes"];

function continueSourceMuted(ownerId) {
    for (const node of app.graph?._nodes || []) {
        if (node?.type !== "MiniMaxH3Extender" || String(node.id) !== String(ownerId)) continue;
        const inp = (node.inputs || []).find((i) => i?.name === "continue_existing_video");
        if (!inp || inp.link == null) return false;
        const link = app.graph.links?.get ? app.graph.links.get(inp.link) : app.graph.links?.[inp.link];
        const originId = link?.origin_id ?? link?.originId;
        const src = (app.graph._nodes || []).find((n) => String(n.id) === String(originId));
        return Boolean(src && src.mode !== 0);
    }
    return false;
}

app.registerExtension({
    name: "claude.fixes.h3ContinueResetBlock",
    setup() {
        const origFetch = window.fetch.bind(window);
        window.fetch = async function (input, init) {
            try {
                const url = typeof input === "string" ? input : input?.url || "";
                if (BLOCKED.some((p) => url.includes(p)) && init?.body) {
                    const owner = JSON.parse(String(init.body))?.owner_id;
                    if (owner != null && continueSourceMuted(owner)) {
                        console.info(`[ClaudeFixes] Extender #${owner}: CONTINUE muted -> Extender cache reset blocked`);
                        return new Response(JSON.stringify({ ok: true, found: false, blocked_by: "ClaudeFixes" }),
                            { status: 200, headers: { "Content-Type": "application/json" } });
                    }
                }
            } catch (e) {
                console.warn("[ClaudeFixes] reset block check failed", e);
            }
            return origFetch(input, init);
        };
    },
});

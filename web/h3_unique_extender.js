// MiniMax H3 Extender keys its disk cache on its node id. Two open workflows whose Extenders share an id (the same
// workflow opened twice, or two copies of a preset) share ONE cache: a run in one tab is broken by the other.
// When a workflow is OPENED (file, drag & drop, new tab, F5 restore), if its Extender id is already claimed by another
// workflow opened in this browser session, it gets a random free id (70000-89999) -> its own cache; its clips are sent
// unvalidated (the new cache is empty). Tab switches carry the session stamp and are left untouched (cache kept).
import { app } from "../../scripts/app.js";
import { extenderIds, renumberNode, freeId } from "./lib_h3_ids.js";

const SESSION = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
const claimed = new Map();   // extender id -> stamp of the workflow that owns it in this session
let seq = 0;

app.registerExtension({
    name: "claude.fixes.h3UniqueExtender",
    beforeConfigureGraph(graphData) {
        try {
            const ids = extenderIds(graphData);
            if (!ids.length) return;
            graphData.extra = graphData.extra || {};
            const stamp = graphData.extra.claude_ext_stamp;
            const mine = stamp && String(stamp).startsWith(SESSION + ":");
            if (mine) {                                  // tab switch / restore of a workflow already opened here
                for (const id of ids) claimed.set(id, stamp);
                return;
            }
            const newStamp = `${SESSION}:${++seq}`;
            for (const id of ids) {
                const owner = claimed.get(id);
                if (owner !== undefined && owner !== newStamp) {
                    const nid = freeId(graphData, new Set(claimed.keys()));
                    renumberNode(graphData, id, nid);
                    claimed.set(nid, newStamp);
                    console.info(`[ClaudeFixes] Extender #${id} already open in another workflow -> renumbered #${nid} (own cache)`);
                } else {
                    claimed.set(id, newStamp);
                }
            }
            graphData.extra.claude_ext_stamp = newStamp;
        } catch (e) {
            console.warn("[ClaudeFixes] h3UniqueExtender failed", e);
        }
    },
});

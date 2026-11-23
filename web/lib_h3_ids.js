// Pure helpers (no ComfyUI imports) for h3_unique_extender.js; kept separate so they can be tested with plain node.
export const EXT_TYPE = "MiniMaxH3Extender";

export function extenderIds(graphData) {
    return (graphData?.nodes || []).filter((n) => n?.type === EXT_TYPE).map((n) => Number(n.id));
}

// Renumber node oldId -> newId inside a serialized UI workflow (links as arrays or objects), unvalidate its clips.
export function renumberNode(graphData, oldId, newId) {
    for (const n of graphData.nodes || []) if (Number(n.id) === Number(oldId)) {
        n.id = newId;
        const wv = n.widgets_values;
        if (Array.isArray(wv) && typeof wv[10] === "string") {
            try {
                const cj = JSON.parse(wv[10]);
                const lists = [cj.clips, ...Object.values(cj.mode_clips || {})].filter(Array.isArray);
                for (const l of lists) for (const c of l) if (c && typeof c === "object") c.validated = false;
                wv[10] = JSON.stringify(cj);
            } catch (_) {}
        }
    }
    for (const l of graphData.links || []) {
        if (Array.isArray(l)) {
            if (Number(l[1]) === Number(oldId)) l[1] = newId;
            if (Number(l[3]) === Number(oldId)) l[3] = newId;
        } else if (l && typeof l === "object") {
            if (Number(l.origin_id) === Number(oldId)) l.origin_id = newId;
            if (Number(l.target_id) === Number(oldId)) l.target_id = newId;
        }
    }
    if (typeof graphData.last_node_id === "number") graphData.last_node_id = Math.max(graphData.last_node_id, newId);
    if (graphData.state && typeof graphData.state.lastNodeId === "number") {
        graphData.state.lastNodeId = Math.max(graphData.state.lastNodeId, newId);
    }
    return graphData;
}

export function freeId(graphData, taken, rand = Math.random) {
    const used = new Set((graphData.nodes || []).map((n) => Number(n.id)));
    for (let i = 0; i < 1000; i++) {
        const id = 70000 + Math.floor(rand() * 20000);
        if (!used.has(id) && !taken.has(id)) return id;
    }
    throw new Error("no free id");
}

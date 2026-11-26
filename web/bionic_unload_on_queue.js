// Free the GPU for ComfyUI: when a workflow containing a Bionic node is queued, ask Bionic to unload its LLM
// (POST /bionic_chat/unload, the same call as the Bionic "unload" button). A local LLM left in VRAM (e.g. a 27B model,
// ~15 GB) makes MiniMax H3 offload its weights: 107 s/step instead of 50 s/step.
// Works when the LLM server can unload (llama.cpp router mode --models-preset, LM Studio, Ollama). Fire and forget:
// the queue is never delayed, an error is only logged.
import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const BIONIC = /^Bionic/i;

function hasBionic(graph, seen = new Set()) {
    if (!graph || seen.has(graph)) return false;
    seen.add(graph);
    for (const n of graph._nodes || []) {
        if (n?.mode === 0 && BIONIC.test(String(n.type || ""))) return true;
        if (n?.subgraph && hasBionic(n.subgraph, seen)) return true;
    }
    return false;
}

app.registerExtension({
    name: "claude.fixes.bionicUnloadOnQueue",
    setup() {
        const orig = api.queuePrompt.bind(api);
        api.queuePrompt = async function (...args) {
            try {
                if (hasBionic(app.graph)) {
                    api.fetchApi("/bionic_chat/unload", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })
                        .then(async (r) => {
                            const j = await r.json().catch(() => ({}));
                            if (r.ok) console.info("[ClaudeFixes] Bionic LLM unloaded before the run", j);
                            else console.info("[ClaudeFixes] Bionic unload skipped:", j?.error || r.status);
                        })
                        .catch((e) => console.info("[ClaudeFixes] Bionic unload failed", e));
                }
            } catch (e) {
                console.warn("[ClaudeFixes] bionicUnloadOnQueue failed", e);
            }
            return orig(...args);
        };
    },
});

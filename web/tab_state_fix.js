// Toggles flipped with rgthree panels (Fast Groups Muter / Bypasser) were lost when switching workflow tabs.
// rgthree changes node.mode directly and nothing tells the ComfyUI ChangeTracker; the tracker captures the graph on a
// window 'mouseup', which the canvas pointer handling does not always produce. On tab switch the tracker restores its
// last captured state, i.e. the graph before the toggles. Fix: capture the canvas state after every pointerup too.
import { app } from "../../scripts/app.js";

function capture() {
    try {
        const tracker = app.extensionManager?.workflow?.activeWorkflow?.changeTracker;
        if (!tracker) return;
        if (typeof tracker.captureCanvasState === "function") tracker.captureCanvasState();
        else if (typeof tracker.checkState === "function") tracker.checkState();
    } catch (e) {
        console.warn("[ClaudeFixes] tab state capture failed", e);
    }
}

app.registerExtension({
    name: "claude.fixes.tabStateFix",
    setup() {
        // after the widget handlers ran (rgthree toggles on pointerdown/up)
        window.addEventListener("pointerup", () => setTimeout(capture, 0), true);
    },
});

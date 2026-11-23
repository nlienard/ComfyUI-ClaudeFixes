// MiniMax H3 Extender: the 'Validated' checkbox sits at the very bottom of each clip card, where the preview player /
// node size can hide it. Move that same element (its listeners included) into the card header, next to
// "CLIP n ... CANDIDATE". The Extender rebuilds its cards on every render; a MutationObserver re-applies the move.
import { app } from "../../scripts/app.js";

function moveValidated(card) {
    const head = card.firstElementChild;
    if (!head || !/^CLIP \d/.test(head.querySelector("strong")?.textContent || "")) return;
    for (const label of card.querySelectorAll("label")) {
        const box = label.querySelector('input[type="checkbox"]');
        if (!box || !/Validated/.test(label.textContent || "") || label.parentElement === head) continue;
        label.style.marginLeft = "auto";
        label.style.flex = "0 0 auto";
        label.style.whiteSpace = "nowrap";
        label.style.fontWeight = "700";
        label.title = "Validated: keep this clip and move on to the next one (clip_by_clip)";
        head.appendChild(label);
        return;
    }
}

let pending = false;
function scan() {
    pending = false;
    for (const card of document.querySelectorAll(".h3-extender-card")) moveValidated(card);
}

app.registerExtension({
    name: "claude.fixes.h3ValidatedInHeader",
    setup() {
        new MutationObserver(() => {
            if (!pending) { pending = true; requestAnimationFrame(scan); }
        }).observe(document.body, { childList: true, subtree: true });
    },
});

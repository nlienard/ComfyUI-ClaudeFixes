// MiniMax H3 Extender: the 'Validated' checkbox, the LoRA selectors and the Seed / Duration row sit below the prompt
// of each clip card, where the preview player / node size can hide them. Move those same elements (listeners
// included): Validated into the card header next to "CLIP n ... CANDIDATE", LoRA + Seed/Duration just above the
// prompt. The Extender rebuilds its cards on every render; a MutationObserver re-applies the moves.
import { app } from "../../scripts/app.js";

function directChild(card, el) {
    while (el && el.parentElement !== card) el = el.parentElement;
    return el;
}

function moveControlsAbovePrompt(card) {
    const prompt = directChild(card, card.querySelector("textarea"));
    if (!prompt) return;
    const lora = directChild(card, [...card.querySelectorAll("select")].find((s) => /LoRA/.test(s.title || "")));
    const seed = directChild(card, card.querySelector('button[title="Randomize seed"]'));
    for (const block of [lora, seed]) {
        if (!block || block === prompt) continue;
        // already above the prompt? (DOCUMENT_POSITION_FOLLOWING = prompt comes after block)
        if (block.compareDocumentPosition(prompt) & Node.DOCUMENT_POSITION_FOLLOWING) continue;
        card.insertBefore(block, prompt);
    }
}

function moveValidated(card) {
    const head = card.firstElementChild;
    if (!head || !/^CLIP \d/.test(head.querySelector("strong")?.textContent || "")) return;
    moveControlsAbovePrompt(card);
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

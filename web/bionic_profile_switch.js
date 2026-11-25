// Bionic (Verolelb/ComfyUI-Bionic) add-on: system prompt PROFILE selector next to the model selector.
// Bionic reads the system prompt from its server config on every chat request, so switching = POST /bionic_chat/config
// {system_prompt}. The settings textarea is updated too, so saving Bionic's settings later keeps the chosen profile.
// Profiles = the named prompts of Bionic (user/bionic_chat/prompts.json, editable in Bionic's settings).
// Does nothing if Bionic is not installed.
import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const SEL_ID = "claude-bionic-profile";
const CUSTOM = "__custom__";

async function getJson(url) {
    const r = await api.fetchApi(url);
    if (!r.ok) throw new Error(await r.text());
    return r.json();
}

async function fill(select) {
    let prompts = {}, current = "";
    try {
        prompts = (await getJson("/bionic_chat/prompts")).prompts || {};
        current = ((await getJson("/bionic_chat/config")).config || {}).system_prompt || "";
    } catch (e) {
        console.warn("[ClaudeFixes] bionic profiles:", e);
        return;
    }
    const names = Object.keys(prompts).sort((a, b) => a.localeCompare(b));
    const match = names.find((n) => prompts[n].trim() === current.trim());
    select.innerHTML = "";
    for (const n of names) select.add(new Option(n, n));
    if (!match) select.add(new Option("(custom system prompt)", CUSTOM));
    select.value = match || CUSTOM;
    select._prompts = prompts;
}

async function choose(select) {
    const name = select.value;
    const text = select._prompts?.[name];
    if (text === undefined) return;
    const r = await api.fetchApi("/bionic_chat/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ system_prompt: text }),
    });
    if (!r.ok) {
        console.warn("[ClaudeFixes] bionic profile not saved:", await r.text());
        return;
    }
    const ta = document.getElementById("bionic-cfg-system");
    if (ta) ta.value = text;          // Bionic's settings form sends this textarea when saved
    const opt = [...select.options].find((o) => o.value === CUSTOM);
    if (opt) opt.remove();
    const status = document.getElementById("bionic-status");
    if (status) status.textContent = `Profile: ${name}`;
}

function inject() {
    const model = document.getElementById("bionic-model");
    if (!model || document.getElementById(SEL_ID)) return;
    const select = document.createElement("select");
    select.id = SEL_ID;
    select.title = "System prompt profile (Bionic named prompts)";
    model.insertAdjacentElement("afterend", select);
    // pick up prompts saved meanwhile (on hover: rebuilding the options while the list is open would close it)
    select.addEventListener("pointerenter", () => { if (document.activeElement !== select) fill(select); });
    select.addEventListener("change", () => choose(select));
    fill(select);
}

app.registerExtension({
    name: "ClaudeFixes.BionicProfileSwitch",
    setup() {
        inject();
        new MutationObserver(inject).observe(document.body, { childList: true, subtree: true });
    },
});

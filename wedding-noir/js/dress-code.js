// ============================================================================
//  Dress Code: label + a row of circular color swatches driven by
//  CONFIG.dressCode.{label, colors}.
// ============================================================================

import { CONFIG } from "../config.js";

const labelEl   = document.getElementById("dress-code-label");
const swatchRow = document.getElementById("dress-code-swatches");

if (labelEl) labelEl.textContent = CONFIG.dressCode.label;

if (swatchRow && Array.isArray(CONFIG.dressCode.colors)) {
  for (const hex of CONFIG.dressCode.colors) {
    const wrap = document.createElement("div");
    wrap.className = "swatch-wrap";

    const dot = document.createElement("span");
    dot.className = "swatch";
    dot.style.background = hex;
    dot.setAttribute("aria-label", `Color ${hex}`);
    dot.title = hex;

    const code = document.createElement("span");
    code.className = "swatch-code";
    code.textContent = hex.toUpperCase();

    wrap.append(dot, code);
    swatchRow.appendChild(wrap);
  }
}

import { StateEffect, StateField } from "@codemirror/state";
import { linter, lintGutter } from "@codemirror/lint";

const setParseDiagnosticEffect = StateEffect.define();

const parseDiagnosticField = StateField.define({
  create() {
    return null;
  },
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setParseDiagnosticEffect)) {
        return effect.value;
      }
    }
    return value;
  },
});

function trailingInputOffset(source, errorMessage) {
  const match = /trailing input: (\d+) byte\(s\) remain unparsed/.exec(errorMessage);
  if (!match) return null;
  const remaining = parseInt(match[1], 10);
  if (Number.isNaN(remaining)) return null;
  const offset = source.length - remaining;
  if (offset < 0 || offset > source.length) return null;
  return { from: offset, to: source.length };
}

function diagnosticRange(diagnostic, source) {
  if (
    diagnostic &&
    typeof diagnostic.from === "number" &&
    typeof diagnostic.to === "number"
  ) {
    const from = diagnostic.from;
    const to = diagnostic.to > from ? diagnostic.to : Math.min(from + 1, source.length);
    return { from, to };
  }
  return trailingInputOffset(source, diagnostic?.message ?? "");
}

function createParseDiagnosticExtension(getSource) {
  return linter((view) => {
    const diagnostic = view.state.field(parseDiagnosticField, false);
    if (!diagnostic?.message) return [];
    const source = getSource();
    const pos = diagnosticRange(diagnostic, source);
    if (!pos) return [];
    return [
      {
        from: pos.from,
        to: pos.to,
        severity: "error",
        message: diagnostic.message,
      },
    ];
  });
}

export function parseDiagnosticExtensions(getSource) {
  return [parseDiagnosticField, createParseDiagnosticExtension(getSource), lintGutter()];
}

export function setParseDiagnostic(view, diagnostic) {
  let value = null;
  if (typeof diagnostic === "string") {
    value = { message: diagnostic };
  } else if (diagnostic?.message) {
    value = diagnostic;
  }
  view.dispatch({
    effects: setParseDiagnosticEffect.of(value),
  });
}

export function initOnboarding() {
  const banner = document.getElementById("onboarding-banner");
  const dismiss = document.getElementById("onboarding-dismiss");
  if (!banner || !dismiss) return;

  const key = "pest-to-marser.onboarding-dismissed";
  if (localStorage.getItem(key) === "1") {
    banner.hidden = true;
    return;
  }

  dismiss.addEventListener("click", () => {
    banner.hidden = true;
    try {
      localStorage.setItem(key, "1");
    } catch {
      // ignore
    }
  });
}

export function initPaneResizer(onResize) {
  const resizer = document.getElementById("pane-resizer");
  const pestPane = document.getElementById("pest-pane");
  const rustPane = document.getElementById("rust-pane");
  const panes = document.getElementById("panes");
  if (!resizer || !pestPane || !rustPane || !panes) return;

  const storageKey = "pest-to-marser.split-ratio";
  const saved = parseFloat(localStorage.getItem(storageKey) || "0.5");
  if (!Number.isNaN(saved) && saved > 0.1 && saved < 0.9) {
    pestPane.style.flex = `${saved} 1 0`;
    rustPane.style.flex = `${1 - saved} 1 0`;
  }

  let dragging = false;

  function onPointerMove(clientX) {
    const rect = panes.getBoundingClientRect();
    if (rect.width <= 0) return;
    const ratio = Math.min(0.85, Math.max(0.15, (clientX - rect.left) / rect.width));
    pestPane.style.flex = `${ratio} 1 0`;
    rustPane.style.flex = `${1 - ratio} 1 0`;
    onResize();
  }

  resizer.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const rect = panes.getBoundingClientRect();
    if (rect.width <= 0) return;
    const pestWidth = pestPane.getBoundingClientRect().width;
    const currentRatio = pestWidth / rect.width;
    const step = e.shiftKey ? 0.1 : 0.02;
    const delta = e.key === "ArrowRight" ? step : -step;
    const ratio = Math.min(0.85, Math.max(0.15, currentRatio + delta));
    pestPane.style.flex = `${ratio} 1 0`;
    rustPane.style.flex = `${1 - ratio} 1 0`;
    onResize();
    try {
      localStorage.setItem(storageKey, String(ratio));
    } catch {
      // ignore
    }
  });

  resizer.addEventListener("mousedown", (e) => {
    dragging = true;
    resizer.classList.add("dragging");
    e.preventDefault();
  });

  window.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    onPointerMove(e.clientX);
  });

  window.addEventListener("mouseup", () => {
    if (!dragging) return;
    dragging = false;
    resizer.classList.remove("dragging");
    const rect = panes.getBoundingClientRect();
    const pestWidth = pestPane.getBoundingClientRect().width;
    const ratio = pestWidth / rect.width;
    try {
      localStorage.setItem(storageKey, String(ratio));
    } catch {
      // ignore
    }
    onResize();
  });
}

export function updateRuleDatalist(ruleNames) {
  const datalist = document.getElementById("rule-names");
  if (!datalist) return;
  datalist.innerHTML = "";
  for (const name of ruleNames) {
    const opt = document.createElement("option");
    opt.value = name;
    datalist.appendChild(opt);
  }
}

export function updateEntryRuleHint(entryRule, ruleNames) {
  const hint = document.getElementById("entry-rule-hint");
  if (!hint) return;
  const trimmed = entryRule.trim();
  if (!trimmed || ruleNames.length === 0) {
    hint.textContent = "";
    hint.hidden = true;
    return;
  }
  if (!ruleNames.includes(trimmed)) {
    hint.textContent = `Unknown rule: ${trimmed}`;
    hint.hidden = false;
  } else {
    hint.textContent = "";
    hint.hidden = true;
  }
}

export function renderErrors(errors) {
  const list = document.getElementById("error-list");
  const copyBtn = document.getElementById("copy-errors-btn");
  if (!list) return;

  list.innerHTML = "";
  if (!errors || errors.length === 0) {
    list.hidden = true;
    if (copyBtn) copyBtn.disabled = true;
    return;
  }

  list.hidden = false;
  if (copyBtn) copyBtn.disabled = false;
  for (const err of errors) {
    const li = document.createElement("li");
    li.textContent = typeof err === "string" ? err : err.message;
    list.appendChild(li);
  }
}

export function clearErrors() {
  renderErrors([]);
}

export function errorsAsText(errors) {
  return (errors || [])
    .map((err) => (typeof err === "string" ? err : err.message))
    .join("\n");
}

export function setShareOutdated(outdated) {
  const badge = document.getElementById("share-outdated");
  if (badge) {
    badge.hidden = !outdated;
  }
}

export function setPestFilename(name) {
  const el = document.getElementById("pest-filename");
  if (!el) return;
  if (name) {
    el.textContent = name;
    el.hidden = false;
  } else {
    el.textContent = "";
    el.hidden = true;
  }
}

export function setStatus(text, color) {
  const statusEl = document.getElementById("status");
  if (!statusEl) return;
  statusEl.textContent = text;
  if (color) {
    statusEl.style.color = color;
  }
}

export function flashButton(button, label = "Copied!") {
  if (!button) return;
  const original = button.textContent;
  button.textContent = label;
  button.disabled = true;
  setTimeout(() => {
    button.textContent = original;
    button.disabled = false;
  }, 1500);
}

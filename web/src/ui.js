import { StateEffect, StateField } from "@codemirror/state";
import { linter, lintGutter } from "@codemirror/lint";

const setParseDiagnosticEffect = StateEffect.define();

const parseDiagnosticField = StateField.define({
  create() {
    return [];
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

function unsupportedKeyword(errorMessage) {
  const match = /\b(PUSH_LITERAL|PUSH|POP_ALL|POP|PEEK_ALL|PEEK|DROP)\b/.exec(errorMessage);
  return match?.[1] ?? null;
}

function findKeywordRange(source, keyword, usedRanges = []) {
  if (!keyword) return null;
  const re = new RegExp(`\\b${keyword}\\b`, "g");
  for (const match of source.matchAll(re)) {
    const from = match.index ?? -1;
    if (from < 0) continue;
    const to = from + keyword.length;
    const alreadyUsed = usedRanges.some((range) => range.from === from && range.to === to);
    if (!alreadyUsed) {
      return { from, to };
    }
  }
  return null;
}

function diagnosticRange(diagnostic, source, usedRanges = []) {
  if (
    diagnostic &&
    typeof diagnostic.from === "number" &&
    typeof diagnostic.to === "number"
  ) {
    const from = diagnostic.from;
    const to = diagnostic.to > from ? diagnostic.to : Math.min(from + 1, source.length);
    return { from, to };
  }
  const message = diagnostic?.message ?? "";
  const unsupported = unsupportedKeyword(message);
  if (unsupported) {
    const range = findKeywordRange(source, unsupported, usedRanges);
    if (range) return range;
  }
  return trailingInputOffset(source, message);
}

function createParseDiagnosticExtension(getSource) {
  return linter((view) => {
    const diagnostics = view.state.field(parseDiagnosticField, false) ?? [];
    if (diagnostics.length === 0) return [];
    const source = getSource();
    const usedRanges = [];
    return diagnostics
      .filter((diagnostic) => diagnostic?.message)
      .map((diagnostic) => {
        const pos = diagnosticRange(diagnostic, source, usedRanges);
        if (!pos) return null;
        usedRanges.push(pos);
        return {
          from: pos.from,
          to: pos.to,
          severity: "error",
          message: diagnostic.message,
        };
      })
      .filter(Boolean);
  });
}

export function parseDiagnosticExtensions(getSource) {
  return [parseDiagnosticField, createParseDiagnosticExtension(getSource), lintGutter()];
}

export function setParseDiagnostic(view, diagnostic) {
  let value = [];
  if (Array.isArray(diagnostic)) {
    value = diagnostic
      .filter((item) => item && typeof item === "object" && typeof item.message === "string")
      .map((item) => ({
        message: item.message,
        from: typeof item.from === "number" ? item.from : undefined,
        to: typeof item.to === "number" ? item.to : undefined,
      }));
  } else if (typeof diagnostic === "string") {
    value = [{ message: diagnostic }];
  } else if (diagnostic?.message) {
    value = [diagnostic];
  }
  view.dispatch({
    effects: setParseDiagnosticEffect.of(value),
  });
}

export function initOnboarding() {
  initIntro();
  initTour();
}

function initIntro() {
  const section = document.getElementById("intro-section");
  const dismiss = document.getElementById("intro-dismiss");
  const tourBtn = document.getElementById("intro-tour-btn");
  if (!section || !dismiss) return;

  const key = "grammar-to-marser.intro-dismissed";
  try {
    if (localStorage.getItem("grammar-to-marser.onboarding-dismissed") === "1") {
      localStorage.setItem(key, "1");
      localStorage.removeItem("grammar-to-marser.onboarding-dismissed");
    }
  } catch {
    // ignore
  }
  if (localStorage.getItem(key) === "1") {
    section.hidden = true;
  }

  dismiss.addEventListener("click", () => {
    section.hidden = true;
    try {
      localStorage.setItem(key, "1");
    } catch {
      // ignore
    }
    maybeStartTour();
  });

  tourBtn?.addEventListener("click", () => {
    startTour({ force: true });
  });
}

const TOUR_STEPS = [
  {
    targetId: "examples-select",
    text: "Start here — load a sample grammar to see live conversion.",
  },
  {
    targetId: "entry-rule",
    text: "Set the entry rule — the top-level rule Pest would parse (e.g. expr).",
  },
  {
    targetId: "pest-editor",
    text: "Edit your grammar here, or drag a .pest file onto this pane.",
  },
  {
    targetId: "share-link-btn",
    text: "Share link copies a URL with your grammar embedded.",
  },
  {
    targetId: "download-project-btn",
    text: "Download project — get a ready-to-run Cargo zip with README.",
  },
];

let tourStepIndex = 0;
let tourHighlightEl = null;

function clearTourHighlight() {
  if (tourHighlightEl) {
    tourHighlightEl.classList.remove("tour-highlight");
    tourHighlightEl = null;
  }
}

function showTourStep(index) {
  const bar = document.getElementById("tour-bar");
  const text = document.getElementById("tour-text");
  const nextBtn = document.getElementById("tour-next");
  if (!bar || !text) return;

  clearTourHighlight();
  const step = TOUR_STEPS[index];
  if (!step) {
    finishTour();
    return;
  }

  const target = document.getElementById(step.targetId);
  if (target) {
    target.classList.add("tour-highlight");
    tourHighlightEl = target;
    target.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  text.textContent = `Step ${index + 1} of ${TOUR_STEPS.length}: ${step.text}`;
  if (nextBtn) {
    nextBtn.textContent = index === TOUR_STEPS.length - 1 ? "Done" : "Next";
  }
  bar.hidden = false;
}

function finishTour() {
  clearTourHighlight();
  const bar = document.getElementById("tour-bar");
  if (bar) bar.hidden = true;
  try {
    localStorage.setItem("grammar-to-marser.tour-done", "1");
  } catch {
    // ignore
  }
}

function maybeStartTour() {
  try {
    if (localStorage.getItem("grammar-to-marser.tour-done") === "1") return;
  } catch {
    // ignore
  }
  startTour();
}

function startTour({ force = false } = {}) {
  if (!force) {
    try {
      if (localStorage.getItem("grammar-to-marser.tour-done") === "1") return;
    } catch {
      // ignore
    }
  }
  tourStepIndex = 0;
  showTourStep(tourStepIndex);
}

function initTour() {
  const bar = document.getElementById("tour-bar");
  const skip = document.getElementById("tour-skip");
  const next = document.getElementById("tour-next");
  if (!bar) return;

  skip?.addEventListener("click", finishTour);
  next?.addEventListener("click", () => {
    tourStepIndex += 1;
    if (tourStepIndex >= TOUR_STEPS.length) {
      finishTour();
    } else {
      showTourStep(tourStepIndex);
    }
  });

  try {
    const introDismissed = localStorage.getItem("grammar-to-marser.intro-dismissed") === "1";
    const tourDone = localStorage.getItem("grammar-to-marser.tour-done") === "1";
    if (introDismissed && !tourDone) {
      setTimeout(() => startTour(), 400);
    }
  } catch {
    // ignore
  }
}

export function initPaneResizer(onResize) {
  const resizer = document.getElementById("pane-resizer");
  const pestPane = document.getElementById("pest-pane");
  const rustPane = document.getElementById("rust-pane");
  const panes = document.getElementById("panes");
  if (!resizer || !pestPane || !rustPane || !panes) return;

  const storageKey = "grammar-to-marser.split-ratio";
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

export function renderErrors(errors, onErrorClick = null) {
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
  for (const [index, err] of (errors || []).entries()) {
    const li = document.createElement("li");
    li.textContent = typeof err === "string" ? err : err.message;
    if (typeof onErrorClick === "function") {
      li.style.cursor = "pointer";
      li.tabIndex = 0;
      li.title = "Jump to error location";
      li.addEventListener("click", () => onErrorClick(index, err));
      li.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onErrorClick(index, err);
        }
      });
    }
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

import {
  createPestEditor,
  createRustEditor,
  fitEditors,
  setEditorContent,
} from "./editors.js";
import { EXAMPLES, DEFAULT_PEST, DEFAULT_PEG, DEFAULT_EXAMPLE_KEY } from "./examples.js";
import {
  copyText,
  downloadProjectZip,
  copyShareLink,
  initFileImport,
  getProjectName,
  setProjectName,
} from "./actions.js";
import { decodeShareState } from "./share.js";
import {
  initOnboarding,
  initDownloadDialog,
  initPaneResizer,
  updateRuleDatalist,
  updateEntryRuleHint,
  updateGrammarPanel,
  renderErrors,
  clearErrors,
  errorsAsText,
  setGrammarFilename,
  setStatus,
  setExampleDescription,
  setParseDiagnostic,
  parseDiagnosticExtensions,
  trailingInputOffset,
} from "./ui.js";

const STORAGE_KEY_GRAMMAR_SOURCE = "grammar-to-marser.grammar.source";
const STORAGE_KEY_PEG_SOURCE = "grammar-to-marser.peg.source";
const STORAGE_KEY_GRAMMAR_ENTRY = "grammar-to-marser.grammar.entry-rule";
const STORAGE_KEY_PEG_ENTRY = "grammar-to-marser.peg.entry-rule";
const STORAGE_KEY_EMIT_COMMENTS = "grammar-to-marser.emit-comments";
const STORAGE_KEY_EMIT_TRACE = "grammar-to-marser.emit-trace";
const STORAGE_KEY_SYNTAX = "grammar-to-marser.syntax";

const LEGACY_KEY_PEST_SOURCE = "grammar-to-marser.pest.source";
const LEGACY_KEY_PEST_ENTRY = "grammar-to-marser.pest.entry-rule";

function migrateLocalStorage() {
  try {
    const legacySource = localStorage.getItem(LEGACY_KEY_PEST_SOURCE);
    if (legacySource != null && !localStorage.getItem(STORAGE_KEY_GRAMMAR_SOURCE)) {
      localStorage.setItem(STORAGE_KEY_GRAMMAR_SOURCE, legacySource);
    }
    if (legacySource != null) {
      localStorage.removeItem(LEGACY_KEY_PEST_SOURCE);
    }

    const legacyEntry = localStorage.getItem(LEGACY_KEY_PEST_ENTRY);
    if (legacyEntry != null && !localStorage.getItem(STORAGE_KEY_GRAMMAR_ENTRY)) {
      localStorage.setItem(STORAGE_KEY_GRAMMAR_ENTRY, legacyEntry);
    }
    if (legacyEntry != null) {
      localStorage.removeItem(LEGACY_KEY_PEST_ENTRY);
    }
  } catch {
    // ignore
  }
}

migrateLocalStorage();

function loadSaved(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function save(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // ignore
  }
}

function loadBool(key, fallback) {
  const v = loadSaved(key);
  if (v === "1") return true;
  if (v === "0") return false;
  return fallback;
}

function initialDoc(key, fallback) {
  const saved = loadSaved(key);
  if (saved != null && saved.length > 0) return saved;
  return fallback;
}

function sourceKeyForSyntax(syntax) {
  return syntax === "peg" ? STORAGE_KEY_PEG_SOURCE : STORAGE_KEY_GRAMMAR_SOURCE;
}

function entryKeyForSyntax(syntax) {
  return syntax === "peg" ? STORAGE_KEY_PEG_ENTRY : STORAGE_KEY_GRAMMAR_ENTRY;
}

function defaultDocForSyntax(syntax) {
  return syntax === "peg" ? DEFAULT_PEG : DEFAULT_PEST;
}

function defaultEntryForSyntax(syntax) {
  for (const ex of Object.values(EXAMPLES)) {
    if (ex.syntax === syntax) return ex.entryRule;
  }
  return "";
}

function defaultExampleKeyForSyntax(syntax) {
  for (const [key, ex] of Object.entries(EXAMPLES)) {
    if (ex.syntax === syntax) return key;
  }
  return "";
}

const entryRuleEl = document.getElementById("entry-rule");
const examplesSelect = document.getElementById("examples-select");
const emitCommentsEl = document.getElementById("emit-comments");
const emitTraceEl = document.getElementById("emit-trace");

let debounceTimer = null;
let convertFn = null;
let listRulesFn = null;
let suggestSampleFn = null;
let lastRawOutput = "";
let lastErrors = [];
let lastConvertMs = null;
let ruleNames = [];
let activeExampleKey = "";

// ── Mode switch (replaces <select id="input-syntax">) ──

const shared = decodeShareState(window.location.hash);
let currentSyntax = shared?.syntax ?? loadSaved(STORAGE_KEY_SYNTAX) ?? "pest";

function getSyntax() {
  return currentSyntax;
}

function setSyntax(syntax) {
  currentSyntax = syntax;
  document.querySelectorAll(".mode-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.syntax === syntax);
    btn.setAttribute("aria-pressed", btn.dataset.syntax === syntax ? "true" : "false");
  });
}

/** Update all copy that depends on the current mode. */
function updateModeUI(syntax) {
  const subtitle = document.getElementById("mode-subtitle");
  if (subtitle) {
    subtitle.textContent = syntax === "peg"
      ? "PEG → Marser Rust converter"
      : "Pest → Marser Rust converter";
  }
  updateGrammarPanel(syntax);
}

function handleSyntaxChange(targetSyntax) {
  setSyntax(targetSyntax);
  save(STORAGE_KEY_SYNTAX, targetSyntax);
  const nextSource =
    loadSaved(sourceKeyForSyntax(targetSyntax)) ?? defaultDocForSyntax(targetSyntax);
  const nextEntry =
    loadSaved(entryKeyForSyntax(targetSyntax)) ?? defaultEntryForSyntax(targetSyntax);
  setEditorContent(grammarEditor, nextSource);
  save(sourceKeyForSyntax(targetSyntax), nextSource);
  if (entryRuleEl) {
    entryRuleEl.value = nextEntry;
    save(entryKeyForSyntax(targetSyntax), nextEntry);
  }
  activeExampleKey = findMatchingExample(nextSource, nextEntry, targetSyntax);
  populateExamplesSelect();
  if (examplesSelect) {
    examplesSelect.value = activeExampleKey || "";
  }
  setGrammarFilename(null);
  setExampleDescription(activeExampleKey ? (EXAMPLES[activeExampleKey]?.description ?? null) : null);
  updateModeUI(targetSyntax);
  scheduleConvert();
}

// Wire mode buttons
document.querySelectorAll(".mode-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const target = btn.dataset.syntax;
    if (target && target !== getSyntax()) {
      handleSyntaxChange(target);
    }
  });
});

// ──────────────────────────────────────────────

function findMatchingExample(source, entryRule, syntax) {
  const entry = (entryRule ?? "").trim();
  for (const [key, ex] of Object.entries(EXAMPLES)) {
    if (ex.syntax === syntax && ex.pest === source && ex.entryRule === entry) {
      return key;
    }
  }
  return "";
}

function populateExamplesSelect() {
  if (!examplesSelect) return;
  examplesSelect.innerHTML = "";
  const custom = document.createElement("option");
  custom.value = "";
  custom.textContent = "Custom grammar…";
  examplesSelect.appendChild(custom);
  for (const [key, ex] of Object.entries(EXAMPLES)) {
    if (ex.syntax !== getSyntax()) continue;
    const opt = document.createElement("option");
    opt.value = key;
    opt.textContent = ex.label;
    examplesSelect.appendChild(opt);
  }
}

function setActiveExample(key) {
  activeExampleKey = key;
  if (examplesSelect) {
    examplesSelect.value = key;
  }
}

function clearActiveExample() {
  activeExampleKey = "";
  if (examplesSelect) {
    examplesSelect.value = "";
  }
  setExampleDescription(null);
}

function loadExample(key, { focusEditor = false } = {}) {
  const ex = EXAMPLES[key];
  if (!ex) return;
  setActiveExample(key);
  setEditorContent(grammarEditor, ex.pest);
  save(sourceKeyForSyntax(getSyntax()), ex.pest);
  if (entryRuleEl) {
    entryRuleEl.value = ex.entryRule;
    save(entryKeyForSyntax(getSyntax()), ex.entryRule);
  }
  setGrammarFilename(null);
  setExampleDescription(ex.description ?? null);
  scheduleConvert();
  if (focusEditor) {
    requestAnimationFrame(() => grammarEditor.focus());
  }
}

// ── Init from saved/shared state ──

const defaultDoc = defaultDocForSyntax(currentSyntax);
const savedGrammar =
  shared?.source ?? initialDoc(sourceKeyForSyntax(currentSyntax), defaultDoc);

const savedEntry =
  shared?.entryRule ??
  loadSaved(entryKeyForSyntax(currentSyntax)) ??
  defaultEntryForSyntax(currentSyntax) ??
  EXAMPLES[DEFAULT_EXAMPLE_KEY].entryRule;

activeExampleKey = findMatchingExample(savedGrammar, savedEntry, currentSyntax);
populateExamplesSelect();
if (examplesSelect && activeExampleKey) {
  examplesSelect.value = activeExampleKey;
}

if (entryRuleEl) {
  entryRuleEl.value = savedEntry;
}

if (emitCommentsEl) {
  emitCommentsEl.checked = loadBool(STORAGE_KEY_EMIT_COMMENTS, true);
}

if (emitTraceEl) {
  emitTraceEl.checked = loadBool(STORAGE_KEY_EMIT_TRACE, false);
}

// Apply initial mode to buttons and surrounding copy
setSyntax(currentSyntax);
updateModeUI(currentSyntax);

// Show initial example description if one is active
if (activeExampleKey && EXAMPLES[activeExampleKey]?.description) {
  setExampleDescription(EXAMPLES[activeExampleKey].description);
}

// ──────────────────────────────────────────────

function getGrammarSource() {
  return grammarEditor.state.doc.toString();
}

function getEntryRule() {
  return entryRuleEl?.value ?? "";
}

function getEmitComments() {
  return emitCommentsEl?.checked ?? true;
}

function getEmitTrace() {
  return emitTraceEl?.checked ?? false;
}

/** Sample input for the downloadable project, generated from the grammar IR when possible. */
function getDownloadSampleInput() {
  if (suggestSampleFn) {
    try {
      const sample = suggestSampleFn(getGrammarSource(), getSyntax(), getEntryRule());
      // wasm-bindgen returns `undefined`/`null` for None; empty string is a valid sample.
      if (sample !== undefined && sample !== null) {
        return sample;
      }
    } catch {
      // fall through to comment heuristic
    }
  }
  const source = getGrammarSource();
  for (const line of source.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("// Try:")) continue;
    const payload = trimmed.slice("// Try:".length).trim();
    if (!payload) continue;
    const first = payload.split(",")[0]?.trim();
    if (first) {
      return first.replace(/\\n/g, "\n").replace(/\\r/g, "\r");
    }
  }
  return undefined;
}

function updateRustPane() {
  setEditorContent(rustEditor, lastRawOutput);
  const copyRustBtn = document.getElementById("copy-rust-btn");
  const downloadProjectBtn = document.getElementById("download-project-btn");
  const hasErrors = lastErrors.length > 0;
  const hasOutput = !!lastRawOutput;
  const disabled = !hasOutput || hasErrors;

  if (copyRustBtn) {
    copyRustBtn.disabled = disabled;
    if (hasErrors) {
      copyRustBtn.title = "Fix conversion errors first";
    } else if (!hasOutput) {
      copyRustBtn.title = "Convert a grammar to enable copy";
    } else {
      copyRustBtn.title = "";
    }
  }

  if (downloadProjectBtn) {
    downloadProjectBtn.disabled = disabled;
    if (hasErrors) {
      downloadProjectBtn.title = "Fix conversion errors to download";
    } else if (!hasOutput) {
      downloadProjectBtn.title = "Convert a grammar to enable download";
    } else {
      downloadProjectBtn.title = "Download a Cargo project zip with your grammar and generated parser";
    }
  }
}

function scheduleConvert() {
  clearTimeout(debounceTimer);
  if (convertFn) {
    setStatus("Converting...", "#666");
  }
  debounceTimer = setTimeout(runConvert, 300);
}

function wasmErrors(err) {
  if (Array.isArray(err)) {
    return err.map((item) => {
      if (typeof item === "string") return { message: item };
      if (item && typeof item.message === "string") {
        return {
          message: item.message,
          from: typeof item.from === "number" ? item.from : undefined,
          to: typeof item.to === "number" ? item.to : undefined,
        };
      }
      return { message: String(item) };
    });
  }
  if (err && typeof err === "object") {
    if (Array.isArray(err.value)) return wasmErrors(err.value);
    if (typeof err.message === "string") return [{ message: err.message }];
  }
  return [{ message: String(err) }];
}

function errorRange(error, source) {
  if (error && typeof error.from === "number" && typeof error.to === "number") {
    const from = error.from;
    const to = error.to > from ? error.to : Math.min(from + 1, source.length);
    return { from, to };
  }
  return trailingInputOffset(source, error?.message ?? "");
}

function focusError(error) {
  const source = getGrammarSource();
  const range = errorRange(error, source);
  if (!range) return;
  grammarEditor.dispatch({
    selection: { anchor: range.from, head: range.to },
    scrollIntoView: true,
  });
  grammarEditor.focus();
}

/** Returns true if this error can be jumped to in the editor. */
function isJumpable(error) {
  return errorRange(error, getGrammarSource()) !== null;
}

function refreshRules() {
  if (!listRulesFn) return;
  try {
    ruleNames = listRulesFn(getGrammarSource(), getSyntax());
    updateRuleDatalist(ruleNames);
    updateEntryRuleHint(getEntryRule(), ruleNames);
  } catch (err) {
    updateRuleDatalist([]);
    updateEntryRuleHint(getEntryRule(), ruleNames);
  }
}

function runConvert() {
  if (!convertFn) return;

  const source = getGrammarSource();
  const entry = getEntryRule().trim();
  const emitComments = getEmitComments();
  const emitTrace = getEmitTrace();

  refreshRules();

  const t0 = performance.now();
  try {
    const code = convertFn(source, getSyntax(), entry, emitComments, emitTrace);
    lastConvertMs = performance.now() - t0;
    lastRawOutput = code;
    lastErrors = [];
    setEditorContent(rustEditor, code);
    clearErrors();
    setParseDiagnostic(grammarEditor, null);
    setStatus(`Converted in ${Math.round(lastConvertMs)}ms`, "#4ec9b0");
    updateRustPane();
  } catch (err) {
    lastConvertMs = performance.now() - t0;
    lastRawOutput = "";
    lastErrors = wasmErrors(err);
    setEditorContent(rustEditor, "");
    renderErrors(lastErrors, (_index, error) => {
      focusError(error);
    }, isJumpable);
    setParseDiagnostic(grammarEditor, lastErrors);
    setStatus("Conversion failed", "#f48771");
    updateRustPane();
  }
}

const grammarEditor = createPestEditor(
  document.getElementById("grammar-editor"),
  savedGrammar,
  (text) => {
    save(sourceKeyForSyntax(getSyntax()), text);
    if (activeExampleKey) {
      const ex = EXAMPLES[activeExampleKey];
      if (!ex || text !== ex.pest) {
        clearActiveExample();
      }
    }
    scheduleConvert();
  },
  parseDiagnosticExtensions(() => getGrammarSource()),
);

const rustEditor = createRustEditor(document.getElementById("rust-editor"));

entryRuleEl?.addEventListener("input", () => {
  save(entryKeyForSyntax(getSyntax()), entryRuleEl.value);
  if (activeExampleKey) {
    const ex = EXAMPLES[activeExampleKey];
    if (!ex || ex.entryRule !== getEntryRule().trim()) {
      clearActiveExample();
    }
  }
  updateEntryRuleHint(getEntryRule(), ruleNames);
  scheduleConvert();
});

emitCommentsEl?.addEventListener("change", () => {
  save(STORAGE_KEY_EMIT_COMMENTS, emitCommentsEl.checked ? "1" : "0");
  scheduleConvert();
});

emitTraceEl?.addEventListener("change", () => {
  save(STORAGE_KEY_EMIT_TRACE, emitTraceEl.checked ? "1" : "0");
  scheduleConvert();
});

examplesSelect?.addEventListener("change", () => {
  const key = examplesSelect.value;
  if (!key || !EXAMPLES[key]) {
    clearActiveExample();
    return;
  }
  loadExample(key);
});

document.getElementById("copy-grammar-btn")?.addEventListener("click", (e) => {
  copyText(getGrammarSource(), e.currentTarget);
});

document.getElementById("copy-rust-btn")?.addEventListener("click", (e) => {
  copyText(rustEditor.state.doc.toString(), e.currentTarget);
});

document.getElementById("copy-errors-btn")?.addEventListener("click", (e) => {
  copyText(errorsAsText(lastErrors), e.currentTarget);
});

initDownloadDialog({
  getDefaultName: () => getProjectName(),
  onConfirm: (rawName) => {
    const projectName = setProjectName(rawName);
    downloadProjectZip({
      grammarSource: getGrammarSource(),
      grammarRs: lastRawOutput,
      entryRule: getEntryRule(),
      syntax: getSyntax(),
      emitTrace: getEmitTrace(),
      projectName,
      sampleInput: getDownloadSampleInput(),
    });
  },
});

document.getElementById("share-link-btn")?.addEventListener("click", (e) => {
  copyShareLink(
    { source: getGrammarSource(), entryRule: getEntryRule(), syntax: getSyntax() },
    e.currentTarget,
  );
});

initFileImport({
  onOpen: (text, filename) => {
    setEditorContent(grammarEditor, text);
    save(sourceKeyForSyntax(getSyntax()), text);
    setGrammarFilename(filename);
    clearActiveExample();
    scheduleConvert();
  },
  onSyntaxDetected: (detectedSyntax) => {
    if (detectedSyntax !== getSyntax()) {
      handleSyntaxChange(detectedSyntax);
    }
  },
});

function onResize() {
  fitEditors(grammarEditor, rustEditor);
}

window.addEventListener("resize", onResize);
initPaneResizer(onResize);
initOnboarding({
  onTryExample: () => {
    const key = defaultExampleKeyForSyntax(getSyntax());
    if (key) {
      loadExample(key, { focusEditor: true });
    } else {
      requestAnimationFrame(() => grammarEditor.focus());
    }
  },
});
requestAnimationFrame(onResize);

async function initWasm() {
  try {
    const wasm = await import("./pkg/web.js");
    await wasm.default();
    convertFn = wasm.convert;
    listRulesFn = wasm.list_grammar_rules;
    suggestSampleFn = wasm.suggest_sample_input;
    setStatus("Ready", "#666");
    runConvert();
  } catch (err) {
    setStatus("Failed to load", "#f48771");
    renderErrors([{ message: "App failed to load. Try refreshing the page." }]);
  }
}

initWasm();

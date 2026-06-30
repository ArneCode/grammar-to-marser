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
} from "./actions.js";
import { decodeShareState, currentShareHash } from "./share.js";
import {
  initOnboarding,
  initPaneResizer,
  updateRuleDatalist,
  updateEntryRuleHint,
  renderErrors,
  clearErrors,
  errorsAsText,
  setShareOutdated,
  setPestFilename,
  setStatus,
  setParseDiagnostic,
  parseDiagnosticExtensions,
} from "./ui.js";

const STORAGE_KEY_PEST_SOURCE = "grammar-to-marser.pest.source";
const STORAGE_KEY_PEG_SOURCE = "grammar-to-marser.peg.source";
const STORAGE_KEY_PEST_ENTRY = "grammar-to-marser.pest.entry-rule";
const STORAGE_KEY_PEG_ENTRY = "grammar-to-marser.peg.entry-rule";
const STORAGE_KEY_EMIT_COMMENTS = "grammar-to-marser.emit-comments";
const STORAGE_KEY_EMIT_TRACE = "grammar-to-marser.emit-trace";
const STORAGE_KEY_SYNTAX = "grammar-to-marser.syntax";

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
  return syntax === "peg" ? STORAGE_KEY_PEG_SOURCE : STORAGE_KEY_PEST_SOURCE;
}

function entryKeyForSyntax(syntax) {
  return syntax === "peg" ? STORAGE_KEY_PEG_ENTRY : STORAGE_KEY_PEST_ENTRY;
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

const entryRuleEl = document.getElementById("entry-rule");
const examplesSelect = document.getElementById("examples-select");
const emitCommentsEl = document.getElementById("emit-comments");
const emitTraceEl = document.getElementById("emit-trace");
const syntaxEl = document.getElementById("input-syntax");

let debounceTimer = null;
let convertFn = null;
let listRulesFn = null;
let lastShareHash = "";
let lastRawOutput = "";
let lastErrors = [];
let lastConvertMs = null;
let ruleNames = [];
let activeExampleKey = "";

function findMatchingExample(pest, entryRule, syntax) {
  const entry = (entryRule ?? "").trim();
  for (const [key, ex] of Object.entries(EXAMPLES)) {
    if (ex.syntax === syntax && ex.pest === pest && ex.entryRule === entry) {
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
}

const shared = decodeShareState(window.location.hash);
const savedSyntax =
  shared?.syntax ??
  loadSaved(STORAGE_KEY_SYNTAX) ??
  "pest";
const defaultDoc = defaultDocForSyntax(savedSyntax);
const savedPest =
  shared?.pest ?? initialDoc(sourceKeyForSyntax(savedSyntax), defaultDoc);

const savedEntry =
  shared?.entryRule ??
  loadSaved(entryKeyForSyntax(savedSyntax)) ??
  defaultEntryForSyntax(savedSyntax) ??
  EXAMPLES[DEFAULT_EXAMPLE_KEY].entryRule;

activeExampleKey = findMatchingExample(savedPest, savedEntry, savedSyntax);
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

if (syntaxEl) {
  syntaxEl.value = savedSyntax;
}

function getPestSource() {
  return pestEditor.state.doc.toString();
}

function getSyntax() {
  return syntaxEl?.value ?? "pest";
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

function updateRustPane() {
  setEditorContent(rustEditor, lastRawOutput);
  const copyRustBtn = document.getElementById("copy-rust-btn");
  const downloadProjectBtn = document.getElementById("download-project-btn");
  const disabled = !lastRawOutput || lastErrors.length > 0;
  if (copyRustBtn) copyRustBtn.disabled = disabled;
  if (downloadProjectBtn) downloadProjectBtn.disabled = disabled;
}

function markShareState() {
  const hash = currentShareHash({
    pest: getPestSource(),
    entryRule: getEntryRule(),
    syntax: getSyntax(),
  });
  setShareOutdated(hash !== lastShareHash);
}

function scheduleConvert() {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(runConvert, 300);
  markShareState();
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

function trailingInputOffset(source, errorMessage) {
  const match = /trailing input: (\d+) byte\(s\) remain unparsed/.exec(errorMessage);
  if (!match) return null;
  const remaining = parseInt(match[1], 10);
  if (Number.isNaN(remaining)) return null;
  const offset = source.length - remaining;
  if (offset < 0 || offset > source.length) return null;
  return { from: offset, to: source.length };
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
  const source = getPestSource();
  const range = errorRange(error, source);
  if (!range) return;
  pestEditor.dispatch({
    selection: { anchor: range.from, head: range.to },
    scrollIntoView: true,
  });
  pestEditor.focus();
}

function refreshRules() {
  if (!listRulesFn) return;
  try {
    ruleNames = listRulesFn(getPestSource(), getSyntax());
    updateRuleDatalist(ruleNames);
    updateEntryRuleHint(getEntryRule(), ruleNames);
  } catch (err) {
    ruleNames = [];
    updateRuleDatalist([]);
    updateEntryRuleHint(getEntryRule(), []);
  }
}

function runConvert() {
  if (!convertFn) return;

  const source = getPestSource();
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
    setParseDiagnostic(pestEditor, null);
    setStatus(`OK · ${Math.round(lastConvertMs)}ms`, "#4ec9b0");
    updateRustPane();
  } catch (err) {
    lastConvertMs = performance.now() - t0;
    lastRawOutput = "";
    lastErrors = wasmErrors(err);
    setEditorContent(rustEditor, "");
    renderErrors(lastErrors, (_index, error) => {
      focusError(error);
    });
    setParseDiagnostic(pestEditor, lastErrors);
    setStatus(`Error · ${Math.round(lastConvertMs)}ms`, "#f48771");
    updateRustPane();
  }
  markShareState();
}

const pestEditor = createPestEditor(
  document.getElementById("pest-editor"),
  savedPest,
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
  parseDiagnosticExtensions(() => getPestSource()),
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

syntaxEl?.addEventListener("change", () => {
  const targetSyntax = getSyntax();
  save(STORAGE_KEY_SYNTAX, targetSyntax);
  const nextSource =
    loadSaved(sourceKeyForSyntax(targetSyntax)) ?? defaultDocForSyntax(targetSyntax);
  const nextEntry =
    loadSaved(entryKeyForSyntax(targetSyntax)) ?? defaultEntryForSyntax(targetSyntax);
  setEditorContent(pestEditor, nextSource);
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
  setPestFilename(null);
  scheduleConvert();
});

examplesSelect?.addEventListener("change", () => {
  const key = examplesSelect.value;
  if (!key || !EXAMPLES[key]) {
    clearActiveExample();
    return;
  }
  const ex = EXAMPLES[key];
  setActiveExample(key);
  setEditorContent(pestEditor, ex.pest);
  save(sourceKeyForSyntax(getSyntax()), ex.pest);
  if (entryRuleEl) {
    entryRuleEl.value = ex.entryRule;
    save(entryKeyForSyntax(getSyntax()), ex.entryRule);
  }
  setPestFilename(null);
  scheduleConvert();
});

document.getElementById("copy-pest-btn")?.addEventListener("click", (e) => {
  copyText(getPestSource(), e.currentTarget);
});

document.getElementById("copy-rust-btn")?.addEventListener("click", (e) => {
  copyText(rustEditor.state.doc.toString(), e.currentTarget);
});

document.getElementById("copy-errors-btn")?.addEventListener("click", (e) => {
  copyText(errorsAsText(lastErrors), e.currentTarget);
});

document.getElementById("download-project-btn")?.addEventListener("click", () => {
  if (!lastRawOutput || lastErrors.length > 0) return;
  downloadProjectZip({
    pestSource: getPestSource(),
    grammarRs: lastRawOutput,
    entryRule: getEntryRule(),
    syntax: getSyntax(),
    emitTrace: getEmitTrace(),
  });
});

document.getElementById("share-link-btn")?.addEventListener("click", (e) => {
  copyShareLink(
    { pest: getPestSource(), entryRule: getEntryRule(), syntax: getSyntax() },
    e.currentTarget,
  ).then(() => {
    lastShareHash = currentShareHash({
      pest: getPestSource(),
      entryRule: getEntryRule(),
      syntax: getSyntax(),
    });
    setShareOutdated(false);
  });
});

initFileImport({
  onOpen: (text, filename) => {
    setEditorContent(pestEditor, text);
    save(sourceKeyForSyntax(getSyntax()), text);
    setPestFilename(filename);
    clearActiveExample();
    scheduleConvert();
  },
});

function onResize() {
  fitEditors(pestEditor, rustEditor);
}

window.addEventListener("resize", onResize);
initPaneResizer(onResize);
initOnboarding();
requestAnimationFrame(onResize);

async function initWasm() {
  try {
    const wasm = await import("./pkg/web.js");
    await wasm.default();
    convertFn = wasm.convert;
    listRulesFn = wasm.list_grammar_rules;
    setStatus("Ready", "#666");
    lastShareHash = currentShareHash({
      pest: getPestSource(),
      entryRule: getEntryRule(),
      syntax: getSyntax(),
    });
    setShareOutdated(false);
    runConvert();
  } catch (err) {
    setStatus("WASM load failed", "#f48771");
    renderErrors([String(err)]);
  }
}

initWasm();

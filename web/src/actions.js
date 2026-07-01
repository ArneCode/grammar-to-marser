import JSZip from "jszip";
import {
  cargoToml,
  gitignore,
  libRs,
  mainRs,
  readme,
} from "./templates.js";
import { shareUrl } from "./share.js";
import { flashButton, setStatus } from "./ui.js";

const PROJECT_NAME_KEY = "grammar-to-marser.project-name";

export async function copyText(text, button) {
  try {
    await navigator.clipboard.writeText(text);
    flashButton(button);
  } catch (err) {
    console.error("copy failed", err);
    flashButton(button, "Failed!");
    setStatus("Copy failed — clipboard access denied", "#f48771");
  }
}

export function downloadBlob(filename, content, mime = "text/plain") {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function getProjectName() {
  try {
    return localStorage.getItem(PROJECT_NAME_KEY) || "grammar-parser";
  } catch {
    return "grammar-parser";
  }
}

export function setProjectName(name) {
  const sanitized = name.trim().replace(/[^a-zA-Z0-9_-]/g, "-") || "grammar-parser";
  try {
    localStorage.setItem(PROJECT_NAME_KEY, sanitized);
  } catch {
    // ignore
  }
  return sanitized;
}

export async function downloadProjectZip({
  grammarSource,
  grammarRs,
  entryRule,
  syntax = "pest",
  emitTrace = false,
  projectName,
  sampleInput,
}) {
  const name = projectName ?? getProjectName();
  // `sampleInput` may legitimately contain leading/trailing whitespace, or even be empty
  // for grammars that accept empty input. If we can't generate a trustworthy sample,
  // export an empty file instead of guessing.
  const sample = typeof sampleInput === "string" ? sampleInput : "";

  const zip = new JSZip();

  zip.file("Cargo.toml", cargoToml(name, emitTrace));
  zip.file(syntax === "peg" ? "grammar.peg" : "grammar.pest", grammarSource);
  zip.file("README.md", readme(name, entryRule, emitTrace));
  zip.file(".gitignore", gitignore());
  zip.file("examples/sample.txt", sample);
  zip.file("src/lib.rs", libRs());
  zip.file("src/grammar.rs", grammarRs);
  zip.file("src/main.rs", mainRs(name, emitTrace));

  const blob = await zip.generateAsync({ type: "blob" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${name}.zip`;
  a.click();
  URL.revokeObjectURL(url);
}

export async function copyShareLink(state, button) {
  const url = shareUrl(state);
  await copyText(url, button);
  if (window.history.replaceState) {
    window.history.replaceState(null, "", url);
  }
}

export function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

/** Detect grammar syntax from file extension. Returns "pest", "peg", or null. */
function detectSyntaxFromFilename(filename) {
  const ext = filename.split(".").pop()?.toLowerCase();
  if (ext === "pest") return "pest";
  if (ext === "peg") return "peg";
  return null;
}

/**
 * @param {{ onOpen: (text: string, filename: string) => void, onSyntaxDetected?: (syntax: string) => void }} options
 */
export function initFileImport({ onOpen, onSyntaxDetected }) {
  const input = document.getElementById("file-input");
  const openBtn = document.getElementById("open-file-btn");
  const grammarHost = document.getElementById("grammar-editor");

  if (openBtn && input) {
    openBtn.addEventListener("click", () => input.click());
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const text = await readFileAsText(file);
        const detected = detectSyntaxFromFilename(file.name);
        if (detected && onSyntaxDetected) {
          onSyntaxDetected(detected);
        }
        onOpen(text, file.name);
      } catch (err) {
        console.error("file read failed", err);
        setStatus("Failed to read file", "#f48771");
      }
      input.value = "";
    });
  }

  if (grammarHost) {
    grammarHost.addEventListener("dragover", (e) => {
      e.preventDefault();
      grammarHost.classList.add("drag-over");
    });
    grammarHost.addEventListener("dragleave", () => {
      grammarHost.classList.remove("drag-over");
    });
    grammarHost.addEventListener("drop", async (e) => {
      e.preventDefault();
      grammarHost.classList.remove("drag-over");
      const file = e.dataTransfer?.files?.[0];
      if (!file) return;
      try {
        const text = await readFileAsText(file);
        const detected = detectSyntaxFromFilename(file.name);
        if (detected && onSyntaxDetected) {
          onSyntaxDetected(detected);
        }
        onOpen(text, file.name);
      } catch (err) {
        console.error("file read failed", err);
        setStatus("Failed to read file", "#f48771");
      }
    });
  }
}

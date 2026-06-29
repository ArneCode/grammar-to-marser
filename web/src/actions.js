import JSZip from "jszip";
import { cargoToml, mainRs, readme } from "./templates.js";
import { shareUrl } from "./share.js";
import { flashButton } from "./ui.js";

const PROJECT_NAME_KEY = "pest-to-marser.project-name";

export async function copyText(text, button) {
  try {
    await navigator.clipboard.writeText(text);
    flashButton(button);
  } catch (err) {
    console.error("copy failed", err);
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

export function downloadGrammarRs(code) {
  downloadBlob("grammar.rs", code);
}

export function getProjectName() {
  try {
    return localStorage.getItem(PROJECT_NAME_KEY) || "pest-parser";
  } catch {
    return "pest-parser";
  }
}

export function promptProjectName() {
  const current = getProjectName();
  const name = window.prompt("Project name (for zip folder and Cargo package):", current);
  if (name == null || name.trim() === "") {
    return current;
  }
  const sanitized = name.trim().replace(/[^a-zA-Z0-9_-]/g, "-");
  try {
    localStorage.setItem(PROJECT_NAME_KEY, sanitized);
  } catch {
    // ignore
  }
  return sanitized;
}

export async function downloadProjectZip({
  pestSource,
  grammarRs,
  entryRule,
}) {
  const projectName = promptProjectName();
  const zip = new JSZip();
  const folder = zip.folder(projectName);

  folder.file("Cargo.toml", cargoToml(projectName));
  folder.file("grammar.pest", pestSource);
  folder.file("README.md", readme(projectName, entryRule));
  folder.file("src/grammar.rs", grammarRs);
  folder.file("src/main.rs", mainRs());

  const blob = await zip.generateAsync({ type: "blob" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${projectName}.zip`;
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

export function initFileImport({ onOpen }) {
  const input = document.getElementById("file-input");
  const openBtn = document.getElementById("open-file-btn");
  const pestHost = document.getElementById("pest-editor");

  if (openBtn && input) {
    openBtn.addEventListener("click", () => input.click());
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      if (!file) return;
      const text = await readFileAsText(file);
      onOpen(text, file.name);
      input.value = "";
    });
  }

  if (pestHost) {
    pestHost.addEventListener("dragover", (e) => {
      e.preventDefault();
      pestHost.classList.add("drag-over");
    });
    pestHost.addEventListener("dragleave", () => {
      pestHost.classList.remove("drag-over");
    });
    pestHost.addEventListener("drop", async (e) => {
      e.preventDefault();
      pestHost.classList.remove("drag-over");
      const file = e.dataTransfer?.files?.[0];
      if (!file) return;
      const text = await readFileAsText(file);
      onOpen(text, file.name);
    });
  }
}

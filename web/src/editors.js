import { basicSetup, EditorView } from "codemirror";
import { EditorState } from "@codemirror/state";
import { StreamLanguage, indentUnit } from "@codemirror/language";
import { rust } from "@codemirror/lang-rust";
import { vscodeDark } from "@uiw/codemirror-theme-vscode";

const BUILTINS = new Set([
  "SOI",
  "EOI",
  "ANY",
  "ASCII_ALPHA",
  "ASCII_ALPHANUMERIC",
  "ASCII_DIGIT",
  "ASCII_HEXDIGIT",
  "ASCII_BIN",
  "ASCII_OCT",
  "ASCII_PUNCT",
  "ASCII_LOWER",
  "ASCII_UPPER",
]);

const pestLanguage = StreamLanguage.define({
  name: "pest",
  startState() {
    return { lineStart: true };
  },
  token(stream, state) {
    if (stream.sol()) {
      state.lineStart = true;
    }

    if (stream.eatSpace()) {
      return null;
    }

    if (stream.match("//")) {
      stream.skipToEnd();
      state.lineStart = false;
      return "comment";
    }

    if (stream.match('"')) {
      while (!stream.eol()) {
        const ch = stream.next();
        if (ch === null) break;
        if (ch === '"') break;
        if (ch === "\\") stream.next();
      }
      state.lineStart = false;
      return "string";
    }

    if (stream.match(/[@_$]/)) {
      state.lineStart = false;
      return "qualifier";
    }

    if (stream.match(/[!&]/)) {
      state.lineStart = false;
      return "operator";
    }

    if (stream.match(/[a-zA-Z_][a-zA-Z0-9_]*/)) {
      const word = stream.current();
      if (BUILTINS.has(word)) {
        state.lineStart = false;
        return "builtin";
      }

      if (state.lineStart) {
        const saved = stream.pos;
        stream.eatSpace();
        stream.match(/[@_$]*/);
        stream.eatSpace();
        if (stream.peek() === "=") {
          state.lineStart = false;
          return "def";
        }
        stream.pos = saved;
      }

      state.lineStart = false;
      return "variable";
    }

    if (stream.match(/[=~|*+?,(){}]/)) {
      state.lineStart = false;
      return "operator";
    }

    stream.next();
    state.lineStart = false;
    return null;
  },
});

export function createPestEditor(parent, doc, onDocChange, extraExtensions = []) {
  return new EditorView({
    state: EditorState.create({
      doc,
      extensions: [
        basicSetup,
        vscodeDark,
        pestLanguage,
        indentUnit.of("  "),
        ...extraExtensions,
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            onDocChange(update.state.doc.toString());
          }
        }),
      ],
    }),
    parent,
  });
}

export function createRustEditor(parent) {
  return new EditorView({
    state: EditorState.create({
      doc: "",
      extensions: [
        basicSetup,
        vscodeDark,
        rust(),
        EditorState.readOnly.of(true),
        EditorView.editable.of(false),
        EditorView.lineWrapping,
      ],
    }),
    parent,
  });
}

export function fitEditors(pestEditor, rustEditor) {
  for (const [view, hostId] of [
    [pestEditor, "pest-editor"],
    [rustEditor, "rust-editor"],
  ]) {
    const host = document.getElementById(hostId);
    const height = host.clientHeight;
    if (height > 0) {
      view.dom.style.height = `${height}px`;
    }
  }
  pestEditor.requestMeasure();
  rustEditor.requestMeasure();
}

export function setEditorContent(view, text) {
  const current = view.state.doc.toString();
  if (current === text) return;

  const scrollTop = view.scrollDOM.scrollTop;
  const scrollLeft = view.scrollDOM.scrollLeft;

  view.dispatch({
    changes: { from: 0, to: current.length, insert: text },
  });

  view.scrollDOM.scrollTop = scrollTop;
  view.scrollDOM.scrollLeft = scrollLeft;
}

export function wrapAsModule(code) {
  const indented = code
    .split("\n")
    .map((line) => (line.length > 0 ? `    ${line}` : ""))
    .join("\n");
  return `pub mod grammar {\n${indented}\n}`;
}

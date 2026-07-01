const MARSER_VERSION = "0.2.2";

const MARSER_DEP = `marser = { version = "${MARSER_VERSION}", features = ["annotate-snippets"] }`;

/** Rust crate identifier derived from a Cargo package name. */
export function rustCrateIdent(packageName) {
  let ident = packageName.replace(/-/g, "_");
  if (/^\d/.test(ident)) {
    ident = `_${ident}`;
  }
  return ident;
}

export function cargoToml(projectName, emitTrace = false) {
  if (!emitTrace) {
    return `[package]
name = "${projectName}"
version = "0.1.0"
edition = "2024"

[dependencies]
${MARSER_DEP}
`;
  }

  return `[package]
name = "${projectName}"
version = "0.1.0"
edition = "2024"

[features]
default = []
parser-trace = ["marser/parser-trace"]

[dependencies]
${MARSER_DEP}
`;
}

export function libRs() {
  return "pub mod grammar;\n";
}

export function gitignore() {
  return "/target\n";
}

export function defaultSampleInput() {
  return "1";
}

export function mainRs(projectName, emitTrace = false) {
  const crateIdent = rustCrateIdent(projectName);
  const traceImport = emitTrace
    ? '#[cfg(feature = "parser-trace")]\nuse marser::trace::TraceFormat;\n'
    : "";

  const parseBody = emitTrace
    ? `    #[cfg(feature = "parser-trace")]
    {
        let parser = grammar::grammar();
        if let Some(trace_path) = trace_file {
            match parser.parse_str_with_trace_to_file(
                &input,
                &trace_path,
                TraceFormat::Json,
            ) {
                Ok((parsed, _errors)) => {
                    eprintln!("trace written to {trace_path}");
                    println!("{parsed:#?}");
                }
                Err(marser::ParseWithTraceToFileError::Parse(err)) => {
                    err.eprint(&label, &input);
                    process::exit(1);
                }
                Err(marser::ParseWithTraceToFileError::Io(err)) => {
                    eprintln!("failed to write trace file '{trace_path}': {err}");
                    process::exit(1);
                }
            }
        } else {
            match parser.parse_str_with_trace(&input) {
                Ok((parsed, _errors, _trace)) => println!("{parsed:#?}"),
                Err(err) => {
                    err.eprint(&label, &input);
                    process::exit(1);
                }
            }
        }
    }

    #[cfg(not(feature = "parser-trace"))]
    {
        if trace_file.is_some() {
            eprintln!("rebuild with --features parser-trace to use --trace-file");
            process::exit(2);
        }
        match grammar::grammar().parse_str(&input) {
            Ok((parsed, _errors)) => println!("{parsed:#?}"),
            Err(err) => {
                err.eprint(&label, &input);
                process::exit(1);
            }
        }
    }`
    : `    if trace_file.is_some() {
        eprintln!("this project was generated without trace support");
        process::exit(2);
    }

    match grammar::grammar().parse_str(&input) {
        Ok((parsed, _errors)) => println!("{parsed:#?}"),
        Err(err) => {
            err.eprint(&label, &input);
            process::exit(1);
        }
    }`;

  return `use std::{env, fs, process};

use marser::parser::Parser;
${traceImport}use ${crateIdent}::grammar;

fn usage(program: &str) -> ! {
    eprintln!("Usage: {program} <input-file> [--trace-file <path>]");
    process::exit(2);
}

fn read_input(path: &str) -> (String, String) {
    let input = fs::read_to_string(path).unwrap_or_else(|err| {
        eprintln!("failed to read {path}: {err}");
        process::exit(1);
    });
    (input, path.to_string())
}

fn main() {
    let program = env::args()
        .next()
        .unwrap_or_else(|| "${projectName}".to_string());
    let args: Vec<String> = env::args().skip(1).collect();

    let mut input_path = None;
    let mut trace_file = None;
    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            "--trace-file" => {
                i += 1;
                trace_file = Some(
                    args.get(i)
                        .cloned()
                        .unwrap_or_else(|| usage(&program)),
                );
                i += 1;
            }
            "--help" | "-h" => usage(&program),
            arg if arg.starts_with('-') => usage(&program),
            arg => {
                if input_path.is_some() {
                    usage(&program);
                }
                input_path = Some(arg.to_string());
                i += 1;
            }
        }
    }

    let path = input_path.unwrap_or_else(|| usage(&program));
    let (input, label) = read_input(&path);

${parseBody}
}
`;
}

export function readme(projectName, entryRule, emitTrace = false) {
  const entry = entryRule.trim() || "(last rule in grammar)";
  const buildSection = emitTrace
    ? `## Build and run

\`\`\`sh
cargo build --features parser-trace
cargo run --features parser-trace -- examples/sample.txt
\`\`\`

Pass an input file path. On success the parser prints the parsed AST with \`Debug\` formatting.`
    : `## Build and run

\`\`\`sh
cargo build
cargo run -- examples/sample.txt
\`\`\`

Pass an input file path. On success the parser prints the parsed AST with \`Debug\` formatting.`;

  const tracingSection = emitTrace
    ? `
## Tracing and debugging

This project was generated with \`.trace()\` markers in \`src/grammar.rs\`. To record a parse trace and step through it in the [marser trace viewer](https://crates.io/crates/marser-trace-viewer):

\`\`\`sh
# install the viewer once
cargo install marser-trace-viewer

# parse a file and write a trace
cargo run --features parser-trace -- examples/sample.txt --trace-file trace.json

# open the trace (use the same input file for span preview)
marser-trace-viewer --trace trace.json --source examples/sample.txt
\`\`\`

Tracing adds runtime overhead; use \`parser-trace\` for debugging rather than production builds.
`
    : "";

  const nextStepsSection = `
## Next steps

The generated parser returns a typed \`Parsed<'src>\` enum with one variant per rule. Typical follow-ups:

1. **Shape the AST** — the scaffold returns \`Parsed<'src>\` directly. You can rename variants/fields, change leaf values (e.g. parse numbers), or add a conversion step that maps \`Parsed<'src>\` into your own AST types. \`src/grammar.rs\` already uses \`bind!\` / \`bind_slice!\` for rule references and leaves. See [Capture and Binds](https://docs.rs/marser/latest/marser/guide/capture_and_binds/index.html) and the [worked JSON example](https://docs.rs/marser/latest/marser/guide/worked_json_example/index.html).
2. **Improve diagnostics** — use \`.with_label(...)\` on rules, \`add_error_info\`, and \`annotate-snippets\` output (already enabled in \`Cargo.toml\`). See [Errors and Recovery](https://docs.rs/marser/latest/marser/guide/errors_and_recovery/index.html).
3. **Recover from errors** — return partial results with \`recover_with\`, inline hints with \`try_insert_if_missing\` / \`unwanted\`, and commits with \`commit_on\` where backtracking should stop. Same guide: [Errors and Recovery](https://docs.rs/marser/latest/marser/guide/errors_and_recovery/index.html).
4. **Refine the grammar** — whitespace, lists, and recursion recipes in [Common patterns](https://docs.rs/marser/latest/marser/guide/common_patterns/index.html).${emitTrace ? "" : "\n5. **Debug parsing** — re-generate with **Trace** enabled in grammar-to-marser, or add \`.trace()\` markers by hand. See [Tracing and Debugging](https://docs.rs/marser/latest/marser/guide/tracing_and_debugging/index.html)."}

Full guide index: [marser guide](https://docs.rs/marser/latest/marser/guide/index.html).
`;

  return `# ${projectName}

Generated by [grammar-to-marser](https://github.com/ArneCode/grammar-to-marser).

## Entry rule

\`${entry}\`

${buildSection}
${tracingSection}## Sample input

The file \`examples/sample.txt\` is generated on a best-effort basis. For some grammars (for example ones that use lookahead) there may be **no** auto-generated sample, and the file may be empty.

If \`cargo run -- examples/sample.txt\` fails, replace \`examples/sample.txt\` with input that matches the entry rule and run again.

${nextStepsSection}`;
}

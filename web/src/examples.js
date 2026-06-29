export const EXAMPLES = {
  simple: {
    label: "Simple",
    entryRule: "main",
    pest: `WHITESPACE = _{ " " | "\\t" | newline }
COMMENT = _{ line_comment }
newline = _{ "\\n" | "\\r\\n" }
line_comment = _{ "//" ~ (!newline ~ ANY)* }

main = { SOI ~ item ~ ("," ~ item)* ~ EOI }
item = { ident ~ "=" ~ number }
ident = @{ ("_" | ASCII_ALPHA) ~ ("_" | ASCII_ALPHANUMERIC)* }
number = @{ ASCII_DIGIT+ }
`,
  },
  calc: {
    label: "Calculator",
    entryRule: "expr",
    pest: `expr = { term ~ (("+" | "-") ~ term)* }
term = { factor ~ (("*" | "/") ~ factor)* }
factor = { number | "(" ~ expr ~ ")" }
number = @{ ASCII_DIGIT+ }
WHITESPACE = _{ " " | "\\t" }
`,
  },
};

export const DEFAULT_PEST = EXAMPLES.simple.pest;

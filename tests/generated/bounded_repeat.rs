use marser::capture;
use marser::matcher::{
    many,
    repeat,
    start_of_input,
    end_of_input,
};
use marser::parser::{
    Parser,
};

// Typed parse tree returned by `grammar()`. Each grammar rule becomes a variant;
// labeled bindings become struct fields, and leaf rules store their matched slice
// as `value`.
#[derive(Debug, Clone, PartialEq)]
pub enum Parsed<'src> {
    main {
        chars: Vec<&'src str>,
    },
}

// Returns a complete parser for this grammar.
// Usage: grammar().parse_str(src)  →  Ok((Parsed, errors))
pub fn grammar<'src>() -> impl Parser<'src, &'src str, Output = Parsed<'src>> + Clone {
    // WHITESPACE = _{ " " }
    let WHITESPACE = ' ';

    // Pest injects WHITESPACE (and COMMENT) between every `~` in non-atomic rules.
    // ws.clone() appears between sequence elements throughout this file for that reason.
    let ws = many(
        WHITESPACE.clone()
    );

    // main = { SOI ~ #chars = "a"{2,4} ~ EOI }
    let main = capture!(
        (
            start_of_input(),
            ws.clone(),
            (
                bind_slice!('a', *chars as &'src str),
                repeat(
                    (ws.clone(), bind_slice!('a', *chars as &'src str)),
                    1..=3,
                ),
            ),
            ws.clone(),
            end_of_input(),
        ) => Parsed::main { chars: chars }
    );

    main.clone()
}

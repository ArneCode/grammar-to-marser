use marser::capture;
use marser::matcher::{
    Matcher,
    many,
    positive_lookahead,
    start_of_input,
    end_of_input,
};
use marser::parser::{
    Parser,
    ParserCombinator,
};

// Typed parse tree returned by `grammar()`. Each Pest rule becomes a variant;
// `#field = ...` bindings become struct fields, and atomic (`@`) leaves store
// their matched slice as `value`.
#[derive(Debug, Clone, PartialEq)]
pub enum Parsed<'src> {
    main {
        matched: &'src str,
    },
}

pub fn grammar<'src>() -> impl Parser<'src, &'src str, Output = Parsed<'src>> + Clone {
    // WHITESPACE = _{ " " }
    let WHITESPACE = ' ';

    let ws = many(
        WHITESPACE.clone()
    );

    // main = { SOI ~ &"ab" ~ #matched = "ab" ~ EOI }
    let main = capture!(
        (
            start_of_input(),
            ws.clone(),
            positive_lookahead("ab"),
            ws.clone(),
            bind_slice!("ab", matched as &'src str),
            ws.clone(),
            end_of_input(),
        ) => Parsed::main { matched: matched }
    );

    main.clone()
}

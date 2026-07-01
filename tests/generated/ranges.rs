use marser::capture;
use marser::matcher::{
    many,
    repeat,
    start_of_input,
    end_of_input,
};
use marser::one_of::one_of;
use marser::parser::{
    Parser,
};

// Typed parse tree returned by `grammar()`. Each grammar rule becomes a variant;
// labeled bindings become struct fields, and leaf rules store their matched slice
// as `value`.
#[derive(Debug, Clone, PartialEq)]
pub enum Parsed<'src> {
    main {
        hex_color_val: Box<Parsed<'src>>,
    },
    hex_color {
        body: Vec<&'src str>,
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

    // hex_digit = _{ '0'..'9' | 'a'..'f' | 'A'..'F' }
    let hex_digit = one_of(('0'..='9', 'a'..='f', 'A'..='F'));

    // hex_color = { "#" ~ #body = hex_digit{6} }
    let hex_color = capture!(
        (
            '#',
            ws.clone(),
            (
                bind_slice!(hex_digit.clone(), *body as &'src str),
                repeat(
                    (
                        ws.clone(),
                        bind_slice!(hex_digit.clone(), *body as &'src str),
                    ),
                    5..=5,
                ),
            ),
        ) => Parsed::hex_color { body: body }
    );

    // main = { SOI ~ hex_color ~ EOI }
    let main = capture!(
        (
            start_of_input(),
            ws.clone(),
            bind!(hex_color.clone(), hex_color_val),
            ws.clone(),
            end_of_input(),
        ) => Parsed::main {
            hex_color_val: Box::new(hex_color_val),
        }
    );

    main.clone()
}

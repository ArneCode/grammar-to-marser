use marser::capture;
use marser::matcher::{
    AnyToken,
    Matcher,
    many,
    negative_lookahead,
    one_or_more,
    optional,
    start_of_input,
    end_of_input,
};
use marser::one_of::one_of;
use marser::parser::{
    Parser,
};

// Inserts whitespace between repetitions, but not before the first item.
// This keeps `X*` equivalent to the source grammar while avoiding duplicated
// generated matcher bodies.
fn repeat_ws<'src, MRes, Item, Ws>(
    item: Item,
    ws: Ws,
) -> impl Matcher<'src, &'src str, MRes> + Clone
where
    Item: Matcher<'src, &'src str, MRes> + Clone,
    Ws: Matcher<'src, &'src str, MRes> + Clone,
{
    optional((item.clone(), many((ws, item))))
}

// Typed parse tree returned by `grammar()`. Each grammar rule becomes a variant;
// labeled bindings become struct fields, and leaf rules store their matched slice
// as `value`.
#[derive(Debug, Clone, PartialEq)]
pub enum Parsed<'src> {
    main {
        item_val: Vec<Box<Parsed<'src>>>,
    },
    item {
        name: Box<Parsed<'src>>,
        value: Box<Parsed<'src>>,
    },
    ident { value: &'src str },
    number { value: &'src str },
}

// Returns a complete parser for this grammar.
// Usage: grammar().parse_str(src)  →  Ok((Parsed, errors))
pub fn grammar<'src>() -> impl Parser<'src, &'src str, Output = Parsed<'src>> + Clone {
    let ASCII_ALPHA = one_of(('a'..='z', 'A'..='Z'));

    let ASCII_ALPHANUMERIC = one_of(('a'..='z', 'A'..='Z', '0'..='9'));

    let ASCII_DIGIT = '0'..='9';

    // number = @{ ASCII_DIGIT+ }
    let number = capture!(
        bind_slice!(one_or_more(ASCII_DIGIT.clone()), value as &'src str) => Parsed::number { value }
    );

    // ident = @{ ("_" | ASCII_ALPHA) ~ ("_" | ASCII_ALPHANUMERIC)* }
    let ident = capture!(
        bind_slice!(
            (
                one_of(('_', ASCII_ALPHA.clone())),
                many(one_of(('_', ASCII_ALPHANUMERIC.clone()))),
            ),
            value as &'src str
        ) => Parsed::ident { value }
    );

    // newline = _{ "\n" | "\r\n" }
    let newline = one_of(('\n', "\r\n"));

    // WHITESPACE = _{ " " | "\t" | newline }
    let WHITESPACE = one_of((' ', '\t', newline.clone()));

    // line_comment = _{ "//" ~ (!newline ~ ANY)* }
    let line_comment = ("//", many((negative_lookahead(newline.clone()), AnyToken)));

    // COMMENT = _{ line_comment }
    let COMMENT = line_comment.clone();

    // Pest injects WHITESPACE (and COMMENT) between every `~` in non-atomic rules.
    // ws.clone() appears between sequence elements throughout this file for that reason.
    let ws = many(
        one_of((WHITESPACE.clone(), COMMENT.clone()))
    );

    // item = { #name = ident ~ "=" ~ #value = number }
    let item = capture!(
        (
            bind!(ident.clone(), name),
            ws.clone(),
            '=',
            ws.clone(),
            bind!(number.clone(), value),
        ) => Parsed::item {
            name: Box::new(name),
            value: Box::new(value),
        }
    );

    // main = { SOI ~ item ~ ("," ~ item)* ~ EOI }
    let main = capture!(
        (
            start_of_input(),
            ws.clone(),
            bind!(item.clone(), *item_val),
            ws.clone(),
            repeat_ws(
                (',', ws.clone(), bind!(item.clone(), *item_val)),
                ws.clone(),
            ),
            ws.clone(),
            end_of_input(),
        ) => Parsed::main {
            item_val: item_val.into_iter().map(Box::new).collect(),
        }
    );

    main.clone()
}

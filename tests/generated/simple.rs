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
    ParserCombinator,
};

// Pest inserts implicit whitespace between repetitions, but not before the
// first item. This keeps `X*` equivalent to Pest while avoiding duplicated
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

pub fn grammar<'src>() -> impl Parser<'src, &'src str, Output = ()> + Clone {
    let ASCII_ALPHA = one_of(('a'..='z', 'A'..='Z'));

    let ASCII_ALPHANUMERIC = one_of(('a'..='z', 'A'..='Z', '0'..='9'));

    let ASCII_DIGIT = '0'..='9';

    // number = @{ ASCII_DIGIT+ }
    let number = capture!(
        one_or_more(ASCII_DIGIT.clone()) => ()
    ).erase_types();

    // ident = @{ ("_" | ASCII_ALPHA) ~ ("_" | ASCII_ALPHANUMERIC)* }
    let ident = capture!(
        (
            one_of(('_', ASCII_ALPHA.clone())),
            many(one_of(('_', ASCII_ALPHANUMERIC.clone()))),
        ) => ()
    ).erase_types();

    // newline = _{ "\n" | "\r\n" }
    let newline = capture!(
        one_of(('\n', "\r\n")) => ()
    ).erase_types();

    // WHITESPACE = _{ " " | "\t" | newline }
    let WHITESPACE = capture!(
        one_of((' ', '\t', bind!(newline.clone(), ?newline_val))) => ()
    ).erase_types();

    // line_comment = _{ "//" ~ (!newline ~ ANY)* }
    let line_comment = capture!(
        ("//", many((negative_lookahead(newline.clone().ignore_result()), AnyToken))) => ()
    ).erase_types();

    // COMMENT = _{ line_comment }
    let COMMENT = capture!(
        bind!(line_comment.clone(), line_comment_val) => ()
    ).erase_types();

    let ws = many(
        one_of((WHITESPACE.clone().ignore_result(), COMMENT.clone().ignore_result()))
    );

    // item = { ident ~ "=" ~ number }
    let item = capture!(
        (bind!(ident.clone(), ident_val), ws.clone(), '=', ws.clone(), bind!(number.clone(), number_val)) => ()
    ).erase_types();

    // main = { SOI ~ item ~ ("," ~ item)* ~ EOI }
    let main = capture!(
        (
            start_of_input(),
            ws.clone(),
            bind!(item.clone(), *item_val),
            ws.clone(),
            repeat_ws((',', ws.clone(), bind!(item.clone(), *item_val)), ws.clone()),
            ws.clone(),
            end_of_input(),
        ) => ()
    ).erase_types();

    main.clone()
}

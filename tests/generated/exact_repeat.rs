use marser::capture;
use marser::matcher::{
    Matcher,
    many,
    repeat,
    optional,
    start_of_input,
    end_of_input,
};
use marser::parser::{
    Parser,
    ParserCombinator,
};

#[derive(Debug, Clone, PartialEq)]
pub enum Parsed<'src> {
    WHITESPACE { value: &'src str },
    main { value: &'src str },
}

pub fn grammar<'src>() -> impl Parser<'src, &'src str, Output = Parsed<'src>> + Clone {
    // WHITESPACE = _{ " " }
    let WHITESPACE = capture!(
bind_slice!(
            ' ',
        value as &'src str
    ) => Parsed::WHITESPACE { value }
    );

    let ws = many(
        WHITESPACE.clone().ignore_result()
    );

    // main = { SOI ~ "a"{3} ~ EOI }
    let main = capture!(
bind_slice!(
            (
                start_of_input(),
                ws.clone(),
                ('a', repeat((ws.clone(), 'a'), 2..=2)),
                ws.clone(),
                end_of_input(),
            ),
        value as &'src str
    ) => Parsed::main { value }
    );

    main.clone()
}

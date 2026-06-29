use marser::capture;
use marser::matcher::{
    Matcher,
    many,
    one_or_more,
    start_of_input,
    end_of_input,
};
use marser::one_of::one_of;
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
        word: Box<Parsed<'src>>,
    },
    word {
        letter_val: Vec<Box<Parsed<'src>>>,
    },
    letter { value: &'src str },
}

pub fn grammar<'src>() -> impl Parser<'src, &'src str, Output = Parsed<'src>> + Clone {
    let ASCII_ALPHA = one_of(('a'..='z', 'A'..='Z'));

    // letter = { ASCII_ALPHA }
    let letter = capture!(
        bind_slice!(ASCII_ALPHA.clone(), value as &'src str) => Parsed::letter { value }
    );

    // word = ${ letter+ }
    let word = capture!(
        one_or_more(bind!(letter.clone(), *letter_val)) => Parsed::word {
            letter_val: letter_val.into_iter().map(Box::new).collect(),
        }
    );

    // WHITESPACE = _{ " " }
    let WHITESPACE = ' ';

    let ws = many(
        WHITESPACE.clone()
    );

    // main = { SOI ~ #word = word ~ EOI }
    let main = capture!(
        (
            start_of_input(),
            ws.clone(),
            bind!(word.clone(), word_val),
            ws.clone(),
            end_of_input(),
        ) => Parsed::main {
            word: Box::new(word_val),
        }
    );

    main.clone()
}

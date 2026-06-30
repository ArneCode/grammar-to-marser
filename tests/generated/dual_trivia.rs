use marser::capture;
use marser::matcher::{
    many,
    one_or_more,
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
    pair {
        word_val: Vec<Box<Parsed<'src>>>,
    },
    word { value: &'src str },
    main {
        pair_val: Box<Parsed<'src>>,
    },
}

pub fn grammar<'src>() -> impl Parser<'src, &'src str, Output = Parsed<'src>> + Clone {
    let ASCII_ALPHA = one_of(('a'..='z', 'A'..='Z'));

    // word = @{ ASCII_ALPHA+ }
    let word = capture!(
        bind_slice!(one_or_more(ASCII_ALPHA.clone()), value as &'src str) => Parsed::word { value }
    );

    // tab = _{ "\t" }
    let tab = '\t';

    // pair = @{ word ~ tab ~ word }
    let pair = capture!(
        (
            bind!(word.clone(), *word_val),
            tab.clone(),
            bind!(word.clone(), *word_val),
        ) => Parsed::pair {
            word_val: word_val.into_iter().map(Box::new).collect(),
        }
    );

    // WHITESPACE = _{ " " | tab }
    let WHITESPACE = one_of((' ', tab.clone()));

    let ws = many(
        WHITESPACE.clone()
    );

    // main = { SOI ~ pair ~ EOI }
    let main = capture!(
        (
            start_of_input(),
            ws.clone(),
            bind!(pair.clone(), pair_val),
            ws.clone(),
            end_of_input(),
        ) => Parsed::main {
            pair_val: Box::new(pair_val),
        }
    );

    main.clone()
}

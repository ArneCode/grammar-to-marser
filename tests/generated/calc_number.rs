use marser::capture;
use marser::matcher::{
    one_or_more,
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
    expr {
        term_val: Vec<Box<Parsed<'src>>>,
        op: Vec<&'src str>,
    },
    term {
        factor_val: Vec<Box<Parsed<'src>>>,
        op: Vec<&'src str>,
    },
    factor {
        inner: Box<Parsed<'src>>,
    },
    number { value: &'src str },
}

pub fn grammar<'src>() -> impl Parser<'src, &'src str, Output = Parsed<'src>> + Clone {
    let ASCII_DIGIT = '0'..='9';

    // number = @{ ASCII_DIGIT+ }
    let number = capture!(
        bind_slice!(one_or_more(ASCII_DIGIT.clone()), value as &'src str) => Parsed::number { value }
    );

    number.clone()
}

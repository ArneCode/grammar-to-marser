use crate::ast::Grammar;
use crate::codegen::{CodegenOptions, generate_rust, prepare_codegen};
use crate::error::{parse_error_from_furthest_fail, parse_error_from_parser_error, ConvertError, ConvertResult};
use crate::grammar::get_pest_grammar;
use crate::normalize::{RuleDef, RuleTable, build_rule_table};
use crate::validate::validate_all;
use marser::error::ParserError;
use marser::parser::Parser;

pub struct ConvertOptions {
    pub entry_rule: String,
    pub function_name: String,
    pub emit_comments: bool,
}

impl Default for ConvertOptions {
    fn default() -> Self {
        Self {
            entry_rule: String::new(),
            function_name: "grammar".to_string(),
            emit_comments: true,
        }
    }
}

fn resolve_entry_rule(rules: &[RuleDef], entry_rule: &str) -> ConvertResult<String> {
    if !entry_rule.is_empty() {
        return Ok(entry_rule.to_string());
    }

    rules
        .last()
        .map(|rule| rule.name.clone())
        .ok_or_else(|| {
            vec![ConvertError::UnknownEntryRule {
                name: "(no rules defined)".to_string(),
            }]
        })
}

pub fn convert_pest_source(source: &str, options: &ConvertOptions) -> ConvertResult<String> {
    let (grammar, parse_errors) = get_pest_grammar().parse_str(source).map_err(|err| {
        vec![parse_error_from_furthest_fail(source, err)]
    })?;

    let mut errors: Vec<ConvertError> = parse_errors
        .iter()
        .map(|e: &ParserError| parse_error_from_parser_error(source, e))
        .collect();
    if !errors.is_empty() {
        return Err(errors);
    }

    let table = build_rule_table(&grammar)?;
    convert_with_table(&table, options, Some(source))
}

fn convert_with_table(
    table: &RuleTable,
    options: &ConvertOptions,
    source: Option<&str>,
) -> ConvertResult<String> {
    let entry_rule = resolve_entry_rule(&table.rules, &options.entry_rule)?;
    validate_all(&table.rules, &entry_rule)?;

    let (graph, sccs) = match prepare_codegen(table, &entry_rule) {
        Ok(v) => v,
        Err(err) => return Err(vec![err]),
    };

    generate_rust(
        table,
        &graph,
        &sccs,
        &CodegenOptions {
            function_name: options.function_name.clone(),
            source: source.map(str::to_string),
            emit_comments: options.emit_comments,
        },
    )
    .map_err(|e| vec![e])
}

pub fn list_pest_rules(source: &str) -> ConvertResult<Vec<String>> {
    let (grammar, parse_errors) = get_pest_grammar().parse_str(source).map_err(|err| {
        vec![parse_error_from_furthest_fail(source, err)]
    })?;

    let errors: Vec<ConvertError> = parse_errors
        .iter()
        .map(|e: &ParserError| parse_error_from_parser_error(source, e))
        .collect();
    if !errors.is_empty() {
        return Err(errors);
    }

    let table = build_rule_table(&grammar)?;
    Ok(table.rules.iter().map(|r| r.name.clone()).collect())
}

pub fn convert_pest_grammar(grammar: &Grammar, options: &ConvertOptions) -> ConvertResult<String> {
    let table = build_rule_table(grammar)?;
    convert_with_table(&table, options, None)
}

pub fn convert_with_warnings(
    grammar: &Grammar,
    options: &ConvertOptions,
) -> ConvertResult<(String, Vec<String>)> {
    let table = build_rule_table(grammar)?;
    let entry_rule = resolve_entry_rule(&table.rules, &options.entry_rule)?;
    validate_all(&table.rules, &entry_rule)?;
    let (graph, sccs) = match prepare_codegen(&table, &entry_rule) {
        Ok(v) => v,
        Err(err) => return Err(vec![err]),
    };
    let warnings = graph.warnings.clone();
    let code = generate_rust(
        &table,
        &graph,
        &sccs,
        &CodegenOptions {
            function_name: options.function_name.clone(),
            source: None,
            emit_comments: options.emit_comments,
        },
    )
    .map_err(|e| vec![e])?;
    Ok((code, warnings))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::grammar::get_pest_grammar;

    #[test]
    fn converts_simple_literal_rule() {
        let src = r#"main = { "hello" }"#;
        let grammar = get_pest_grammar().parse_str(src).unwrap().0;
        let code = convert_pest_grammar(
            &grammar,
            &ConvertOptions {
                entry_rule: "main".to_string(),
                function_name: "grammar".to_string(),
                ..Default::default()
            },
        )
        .unwrap();
        assert!(code.contains("pub fn grammar"));
        assert!(code.contains("\"hello\""));
    }

    #[test]
    fn defaults_to_last_rule_when_entry_is_empty() {
        let src = r#"
WHITESPACE = _{ " " }
main = { "hello" }
other = { "world" }
"#;
        let grammar = get_pest_grammar().parse_str(src).unwrap().0;
        let code = convert_pest_grammar(
            &grammar,
            &ConvertOptions {
                entry_rule: String::new(),
                function_name: "grammar".to_string(),
                ..Default::default()
            },
        )
        .unwrap();
        assert!(code.contains("\"world\""));
        assert!(!code.contains("\"hello\""));
    }

    #[test]
    fn emit_comments_false_omits_helper_comments() {
        let src = include_str!("../tests/fixtures/simple.pest");
        let code = convert_pest_source(
            src,
            &ConvertOptions {
                entry_rule: "main".to_string(),
                emit_comments: false,
                ..Default::default()
            },
        )
        .unwrap();
        assert!(code.contains("fn repeat_ws"));
        assert!(!code.contains("// Pest inserts implicit whitespace"));
    }
}

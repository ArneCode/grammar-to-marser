//! Generate minimal example input from a normalized grammar IR.
//!
//! Strategy for "good" samples:
//! - Prefer the shortest input that still satisfies structural constraints (min repeats, first choice).
//! - Mirror Pest whitespace injection between sequence elements in non-atomic rules.
//! - Skip `SOI`/`EOI` and other zero-width builtins.
//! - Use one whitespace separator when implicit `WHITESPACE` is injected.
//! - Break rule cycles by preferring a non-recursive choice alternative when revisiting a rule.
//! - For repetitions, use the minimum count required by bounds (`?` and `*` produce zero repeats).
//! - Prefix lookaheads (`&` / `!`) are not synthesized; generation returns `None` instead.

use std::collections::{HashMap, HashSet};

use crate::ast::{Modifier, PostfixOp};
use crate::error::ConvertResult;
use crate::expr::{Builtin, Expr, MatchingContext};
use crate::grammar::parse_pest_grammar;
use crate::normalize::{RuleDef, RuleTable};
use crate::peg::parse_peg_grammar;
use crate::specialize::callee_context;
use crate::syntax::InputSyntax;
use crate::validate::forced_context;
use marser::parser::Parser;

struct SampleGen<'a> {
    table: &'a RuleTable,
    rules: &'a HashMap<String, RuleDef>,
    max_depth: usize,
    depth: usize,
    stack: HashSet<String>,
}

pub fn suggest_sample_from_table(table: &RuleTable, entry_rule: &str) -> Option<String> {
    let rules: HashMap<_, _> = table
        .rules
        .iter()
        .map(|rule| (rule.name.clone(), rule.clone()))
        .collect();
    let entry = rules.get(entry_rule)?;
    if expr_contains_lookahead(&entry.expr) {
        return None;
    }
    let context =
        forced_context(entry.modifier.as_ref()).unwrap_or(MatchingContext::NormalWs);
    let mut generator = SampleGen {
        table,
        rules: &rules,
        max_depth: 48,
        depth: 0,
        stack: HashSet::new(),
    };
    // Preserve trailing whitespace/newlines: some grammars require them (e.g. NEWLINE at EOI).
    // Consumers that want presentation-friendly output can trim at the UI boundary.
    generator.generate_expr(&entry.expr, context)
}

pub fn suggest_sample_source(
    source: &str,
    syntax: InputSyntax,
    entry_rule: &str,
) -> ConvertResult<Option<String>> {
    let grammar = match syntax {
        InputSyntax::Pest => parse_pest_grammar().parse_str(source).map_err(|err| {
            vec![crate::error::parse_error_from_furthest_fail(source, err)]
        })?,
        InputSyntax::Peg => parse_peg_grammar().parse_str(source).map_err(|err| {
            vec![crate::error::parse_error_from_furthest_fail(source, err)]
        })?,
    }
    .0;
    let table = crate::normalize::build_rule_table(&grammar, syntax)?;
    let entry = resolve_entry_rule(&table, entry_rule)?;
    Ok(suggest_sample_from_table(&table, &entry))
}

fn resolve_entry_rule(table: &RuleTable, entry_rule: &str) -> ConvertResult<String> {
    if !entry_rule.trim().is_empty() {
        return Ok(entry_rule.to_string());
    }
    table
        .rules
        .iter()
        .rev()
        .find(|rule| {
            rule.name != "WHITESPACE"
                && rule.name != "COMMENT"
                && rule.modifier != Some(Modifier::Silent)
        })
        .map(|rule| rule.name.clone())
        .ok_or_else(|| {
            vec![crate::error::ConvertError::UnknownEntryRule {
                name: "(no rules defined)".to_string(),
            }]
        })
}

impl<'a> SampleGen<'a> {
    fn generate_expr(&mut self, expr: &Expr, context: MatchingContext) -> Option<String> {
        if self.depth > self.max_depth {
            return None;
        }
        self.depth += 1;
        let out = self.generate_expr_inner(expr, context);
        self.depth -= 1;
        out
    }

    fn generate_expr_inner(&mut self, expr: &Expr, context: MatchingContext) -> Option<String> {
        match expr {
            Expr::Empty => Some(String::new()),
            Expr::Builtin(builtin) => self.generate_builtin(*builtin),
            Expr::Literal(text) => Some(text.clone()),
            Expr::InsensitiveLiteral(text) => Some(text.to_ascii_lowercase()),
            Expr::Range { start, .. } => Some(start.to_string()),
            Expr::RuleRef(name) => self.generate_rule(name, context),
            Expr::Sequence(items) => self.generate_sequence(items, context),
            Expr::Choice(items) => self.generate_choice(items, context),
            Expr::Prefix { .. } => None,
            Expr::Postfix { expr, op } => self.generate_postfix(expr, op, context),
            Expr::Tagged { expr, .. } => self.generate_expr(expr, context),
        }
    }

    fn generate_builtin(&self, builtin: Builtin) -> Option<String> {
        let ch = match builtin {
            Builtin::Soi | Builtin::Eoi => return Some(String::new()),
            Builtin::Any => 'x',
            Builtin::Newline => '\n',
            Builtin::AsciiDigit => '1',
            Builtin::AsciiNonzeroDigit => '1',
            Builtin::AsciiBinDigit => '0',
            Builtin::AsciiOctDigit => '0',
            Builtin::AsciiHexDigit => '0',
            Builtin::AsciiAlphaLower => 'a',
            Builtin::AsciiAlphaUpper => 'A',
            Builtin::AsciiAlpha => 'a',
            Builtin::AsciiAlphanumeric => 'a',
        };
        Some(ch.to_string())
    }

    fn generate_rule(&mut self, name: &str, context: MatchingContext) -> Option<String> {
        let rule = self.rules.get(name)?;
        if rule.modifier == Some(Modifier::NonAtomic) {
            return None;
        }
        let rule_context = callee_context(context, rule.modifier.as_ref());
        if self.stack.contains(name) {
            return self.generate_cycle_fallback(name, rule_context);
        }
        self.stack.insert(name.to_string());
        let sample = self.generate_expr(&rule.expr, rule_context);
        self.stack.remove(name);
        sample
    }

    fn generate_cycle_fallback(
        &mut self,
        name: &str,
        context: MatchingContext,
    ) -> Option<String> {
        let rule = self.rules.get(name)?;
        if let Expr::Choice(items) = &rule.expr {
            for item in items {
                if !item.rule_refs().contains(&name) {
                    if let Some(sample) = self.generate_expr(item, context) {
                        return Some(sample);
                    }
                }
            }
        }
        None
    }

    fn generate_sequence(&mut self, items: &[Expr], context: MatchingContext) -> Option<String> {
        let inject_ws = context == MatchingContext::NormalWs && self.table.has_whitespace;
        let mut out = String::new();
        let mut prepend_ws = false;
        for item in items {
            let mut emitted_ws = false;
            if inject_ws && prepend_ws && !is_zero_width(item) && !is_zero_repeat(item) {
                out.push_str(&self.whitespace_separator()?);
                prepend_ws = false;
                emitted_ws = true;
            }
            let part = self.generate_expr(item, context)?;
            if inject_ws {
                if !part.is_empty() {
                    prepend_ws = true;
                } else if is_zero_repeat(item) && !emitted_ws {
                    prepend_ws = true;
                }
            }
            out.push_str(&part);
        }
        Some(out)
    }

    fn generate_choice(&mut self, items: &[Expr], context: MatchingContext) -> Option<String> {
        for item in items {
            if matches!(item, Expr::Literal(text) if text == "_" && items.len() > 1) {
                continue;
            }
            if let Some(sample) = self.generate_expr(item, context) {
                return Some(sample);
            }
        }
        None
    }

    fn generate_postfix(
        &mut self,
        expr: &Expr,
        op: &PostfixOp,
        context: MatchingContext,
    ) -> Option<String> {
        let count = repeat_count(op);
        let mut out = String::new();
        for _ in 0..count {
            out.push_str(&self.generate_expr(expr, context)?);
        }
        Some(out)
    }

    fn whitespace_separator(&mut self) -> Option<String> {
        if !self.table.has_whitespace {
            return Some(String::new());
        }
        if let Some(rule) = self.rules.get("WHITESPACE") {
            return self.generate_expr(&rule.expr, MatchingContext::AtomicNoWs);
        }
        Some(" ".to_string())
    }
}

fn repeat_count(op: &PostfixOp) -> usize {
    match op {
        PostfixOp::Optional | PostfixOp::Repeat => 0,
        PostfixOp::RepeatOnce => 1,
        PostfixOp::RepeatExact(count) => *count as usize,
        PostfixOp::RepeatMin(count) => *count as usize,
        PostfixOp::RepeatMax(count) => usize::from(*count > 0),
        PostfixOp::RepeatMinMax(min, _) => *min as usize,
    }
}

fn is_zero_repeat(expr: &Expr) -> bool {
    match expr {
        Expr::Postfix { op, .. } => repeat_count(op) == 0,
        Expr::Tagged { expr, .. } => is_zero_repeat(expr),
        _ => false,
    }
}

fn is_zero_width(expr: &Expr) -> bool {
    match expr {
        Expr::Empty => true,
        Expr::Builtin(Builtin::Soi | Builtin::Eoi) => true,
        Expr::Tagged { expr, .. } => is_zero_width(expr),
        _ => false,
    }
}

fn expr_contains_lookahead(expr: &Expr) -> bool {
    match expr {
        Expr::Prefix { .. } => true,
        Expr::Sequence(items) | Expr::Choice(items) => {
            items.iter().any(expr_contains_lookahead)
        }
        Expr::Postfix { expr, .. } | Expr::Tagged { expr, .. } => expr_contains_lookahead(expr),
        Expr::RuleRef(_) => false,
        Expr::Empty
        | Expr::Builtin(_)
        | Expr::Literal(_)
        | Expr::InsensitiveLiteral(_)
        | Expr::Range { .. } => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::normalize::build_rule_table;
    use std::fs;
    use std::path::Path;

    fn sample_for_pest(path: &str, entry: &str) -> Option<String> {
        let src =
            fs::read_to_string(Path::new(env!("CARGO_MANIFEST_DIR")).join(path)).ok()?;
        let grammar = parse_pest_grammar().parse_str(&src).ok()?.0;
        let table = build_rule_table(&grammar, InputSyntax::Pest).ok()?;
        suggest_sample_from_table(&table, entry)
    }

    fn assert_generated_accepts(stem: &str, sample: &str) {
        let path = Path::new(env!("CARGO_MANIFEST_DIR")).join(format!("tests/generated/{stem}.rs"));
        let src = fs::read_to_string(path).expect("read generated parser");
        let temp = tempfile::tempdir().expect("tempdir");
        let project = temp.path();
        std::fs::create_dir_all(project.join("src")).expect("src");
        std::fs::write(project.join("src/lib.rs"), "pub mod grammar;\n").expect("lib");
        std::fs::write(project.join("src/grammar.rs"), src).expect("grammar");
        std::fs::write(
            project.join("Cargo.toml"),
            r#"[package]
name = "sample-check"
version = "0.1.0"
edition = "2024"

[dependencies]
marser = "0.2.2"
"#,
        )
        .expect("cargo");
        let main = format!(
            r#"use marser::parser::Parser;
use sample_check::grammar;

fn main() {{
    let input = std::env::args().nth(1).expect("input");
    grammar::grammar().parse_str(&input).expect("parse");
}}
"#
        );
        std::fs::write(project.join("src/main.rs"), main).expect("main");
        let target_dir = project.join("target");
        let status = std::process::Command::new("cargo")
            .env("CARGO_TARGET_DIR", &target_dir)
            .args(["run", "--quiet", "--", sample])
            .current_dir(project)
            .status()
            .expect("cargo run");
        assert!(status.success(), "sample {sample:?} failed for {stem}");
    }

    #[test]
    fn calc_sample_is_minimal_and_parses() {
        let sample = sample_for_pest("tests/fixtures/calc.pest", "expr").expect("sample");
        assert_eq!(sample, "1");
        assert_generated_accepts("calc", &sample);
    }

    #[test]
    fn simple_sample_parses() {
        let sample = sample_for_pest("tests/fixtures/simple.pest", "main").expect("sample");
        assert!(sample.contains('='), "sample={sample:?}");
        assert_generated_accepts("simple", &sample);
    }

    #[test]
    fn bounded_repeat_sample_matches_minimum() {
        let sample =
            sample_for_pest("tests/fixtures/bounded_repeat.pest", "main").expect("sample");
        assert_eq!(sample, "aa");
        assert_generated_accepts("bounded_repeat", &sample);
    }

    #[test]
    fn lookahead_grammar_returns_no_sample() {
        assert!(sample_for_pest("tests/fixtures/lookahead.pest", "main").is_none());
    }

    #[test]
    fn non_atomic_grammar_returns_no_sample() {
        assert!(sample_for_pest("tests/fixtures/non_atomic.pest", "main").is_none());
    }

    #[test]
    fn suggest_sample_source_resolves_default_entry_rule() {
        let src = include_str!("../tests/fixtures/calc.pest");
        let sample = suggest_sample_source(src, InputSyntax::Pest, "")
            .expect("ok")
            .expect("sample");
        assert_eq!(sample, "1");
    }

    #[test]
    fn suggest_sample_source_honors_explicit_entry_rule() {
        let src = include_str!("../tests/fixtures/calc.pest");
        let sample = suggest_sample_source(src, InputSyntax::Pest, "number")
            .expect("ok")
            .expect("sample");
        assert_eq!(sample, "1");
    }
}

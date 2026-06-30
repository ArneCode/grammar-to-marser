use std::collections::HashSet;

use crate::ast::{PostfixOp, PrefixOp};
use crate::expr::{Builtin, Expr, MatchingContext, SymKey};
use crate::normalize::RuleTable;
use crate::specialize::{SpecializationGraph, collect_rule_deps};

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) struct ImportNeeds {
    pub any_token: bool,
    pub matcher: bool,
    pub many: bool,
    pub negative_lookahead: bool,
    pub one_or_more: bool,
    pub optional: bool,
    pub positive_lookahead: bool,
    pub repeat: bool,
    pub start_of_input: bool,
    pub end_of_input: bool,
    pub one_of: bool,
    pub recursive: bool,
}

fn builtin_uses_one_of(b: Builtin) -> bool {
    matches!(
        b,
        Builtin::Newline
            | Builtin::AsciiBinDigit
            | Builtin::AsciiHexDigit
            | Builtin::AsciiAlpha
            | Builtin::AsciiAlphanumeric
    )
}

fn collect_builtin_import_needs(b: Builtin, out: &mut ImportNeeds) {
    match b {
        Builtin::Any => out.any_token = true,
        Builtin::Soi => out.start_of_input = true,
        Builtin::Eoi => out.end_of_input = true,
        b if builtin_uses_one_of(b) => out.one_of = true,
        _ => {}
    }
}

fn uses_ws_context(table: &RuleTable, ctx: MatchingContext) -> bool {
    (table.has_whitespace || table.has_comment) && ctx == MatchingContext::NormalWs
}

pub(crate) fn collect_bounded_repeat_import_needs(
    min: u32,
    max: Option<u32>,
    uses_ws: bool,
    out: &mut ImportNeeds,
) {
    if uses_ws {
        if min == 0 {
            let Some(max) = max else {
                return;
            };
            if max == 0 {
                return;
            }
            if max == 1 {
                out.optional = true;
                return;
            }
            out.optional = true;
            out.repeat = true;
            return;
        }
        out.repeat = true;
        return;
    }
    out.repeat = true;
}

fn collect_postfix_import_needs(
    inner: &Expr,
    op: &PostfixOp,
    ctx: MatchingContext,
    table: &RuleTable,
    out: &mut ImportNeeds,
    in_lookahead: bool,
) {
    collect_import_needs_expr(inner, ctx, table, out, in_lookahead);
    let uses_ws = uses_ws_context(table, ctx);
    match op {
        PostfixOp::Optional => out.optional = true,
        PostfixOp::Repeat | PostfixOp::RepeatMin(0) => {
            if !uses_ws {
                out.many = true;
            }
        }
        PostfixOp::RepeatOnce => {
            if !uses_ws {
                out.one_or_more = true;
            }
        }
        PostfixOp::RepeatExact(n) => {
            collect_bounded_repeat_import_needs(*n, Some(*n), uses_ws, out)
        }
        PostfixOp::RepeatMin(n) => collect_bounded_repeat_import_needs(*n, None, uses_ws, out),
        PostfixOp::RepeatMax(n) => collect_bounded_repeat_import_needs(0, Some(*n), uses_ws, out),
        PostfixOp::RepeatMinMax(min, max) if *min == 0 => {
            collect_bounded_repeat_import_needs(0, Some(*max), uses_ws, out);
        }
        PostfixOp::RepeatMinMax(min, max) => {
            collect_bounded_repeat_import_needs(*min, Some(*max), uses_ws, out);
        }
    }
}

fn collect_import_needs_expr(
    expr: &Expr,
    ctx: MatchingContext,
    table: &RuleTable,
    out: &mut ImportNeeds,
    in_lookahead: bool,
) {
    match expr {
        Expr::Empty => {}
        Expr::Builtin(b) => collect_builtin_import_needs(*b, out),
        Expr::Literal(_) | Expr::Range { .. } => {}
        Expr::InsensitiveLiteral(_) => {}
        Expr::RuleRef(name) => {
            if let Some(builtin) = Builtin::from_name(name) {
                collect_builtin_import_needs(builtin, out);
            }
        }
        Expr::Sequence(items) | Expr::Choice(items) => {
            if matches!(expr, Expr::Choice(_)) {
                out.one_of = true;
            }
            for item in items {
                collect_import_needs_expr(item, ctx, table, out, in_lookahead);
            }
        }
        Expr::Prefix { op, expr } => {
            let in_la = matches!(
                op,
                PrefixOp::PositivePredicate | PrefixOp::NegativePredicate
            );
            match op {
                PrefixOp::PositivePredicate => out.positive_lookahead = true,
                PrefixOp::NegativePredicate => out.negative_lookahead = true,
            }
            collect_import_needs_expr(expr, ctx, table, out, in_lookahead || in_la);
        }
        Expr::Postfix { expr, op } => {
            collect_postfix_import_needs(expr, op, ctx, table, out, in_lookahead);
        }
        Expr::Tagged { expr, .. } => {
            collect_import_needs_expr(expr, ctx, table, out, in_lookahead);
        }
    }
}

fn collect_ws_rule_import_needs(
    table: &RuleTable,
    graph: &SpecializationGraph,
    needs: &mut ImportNeeds,
) {
    let needs_implicit_ws = graph
        .nodes
        .iter()
        .any(|sym| sym.context == MatchingContext::NormalWs);
    if !needs_implicit_ws {
        return;
    }

    let mut stack = Vec::new();
    if table.has_whitespace {
        stack.push(SymKey {
            rule: "WHITESPACE".to_string(),
            context: MatchingContext::AtomicNoWs,
        });
    }
    if table.has_comment {
        stack.push(SymKey {
            rule: "COMMENT".to_string(),
            context: MatchingContext::AtomicNoWs,
        });
    }

    let mut visited = HashSet::new();
    while let Some(sym) = stack.pop() {
        if !visited.insert(sym.clone()) {
            continue;
        }
        let Some(rule) = graph.rule_map.get(&sym.rule) else {
            continue;
        };
        collect_import_needs_expr(&rule.expr, sym.context, table, needs, false);
        let mut deps = HashSet::new();
        collect_rule_deps(&rule.expr, sym.context, &graph.rule_map, &mut deps);
        for dep in deps {
            stack.push(dep);
        }
    }

    if table.has_whitespace || table.has_comment {
        needs.many = true;
        if table.has_whitespace && table.has_comment {
            needs.one_of = true;
        }
    }
}

pub(crate) fn compute_import_needs(
    table: &RuleTable,
    graph: &SpecializationGraph,
    cyclic_syms: &HashSet<SymKey>,
    referenced_builtins: &HashSet<Builtin>,
    needs_ws_repeat_helper: bool,
    needs_ws_repeat_once_helper: bool,
    needs_ci_ch_helper: bool,
    needs_bounded_repeat: bool,
) -> ImportNeeds {
    let mut needs = ImportNeeds::default();
    for sym in &graph.nodes {
        if let Some(rule) = graph.rule_map.get(&sym.rule) {
            collect_import_needs_expr(&rule.expr, sym.context, table, &mut needs, false);
        }
    }
    collect_ws_rule_import_needs(table, graph, &mut needs);
    if needs_ws_repeat_helper {
        needs.matcher = true;
        needs.optional = true;
        needs.many = true;
    }
    if needs_ws_repeat_once_helper {
        needs.matcher = true;
        needs.many = true;
    }
    if needs_ci_ch_helper {
        needs.matcher = true;
        needs.one_of = true;
    }
    if needs_bounded_repeat {
        needs.repeat = true;
    }
    if !cyclic_syms.is_empty() {
        needs.recursive = true;
    }
    for builtin in referenced_builtins {
        collect_builtin_import_needs(*builtin, &mut needs);
    }
    needs
}

pub(crate) fn push_braced_use_list(out: &mut String, path: &str, items: &[&str]) {
    out.push_str("use ");
    out.push_str(path);
    out.push_str("{\n");
    for item in items {
        out.push_str("    ");
        out.push_str(item);
        out.push_str(",\n");
    }
    out.push_str("};\n");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exact_repeat_with_whitespace_does_not_need_optional() {
        let mut needs = ImportNeeds::default();
        collect_bounded_repeat_import_needs(6, Some(6), true, &mut needs);
        assert!(needs.repeat);
        assert!(!needs.optional);
    }

    #[test]
    fn zero_to_max_repeat_with_whitespace_needs_optional() {
        let mut needs = ImportNeeds::default();
        collect_bounded_repeat_import_needs(0, Some(3), true, &mut needs);
        assert!(needs.repeat);
        assert!(needs.optional);
    }
}

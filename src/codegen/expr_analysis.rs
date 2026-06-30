use std::collections::HashSet;

use crate::ast::PostfixOp;
use crate::expr::{Builtin, Expr};

pub(crate) fn collect_builtins(expr: &Expr, out: &mut HashSet<Builtin>) {
    match expr {
        Expr::Builtin(b) => {
            out.insert(*b);
        }
        Expr::Sequence(items) | Expr::Choice(items) => {
            for item in items {
                collect_builtins(item, out);
            }
        }
        Expr::Prefix { expr, .. } | Expr::Postfix { expr, .. } | Expr::Tagged { expr, .. } => {
            collect_builtins(expr, out);
        }
        Expr::RuleRef(name) => {
            if let Some(b) = Builtin::from_name(name) {
                out.insert(b);
            }
        }
        _ => {}
    }
}

pub(crate) fn should_hoist_builtin(b: Builtin) -> bool {
    !matches!(b, Builtin::Soi | Builtin::Eoi | Builtin::Any)
}

pub(crate) fn builtin_matcher_expr(b: Builtin) -> String {
    match b {
        Builtin::Soi => "start_of_input()".to_string(),
        Builtin::Eoi => "end_of_input()".to_string(),
        Builtin::Any => "AnyToken".to_string(),
        Builtin::Newline => "one_of((\"\\n\", \"\\r\\n\"))".to_string(),
        Builtin::AsciiDigit => "'0'..='9'".to_string(),
        Builtin::AsciiNonzeroDigit => "'1'..='9'".to_string(),
        Builtin::AsciiBinDigit => "one_of(('0', '1'))".to_string(),
        Builtin::AsciiOctDigit => "'0'..='7'".to_string(),
        Builtin::AsciiHexDigit => "one_of(('0'..='9', 'a'..='f', 'A'..='F'))".to_string(),
        Builtin::AsciiAlphaLower => "'a'..='z'".to_string(),
        Builtin::AsciiAlphaUpper => "'A'..='Z'".to_string(),
        Builtin::AsciiAlpha => "one_of(('a'..='z', 'A'..='Z'))".to_string(),
        Builtin::AsciiAlphanumeric => "one_of(('a'..='z', 'A'..='Z', '0'..='9'))".to_string(),
    }
}

pub(crate) fn expr_has_insensitive_literal(expr: &Expr) -> bool {
    match expr {
        Expr::InsensitiveLiteral(_) => true,
        Expr::Sequence(items) | Expr::Choice(items) => {
            items.iter().any(expr_has_insensitive_literal)
        }
        Expr::Prefix { expr, .. } | Expr::Postfix { expr, .. } | Expr::Tagged { expr, .. } => {
            expr_has_insensitive_literal(expr)
        }
        Expr::Empty
        | Expr::Builtin(_)
        | Expr::RuleRef(_)
        | Expr::Literal(_)
        | Expr::Range { .. } => false,
    }
}

pub(crate) fn expr_needs_bounded_repeat(expr: &Expr) -> bool {
    match expr {
        Expr::Postfix { expr, op } => {
            let bounded = match op {
                PostfixOp::RepeatExact(_)
                | PostfixOp::RepeatMax(_)
                | PostfixOp::RepeatMinMax(_, _) => true,
                PostfixOp::RepeatMin(n) => *n > 0,
                PostfixOp::Optional | PostfixOp::Repeat | PostfixOp::RepeatOnce => false,
            };
            bounded || expr_needs_bounded_repeat(expr)
        }
        Expr::Sequence(items) | Expr::Choice(items) => items.iter().any(expr_needs_bounded_repeat),
        Expr::Prefix { expr, .. } | Expr::Tagged { expr, .. } => expr_needs_bounded_repeat(expr),
        Expr::Empty
        | Expr::Builtin(_)
        | Expr::RuleRef(_)
        | Expr::Literal(_)
        | Expr::InsensitiveLiteral(_)
        | Expr::Range { .. } => false,
    }
}

pub(crate) fn expr_needs_ws_repeat_helper(expr: &Expr) -> bool {
    match expr {
        Expr::Postfix { expr, op } => {
            matches!(op, PostfixOp::Repeat | PostfixOp::RepeatMin(0))
                || expr_needs_ws_repeat_helper(expr)
        }
        Expr::Sequence(items) | Expr::Choice(items) => {
            items.iter().any(expr_needs_ws_repeat_helper)
        }
        Expr::Prefix { expr, .. } | Expr::Tagged { expr, .. } => expr_needs_ws_repeat_helper(expr),
        Expr::Empty
        | Expr::Builtin(_)
        | Expr::RuleRef(_)
        | Expr::Literal(_)
        | Expr::InsensitiveLiteral(_)
        | Expr::Range { .. } => false,
    }
}

pub(crate) fn expr_needs_ws_repeat_once_helper(expr: &Expr) -> bool {
    match expr {
        Expr::Postfix { expr, op } => {
            matches!(op, PostfixOp::RepeatOnce) || expr_needs_ws_repeat_once_helper(expr)
        }
        Expr::Sequence(items) | Expr::Choice(items) => {
            items.iter().any(expr_needs_ws_repeat_once_helper)
        }
        Expr::Prefix { expr, .. } | Expr::Tagged { expr, .. } => {
            expr_needs_ws_repeat_once_helper(expr)
        }
        Expr::Empty
        | Expr::Builtin(_)
        | Expr::RuleRef(_)
        | Expr::Literal(_)
        | Expr::InsensitiveLiteral(_)
        | Expr::Range { .. } => false,
    }
}

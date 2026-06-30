use std::collections::HashMap;

fn net_brace_delta(line: &str) -> i32 {
    let mut depth = 0i32;
    for ch in line.chars() {
        match ch {
            '{' => depth += 1,
            '}' => depth -= 1,
            _ => {}
        }
    }
    depth
}

fn is_rule_name_char(ch: char) -> bool {
    ch.is_ascii_alphanumeric() || ch == '_'
}

fn parse_rule_start(line: &str) -> Option<(String, i32)> {
    let trimmed = line.trim_start();
    if trimmed.starts_with("//") {
        return None;
    }
    let (name, rest) = if let Some(arrow_pos) = trimmed.find("<-") {
        let name = trimmed[..arrow_pos].trim();
        let rest = &trimmed[arrow_pos + 2..];
        (name, rest)
    } else {
        let eq_pos = trimmed.find('=')?;
        let name = trimmed[..eq_pos].trim();
        let rest = &trimmed[eq_pos + 1..];
        (name, rest)
    };
    if name.is_empty() || !name.chars().all(is_rule_name_char) {
        return None;
    }
    Some((name.to_string(), net_brace_delta(rest)))
}

pub fn extract_rule_source_comments(source: &str) -> HashMap<String, String> {
    let lines: Vec<&str> = source.lines().collect();
    let mut map = HashMap::new();
    let mut index = 0;
    while index < lines.len() {
        let line = lines[index];
        if let Some((name, mut brace_depth)) = parse_rule_start(line) {
            let mut rule_lines = vec![line.to_string()];
            index += 1;
            while index < lines.len() && brace_depth > 0 {
                let next = lines[index];
                rule_lines.push(next.to_string());
                brace_depth += net_brace_delta(next);
                index += 1;
            }
            let comment = rule_lines
                .iter()
                .map(|rule_line| format!("// {}", rule_line.trim_end()))
                .collect::<Vec<_>>()
                .join("\n");
            map.insert(name, comment);
        } else {
            index += 1;
        }
    }
    map
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extract_rule_source_comments_collects_multiline_rules() {
        let source = "expr = {\n    a ~ b\n}\n";
        let comments = extract_rule_source_comments(source);
        assert!(comments["expr"].contains("// expr = {"));
        assert!(comments["expr"].contains("//     a ~ b"));
        assert!(comments["expr"].contains("// }"));
    }
}

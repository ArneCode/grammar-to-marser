//! Verify IR-generated samples parse with the committed generated parsers.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use grammar_to_marser::{suggest_sample_source, InputSyntax};
use serde::Deserialize;

#[derive(Deserialize)]
struct Manifest {
    fixture: Vec<PestFixture>,
    #[serde(default)]
    peg_fixture: Vec<PegFixture>,
}

#[derive(Deserialize)]
struct PestFixture {
    pest: String,
    entry: String,
    stem: String,
}

#[derive(Deserialize)]
struct PegFixture {
    peg: String,
    entry: String,
    stem: String,
}

fn manifest() -> Manifest {
    toml::from_str(include_str!("fixtures.toml")).expect("parse fixtures.toml")
}

fn fixture_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures")
}

fn generated_parser_path(stem: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join(format!("tests/generated/{stem}.rs"))
}

fn assert_sample_parses_with_generated_parser(stem: &str, sample: &str) {
    let grammar_rs = fs::read_to_string(generated_parser_path(stem))
        .unwrap_or_else(|err| panic!("read generated parser for {stem}: {err}"));
    let temp = tempfile::tempdir().expect("tempdir");
    let project = temp.path();
    fs::create_dir_all(project.join("src")).expect("create src");
    fs::write(project.join("src/lib.rs"), "pub mod grammar;\n").expect("write lib.rs");
    fs::write(project.join("src/grammar.rs"), grammar_rs).expect("write grammar.rs");
    fs::write(
        project.join("Cargo.toml"),
        r#"[package]
name = "sample-check"
version = "0.1.0"
edition = "2024"

[dependencies]
marser = "0.2.2"
"#,
    )
    .expect("write Cargo.toml");
    fs::write(
        project.join("src/main.rs"),
        r#"use marser::parser::Parser;
use sample_check::grammar;

fn main() {
    let input = std::env::args().nth(1).expect("input");
    grammar::grammar().parse_str(&input).expect("parse");
}
"#,
    )
    .expect("write main.rs");

    let status = Command::new("cargo")
        .env("CARGO_TARGET_DIR", project.join("target"))
        .args(["run", "--quiet", "--", sample])
        .current_dir(project)
        .status()
        .expect("cargo run");
    assert!(
        status.success(),
        "generated sample failed to parse for {stem}: {sample:?}"
    );
}

#[test]
fn pest_fixture_samples_parse_with_generated_parsers() {
    for fixture in manifest().fixture {
        let source = fs::read_to_string(fixture_root().join(&fixture.pest))
            .unwrap_or_else(|err| panic!("read {}: {err}", fixture.pest));
        let Some(sample) = suggest_sample_source(&source, InputSyntax::Pest, &fixture.entry)
            .unwrap_or_else(|err| panic!("suggest sample for {}: {err:?}", fixture.pest))
        else {
            continue;
        };
        assert_sample_parses_with_generated_parser(&fixture.stem, &sample);
    }
}

#[test]
fn peg_fixture_samples_parse_with_generated_parsers() {
    for fixture in manifest().peg_fixture {
        let source = fs::read_to_string(fixture_root().join(&fixture.peg))
            .unwrap_or_else(|err| panic!("read {}: {err}", fixture.peg));
        let Some(sample) = suggest_sample_source(&source, InputSyntax::Peg, &fixture.entry)
            .unwrap_or_else(|err| panic!("suggest sample for {}: {err:?}", fixture.peg))
        else {
            continue;
        };
        assert_sample_parses_with_generated_parser(&fixture.stem, &sample);
    }
}

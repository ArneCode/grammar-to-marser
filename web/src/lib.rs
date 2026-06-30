use grammar_to_marser::{
    ConvertError, ConvertOptions, InputSyntax, convert_source, list_rules,
};
use js_sys::{Array, Object, Reflect};
use wasm_bindgen::prelude::*;

fn errors_to_js(errors: &[ConvertError]) -> JsValue {
    let arr = Array::new();
    for error in errors {
        let obj = Object::new();
        let _ = Reflect::set(
            &obj,
            &JsValue::from_str("message"),
            &JsValue::from_str(&error.to_string()),
        );
        if let Some((from, to)) = error.span() {
            let _ = Reflect::set(
                &obj,
                &JsValue::from_str("from"),
                &JsValue::from(from as u32),
            );
            let _ = Reflect::set(&obj, &JsValue::from_str("to"), &JsValue::from(to as u32));
        }
        arr.push(&obj);
    }
    arr.into()
}

#[wasm_bindgen]
pub fn convert(
    grammar_source: &str,
    syntax: &str,
    entry_rule: &str,
    emit_comments: bool,
    emit_trace: bool,
) -> Result<String, JsValue> {
    let syntax = InputSyntax::parse(syntax)
        .ok_or_else(|| JsValue::from_str("unknown syntax (expected pest or peg)"))?;
    let options = ConvertOptions {
        entry_rule: entry_rule.to_string(),
        function_name: "grammar".to_string(),
        emit_comments,
        emit_trace,
    };

    convert_source(grammar_source, syntax, &options).map_err(|errors| errors_to_js(&errors))
}

#[wasm_bindgen]
pub fn list_grammar_rules(grammar_source: &str, syntax: &str) -> Result<Vec<String>, JsValue> {
    let syntax = InputSyntax::parse(syntax)
        .ok_or_else(|| JsValue::from_str("unknown syntax (expected pest or peg)"))?;
    list_rules(grammar_source, syntax).map_err(|errors| errors_to_js(&errors))
}

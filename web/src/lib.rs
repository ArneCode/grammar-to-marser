use js_sys::{Array, Object, Reflect};
use pest_to_marser::{convert_pest_source, list_pest_rules, ConvertError, ConvertOptions};
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
pub fn convert(pest_source: &str, entry_rule: &str, emit_comments: bool) -> Result<String, JsValue> {
    let options = ConvertOptions {
        entry_rule: entry_rule.to_string(),
        function_name: "grammar".to_string(),
        emit_comments,
    };

    convert_pest_source(pest_source, &options).map_err(|errors| errors_to_js(&errors))
}

#[wasm_bindgen]
pub fn list_rules(pest_source: &str) -> Result<Vec<String>, JsValue> {
    list_pest_rules(pest_source).map_err(|errors| errors_to_js(&errors))
}

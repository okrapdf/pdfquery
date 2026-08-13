mod document;
mod selector;

use wasm_bindgen::prelude::*;

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct NativeQueryResult<'a> {
    result_ids: Vec<&'a str>,
    diagnostics: &'a [serde_json::Value],
    #[serde(skip_serializing_if = "Option::is_none")]
    handles: Option<&'a [serde_json::Value]>,
}

fn js_error(error: impl std::fmt::Display) -> JsValue {
    js_sys::Error::new(&error.to_string()).into()
}

#[wasm_bindgen]
pub struct NativeDocument {
    parsed: document::ParsedDocument,
}

#[wasm_bindgen]
impl NativeDocument {
    #[wasm_bindgen(constructor)]
    pub fn new(bytes: &[u8]) -> Result<NativeDocument, JsValue> {
        console_error_panic_hook::set_once();
        document::open_pdf(bytes)
            .map(|parsed| NativeDocument { parsed })
            .map_err(js_error)
    }

    #[wasm_bindgen(js_name = queryJson)]
    pub fn query_json(&self, selector: &str, include_handles: bool) -> Result<String, JsValue> {
        let result = self.parsed.query(selector).map_err(js_error)?;
        serde_json::to_string(&NativeQueryResult {
            result_ids: result.result_ids,
            diagnostics: result.diagnostics,
            handles: include_handles.then_some(result.handles),
        })
        .map_err(js_error)
    }
}

#[wasm_bindgen]
pub fn version() -> String {
    env!("CARGO_PKG_VERSION").to_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn repeated_query_payload_omits_the_handle_table() {
        let diagnostics = vec![serde_json::json!({ "level": "warning" })];
        let handles = [serde_json::json!({ "snapshot": { "id": "node-1" } })];
        let initial_payload = serde_json::to_value(NativeQueryResult {
            result_ids: vec!["node-1"],
            diagnostics: &diagnostics,
            handles: Some(&handles),
        })
        .expect("serialize initial query payload");
        let payload = serde_json::to_value(NativeQueryResult {
            result_ids: vec!["node-1"],
            diagnostics: &diagnostics,
            handles: None,
        })
        .expect("serialize query payload");

        assert_eq!(payload["resultIds"], serde_json::json!(["node-1"]));
        assert_eq!(
            payload["diagnostics"],
            serde_json::json!([{ "level": "warning" }])
        );
        assert_eq!(
            initial_payload["handles"],
            serde_json::json!([{ "snapshot": { "id": "node-1" } }])
        );
        assert!(payload.get("handles").is_none());
    }
}

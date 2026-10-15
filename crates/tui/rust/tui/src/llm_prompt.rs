//! Standalone renderer for `meridian.ui.v1.LlmPromptPanel`.
//!
//! v0 strategy: lean on the existing `PromptPanel` renderer.
//! Every `LlmPromptPanel.slots[i].field` is already a `FormField`
//! — exactly what `PromptPanel.fields` consumes. We synthesize a
//! `PromptPanel` from the slot fields, drive `render_prompt` to
//! collect typed values via the existing TUI form widget, then
//! substitute the values into the `system_template` +
//! `user_template`.
//!
//! Slot values are keyed by `ParameterSlot.name`, even when a field has a
//! different `field_id`. Substitution scans the original template once:
//! token-shaped slot contents stay literal, and unknown tokens stay visible.
//!
//! Returns the rendered strings + the typed slot map so callers
//! can either preview them or hand them straight to an LLM API
//! client. The renderer itself does NOT call the API — execution
//! is the caller's job (compose with `LroPanel` when ready).
//!
//! Multi-line slots: v0 honors `multi_line: true` only as far as
//! the FormField kind allows. The TUI's `TextInput` widget is
//! single-line today; multi-line content (file dumps, long
//! contexts) is still better pre-filled via API rather than
//! typed-at in the TUI. The schema preserves the hint; a future
//! renderer iteration adds an actual multi-line widget.

use std::collections::HashMap;

use meridian_uiview::proto::{LlmPromptPanel, PromptPanel};

use crate::prompt::{render_prompt, FieldValue, PromptError, PromptResponse};
use crate::theme::Palette;

/// Result of rendering an `LlmPromptPanel` interactively.
#[derive(Debug, Clone)]
pub enum LlmPromptResponse {
    /// User filled all slots and hit submit. Both the typed slot
    /// values AND the fully-substituted templates are returned —
    /// callers usually only need the rendered strings.
    Submitted {
        slots: HashMap<String, FieldValue>,
        rendered_system: String,
        rendered_user: String,
    },
    /// User pressed Esc.
    Cancelled,
}

/// Render the LlmPromptPanel: collect slot values via the existing
/// TUI form renderer, then substitute into the templates. Drives
/// crossterm + raw mode internally (via the underlying
/// `render_prompt`).
pub fn render_llm_prompt(
    panel: &LlmPromptPanel,
    palette: &Palette,
) -> Result<LlmPromptResponse, PromptError> {
    // Build a synthetic PromptPanel from the slot FormFields. Without usable
    // inputs there is nothing to collect: return templates verbatim, including
    // any unresolved placeholders, without entering raw terminal mode.
    let synthetic = prompt_for_slots(panel);
    if synthetic.fields.is_empty() {
        return Ok(LlmPromptResponse::Submitted {
            slots: HashMap::new(),
            rendered_system: panel.system_template.clone(),
            rendered_user: panel.user_template.clone(),
        });
    }
    let response = render_prompt(&synthetic, palette)?;
    match response {
        PromptResponse::Submitted(values) => {
            let rendered_system = substitute(&panel.system_template, &values);
            let rendered_user = substitute(&panel.user_template, &values);
            Ok(LlmPromptResponse::Submitted {
                slots: values,
                rendered_system,
                rendered_user,
            })
        }
        PromptResponse::Cancelled => Ok(LlmPromptResponse::Cancelled),
        // Confirmation mode never fires here — we construct a form
        // PromptPanel, not a confirmation one. Treat the impossible
        // case as cancellation rather than panicking on a hostile
        // input.
        PromptResponse::Confirmed(_) => Ok(LlmPromptResponse::Cancelled),
    }
}

pub(crate) fn prompt_for_slots(panel: &LlmPromptPanel) -> PromptPanel {
    PromptPanel {
        description: panel.description.clone(),
        fields: panel
            .slots
            .iter()
            .filter_map(|slot| {
                let mut field = slot.field.clone()?;
                // Templates and the returned slot map are keyed by slot.name.
                // The proto only recommends that field_id match; it does not
                // require it. Preserve the authored descriptor while adapting
                // to the standalone prompt's field_id-keyed response.
                field.field_id = slot.name.clone();
                Some(field)
            })
            .collect(),
        is_confirmation: false,
        accept_label: "Render".to_string(),
        cancel_label: "Cancel".to_string(),
        detail: String::new(),
    }
}

pub(crate) fn substitute(template: &str, values: &HashMap<String, FieldValue>) -> String {
    // Match only the original template, never the inserted values. Replacing
    // once per HashMap entry recursively expanded token-shaped slot values in
    // an order that depended on the map's randomized iteration.
    let tokens = regex::Regex::new(r"\{\{\s*([^{}]+?)\s*\}\}").expect("static slot pattern");
    tokens
        .replace_all(template, |captures: &regex::Captures<'_>| {
            values
                .get(captures[1].trim())
                .map(FieldValue::as_string)
                .unwrap_or_else(|| captures[0].to_string())
        })
        .into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;
    use meridian_uiview::proto::{form_field::Kind, FormField, ParameterSlot, TextInput};

    #[test]
    fn no_slots_returns_templates_verbatim() {
        let panel = LlmPromptPanel {
            system_template: "be helpful".to_string(),
            user_template: "hello".to_string(),
            slots: vec![],
            model_hint: None,
            output_json_schema: String::new(),
            description: String::new(),
        };
        let r = render_llm_prompt(&panel, &Palette::default())
            .expect("no-slots path doesn't enter raw mode");
        match r {
            LlmPromptResponse::Submitted {
                rendered_system,
                rendered_user,
                slots,
            } => {
                assert_eq!(rendered_system, "be helpful");
                assert_eq!(rendered_user, "hello");
                assert!(slots.is_empty());
            }
            _ => panic!("expected Submitted"),
        }
    }

    #[test]
    fn substitute_replaces_all_occurrences() {
        let mut values = HashMap::new();
        values.insert("name".to_string(), FieldValue::Text("Ada".to_string()));
        let s = substitute("Hello {{name}}, welcome {{name}}.", &values);
        assert_eq!(s, "Hello Ada, welcome Ada.");
    }

    #[test]
    fn substitute_leaves_unresolved_placeholders() {
        let mut values = HashMap::new();
        values.insert("name".to_string(), FieldValue::Text("Ada".to_string()));
        let s = substitute("{{name}} / {{age}}", &values);
        assert_eq!(s, "Ada / {{age}}");
    }

    #[test]
    fn substitute_never_rescans_slot_values() {
        let values = HashMap::from([
            ("a".to_string(), FieldValue::Text("{{b}}".to_string())),
            ("b".to_string(), FieldValue::Text("{{a}}".to_string())),
        ]);
        // Either HashMap iteration order breaks this if substitution rescans
        // inserted text. Slot values, including token-shaped text, are literal.
        assert_eq!(substitute("{{a}} / {{b}}", &values), "{{b}} / {{a}}");
    }

    #[test]
    fn substitute_matches_original_tokens_and_keeps_values_literal() {
        let values = HashMap::from([
            (
                "name".to_string(),
                FieldValue::Text("Ada $& <tag> 🦀".to_string()),
            ),
            (
                "a.b".to_string(),
                FieldValue::Text("literal.name".to_string()),
            ),
        ]);
        assert_eq!(
            substitute("{{ name }} / {{\tname\n}} / {{a.b}} / {{missing}}", &values),
            "Ada $& <tag> 🦀 / Ada $& <tag> 🦀 / literal.name / {{missing}}"
        );
    }

    #[test]
    fn substitute_preserves_typed_zero_false_and_empty_values() {
        let values = HashMap::from([
            ("text".to_string(), FieldValue::Text(String::new())),
            ("integer".to_string(), FieldValue::Integer(0)),
            ("number".to_string(), FieldValue::Number(-1.5)),
            ("boolean".to_string(), FieldValue::Boolean(false)),
            (
                "enum".to_string(),
                FieldValue::Selection("stored-token".to_string()),
            ),
            (
                "masked".to_string(),
                FieldValue::Masked("secret".to_string()),
            ),
        ]);
        assert_eq!(
            substitute(
                "[{{text}}] {{integer}} {{number}} {{boolean}} {{enum}} {{masked}}",
                &values
            ),
            "[] 0 -1.5 false stored-token secret"
        );
    }

    #[test]
    fn slot_names_key_inputs_without_mutating_authored_field_ids() {
        let mut slot = make_text_slot("document", "Source text");
        slot.field.as_mut().unwrap().field_id = "different-field-id".into();
        slot.field.as_mut().unwrap().request_field = "rpc.only".into();
        let panel = LlmPromptPanel {
            description: "Fill the prompt".into(),
            user_template: "{{document}}".into(),
            slots: vec![
                slot,
                ParameterSlot {
                    name: "missing".into(),
                    ..Default::default()
                },
            ],
            ..Default::default()
        };
        let prompt = prompt_for_slots(&panel);
        assert_eq!(prompt.fields.len(), 1);
        assert_eq!(prompt.fields[0].field_id, "document");
        assert_eq!(prompt.fields[0].request_field, "rpc.only");
        assert_eq!(
            prompt.fields[0].kind,
            panel.slots[0].field.as_ref().unwrap().kind
        );
        assert_eq!(prompt.description, "Fill the prompt");
        assert_eq!(prompt.accept_label, "Render");
        assert!(!prompt.is_confirmation);
        assert_eq!(
            panel.slots[0].field.as_ref().unwrap().field_id,
            "different-field-id"
        );
    }

    fn make_text_slot(name: &str, default: &str) -> ParameterSlot {
        ParameterSlot {
            name: name.to_string(),
            field: Some(FormField {
                field_id: name.to_string(),
                label: name.to_string(),
                request_field: String::new(),
                description: String::new(),
                kind: Some(Kind::Text(TextInput {
                    default_value: default.to_string(),
                    ..Default::default()
                })),
                ..Default::default()
            }),
            multi_line: false,
            rows: 0,
        }
    }

    #[test]
    fn substitute_uses_field_value_for_text_kind() {
        let _slot = make_text_slot("x", "default");
        let mut values = HashMap::new();
        values.insert("x".to_string(), FieldValue::Text("filled".to_string()));
        assert_eq!(substitute("[{{x}}]", &values), "[filled]");
    }
}

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
) -> Result<LlmPromptResponse, PromptError> {
    // Build a synthetic PromptPanel from the slot FormFields. If
    // there are no slots, the templates carry no `{{...}}`
    // placeholders and we can return them verbatim.
    let fields = panel
        .slots
        .iter()
        .filter_map(|s| s.field.clone())
        .collect::<Vec<_>>();
    if fields.is_empty() {
        return Ok(LlmPromptResponse::Submitted {
            slots: HashMap::new(),
            rendered_system: panel.system_template.clone(),
            rendered_user: panel.user_template.clone(),
        });
    }
    let synthetic = PromptPanel {
        description: panel.description.clone(),
        fields,
        is_confirmation: false,
        accept_label: "Render".to_string(),
        cancel_label: "Cancel".to_string(),
        detail: String::new(),
    };
    let response = render_prompt(&synthetic)?;
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

fn substitute(template: &str, values: &HashMap<String, FieldValue>) -> String {
    let mut out = template.to_string();
    for (k, v) in values {
        let placeholder = format!("{{{{{}}}}}", k);
        out = out.replace(&placeholder, &v.as_string());
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use meridian_uiview::proto::{
        form_field::Kind, FormField, ParameterSlot, TextInput,
    };

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
        let r = render_llm_prompt(&panel).expect("no-slots path doesn't enter raw mode");
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

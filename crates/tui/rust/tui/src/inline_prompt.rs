use std::collections::{HashMap, HashSet};

use crossterm::event::{KeyCode, KeyEvent, KeyEventKind, KeyModifiers};
use meridian_uiview::proto::{
    form_field::Kind, panel_descriptor::Body, FormField, PanelDescriptor,
};
use prost_types::{value, ListValue, Struct, Value};
use ratatui::{
    layout::{Constraint, Layout, Rect},
    widgets::{Paragraph, Wrap},
    Frame,
};

use crate::{
    llm_prompt::{prompt_for_slots, substitute},
    prompt::{has_masked_field, FieldValue, PromptResponse, PromptState},
    theme::Palette,
};

/// In-process interaction outcome. Collected data crosses the host seam as a
/// canonical protobuf Struct; this enum owns no transport or execution policy.
#[derive(Debug, Clone)]
pub enum PanelPromptResponse {
    Submitted(Struct),
    Confirmed(bool),
    Cancelled,
    Preview {
        slots: Struct,
        rendered_system: String,
        rendered_user: String,
    },
}

pub(crate) struct InlinePrompt {
    descriptor: PanelDescriptor,
    state: Option<PromptState>,
    fields: Vec<FormField>,
    error: String,
    preview: Option<(String, String)>,
    canceled: bool,
    completed: bool,
    preview_scroll: u16,
}

impl InlinePrompt {
    pub(crate) fn new(descriptor: &PanelDescriptor) -> Option<Self> {
        let mut panel = match descriptor.body.as_ref()? {
            Body::Prompt(panel) => panel.clone(),
            Body::LlmPrompt(panel) => prompt_for_slots(panel),
            _ => return None,
        };
        if matches!(descriptor.body, Some(Body::LlmPrompt(_))) {
            panel.accept_label = "Preview".into();
        }
        let no_inputs = panel.fields.is_empty() && !panel.is_confirmation;
        let invalid_slots = if let Some(Body::LlmPrompt(panel)) = descriptor.body.as_ref() {
            let mut names = HashSet::new();
            panel
                .slots
                .iter()
                .any(|slot| slot.name.trim().is_empty() || !names.insert(slot.name.as_str()))
        } else {
            false
        };
        let (mut state, error) = if invalid_slots {
            (None, "LLM slot names must be nonempty and unique".into())
        } else if no_inputs {
            (None, String::new())
        } else {
            match PromptState::new(&panel) {
                Ok(state) => (Some(state), String::new()),
                Err(error) => (None, error.to_string()),
            }
        };
        if let (Some(state), Some(Body::LlmPrompt(panel))) = (&mut state, descriptor.body.as_ref())
        {
            for slot in &panel.slots {
                if slot.multi_line
                    && slot.field.as_ref().is_some_and(|field| {
                        matches!(field.kind, Some(Kind::Text(_)) | Some(Kind::Masked(_)))
                    })
                {
                    state.set_multiline_rows(&slot.name, slot.rows);
                }
            }
        }
        Some(Self {
            descriptor: descriptor.clone(),
            fields: panel.fields,
            state,
            error,
            preview: None,
            canceled: false,
            completed: false,
            preview_scroll: 0,
        })
    }

    pub(crate) fn matches(&self, descriptor: &PanelDescriptor) -> bool {
        &self.descriptor == descriptor
    }

    pub(crate) fn handle_key(&mut self, key: KeyEvent) -> Option<PanelPromptResponse> {
        if self.canceled || self.completed || key.kind != KeyEventKind::Press {
            return None;
        }
        if key.code == KeyCode::Esc
            || (key.code == KeyCode::Char('c') && key.modifiers.contains(KeyModifiers::CONTROL))
        {
            self.canceled = true;
            return Some(PanelPromptResponse::Cancelled);
        }
        if !self.error.is_empty() && self.state.is_none() {
            return None;
        }
        if key.code == KeyCode::Char('u') && key.modifiers == KeyModifiers::CONTROL {
            if let Some(state) = &mut self.state {
                state.clear_text();
            }
            return None;
        }
        if let Some(Body::LlmPrompt(panel)) = self.descriptor.body.as_ref() {
            if key.code == KeyCode::PageDown {
                self.preview_scroll = self.preview_scroll.saturating_add(5);
                return None;
            }
            if key.code == KeyCode::PageUp {
                self.preview_scroll = self.preview_scroll.saturating_sub(5);
                return None;
            }
            if key.code == KeyCode::Enter && key.modifiers == KeyModifiers::SHIFT {
                if let Some(state) = &mut self.state {
                    if panel.slots.iter().any(|slot| {
                        slot.multi_line && Some(slot.name.as_str()) == state.focused_field_id()
                    }) {
                        state.insert_line_break();
                    }
                }
                return None;
            }
        }
        let response = match &mut self.state {
            Some(state) => state.handle_key(key)?,
            None if key.code == KeyCode::Enter && key.modifiers.is_empty() => {
                PromptResponse::Submitted(HashMap::new())
            }
            None => return None,
        };
        match response {
            PromptResponse::Cancelled => {
                self.canceled = true;
                Some(PanelPromptResponse::Cancelled)
            }
            PromptResponse::Confirmed(value) => {
                self.completed = true;
                Some(PanelPromptResponse::Confirmed(value))
            }
            PromptResponse::Submitted(values) => {
                let slots = match typed_values(&self.fields, &values) {
                    Ok(slots) => slots,
                    Err(error) => {
                        self.error = error;
                        if let Some(state) = &mut self.state {
                            state.rearm();
                        }
                        return None;
                    }
                };
                if let Some(Body::LlmPrompt(panel)) = self.descriptor.body.as_ref() {
                    let mut concealed = values.clone();
                    for field in &self.fields {
                        if has_masked_field(field) {
                            concealed.insert(
                                field.field_id.clone(),
                                FieldValue::Masked("******".into()),
                            );
                        }
                    }
                    self.preview = Some((
                        substitute(&panel.system_template, &concealed),
                        substitute(&panel.user_template, &concealed),
                    ));
                    self.preview_scroll = 0;
                    if let Some(state) = &mut self.state {
                        state.rearm();
                    }
                    self.error.clear();
                    Some(PanelPromptResponse::Preview {
                        slots,
                        rendered_system: substitute(&panel.system_template, &values),
                        rendered_user: substitute(&panel.user_template, &values),
                    })
                } else {
                    self.error.clear();
                    self.completed = true;
                    Some(PanelPromptResponse::Submitted(slots))
                }
            }
        }
    }

    pub(crate) fn draw(&self, frame: &mut Frame, area: Rect, palette: &Palette) {
        if self.canceled {
            frame.render_widget(Paragraph::new("Canceled."), area);
            return;
        }
        if self.completed {
            frame.render_widget(Paragraph::new("Submitted.").style(palette.text()), area);
            return;
        }
        if !self.error.is_empty() {
            frame.render_widget(
                Paragraph::new(self.error.as_str()).style(palette.danger_style()),
                area,
            );
            return;
        }
        if let Some(Body::LlmPrompt(panel)) = self.descriptor.body.as_ref() {
            let regions = Layout::vertical([
                if self.state.is_some() {
                    Constraint::Percentage(55)
                } else {
                    Constraint::Length(0)
                },
                Constraint::Min(1),
            ])
            .split(area);
            if let Some(state) = &self.state {
                state.draw(frame, regions[0], palette);
            }
            let (system, user) = self
                .preview
                .as_ref()
                .map(|(system, user)| (system.as_str(), user.as_str()))
                .unwrap_or((&panel.system_template, &panel.user_template));
            let mut text = format!(
                "{}\nSystem prompt:\n{system}\nUser prompt:\n{user}",
                panel.description
            );
            if let Some(model) = &panel.model_hint {
                text.push_str(&format!(
                    "\nModel: {} / {} · max tokens {} · temperature {}",
                    model.provider, model.model, model.max_tokens, model.temperature
                ));
            }
            if !panel.output_json_schema.is_empty() {
                text.push_str(&format!(
                    "\nOutput JSON schema: {}",
                    panel.output_json_schema
                ));
            }
            for slot in &panel.slots {
                if slot.field.is_none() {
                    text.push_str(&format!("\nNo input declared for {}.", slot.name));
                }
            }
            text.push_str(
                "\nPreview [Enter] · multiline [Shift+Enter] · clear [Ctrl+U] · scroll [PageUp/PageDown] · cancel [Esc]",
            );
            let wrapped_lines: usize = text
                .lines()
                .map(|line| {
                    ratatui::text::Line::raw(line)
                        .width()
                        .max(1)
                        .div_ceil(regions[1].width.max(1) as usize)
                })
                .sum();
            let scroll = self.preview_scroll.min(
                wrapped_lines
                    .saturating_sub(regions[1].height as usize)
                    .min(u16::MAX as usize) as u16,
            );
            frame.render_widget(
                Paragraph::new(text)
                    .style(palette.text())
                    .scroll((scroll, 0))
                    .wrap(Wrap { trim: false }),
                regions[1],
            );
        } else if let Some(state) = &self.state {
            state.draw(frame, area, palette);
        } else {
            frame.render_widget(
                Paragraph::new("No fields declared. Submit [Enter] · Cancel [Esc]")
                    .style(palette.text())
                    .wrap(Wrap { trim: false }),
                area,
            );
        }
    }
}

fn typed_values(
    fields: &[FormField],
    values: &HashMap<String, FieldValue>,
) -> Result<Struct, String> {
    let fields = fields
        .iter()
        .map(|field| {
            let value = values
                .get(&field.field_id)
                .ok_or_else(|| "missing collected field".to_string())?;
            let value = match value {
                FieldValue::Integer(value) => serde_json::Value::from(*value),
                FieldValue::Number(value) => serde_json::Value::from(*value),
                FieldValue::Boolean(value) => serde_json::Value::Bool(*value),
                _ if matches!(
                    field.kind,
                    Some(Kind::Nested(_)) | Some(Kind::Repeated(_)) | Some(Kind::KeyValueMap(_))
                ) =>
                {
                    serde_json::from_str(&value.as_string()).map_err(|error| error.to_string())?
                }
                _ => serde_json::Value::String(value.as_string()),
            };
            Ok((field.field_id.clone(), proto_value(value)?))
        })
        .collect::<Result<_, String>>()?;
    Ok(Struct { fields })
}

fn proto_value(value: serde_json::Value) -> Result<Value, String> {
    let kind = match value {
        serde_json::Value::Null => value::Kind::NullValue(0),
        serde_json::Value::Bool(value) => value::Kind::BoolValue(value),
        serde_json::Value::Number(value) => value::Kind::NumberValue(
            value
                .as_f64()
                .ok_or_else(|| "number cannot be represented by protobuf Value".to_string())?,
        ),
        serde_json::Value::String(value) => value::Kind::StringValue(value),
        serde_json::Value::Array(values) => value::Kind::ListValue(ListValue {
            values: values
                .into_iter()
                .map(proto_value)
                .collect::<Result<_, _>>()?,
        }),
        serde_json::Value::Object(fields) => value::Kind::StructValue(Struct {
            fields: fields
                .into_iter()
                .map(|(key, value)| Ok((key, proto_value(value)?)))
                .collect::<Result<_, String>>()?,
        }),
    };
    Ok(Value { kind: Some(kind) })
}

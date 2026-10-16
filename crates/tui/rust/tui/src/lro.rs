// In-process rendering state, never a serialized transport DTO. Structured
// metadata/results cross the host seam as canonical protobuf Struct messages.
use std::sync::Arc;

use meridian_uiview::{format_lro_metadata, proto::LroPanel, render_table_bounded};
use prost_types::{value::Kind, Struct, Value};

use crate::widget::CachedTable;

/// Opaque in-process identity for one start attempt. Clones identify the same
/// attempt; tokens from another attempt or PanelView never compare equal.
#[derive(Debug, Clone)]
pub struct LroRunId(Arc<()>);

impl PartialEq for LroRunId {
    fn eq(&self, other: &Self) -> bool {
        Arc::ptr_eq(&self.0, &other.0)
    }
}
impl Eq for LroRunId {}

enum Phase {
    Submitting,
    Running,
    Complete,
    Failed(String),
    Canceled,
}

pub(crate) struct LroRun {
    pub id: LroRunId,
    panel: LroPanel,
    phase: Phase,
    operation_name: String,
    metadata: Option<serde_json::Value>,
    pub result: Option<CachedTable>,
}

impl LroRun {
    pub fn new(panel: &LroPanel) -> Self {
        Self {
            id: LroRunId(Arc::new(())),
            panel: panel.clone(),
            phase: Phase::Submitting,
            operation_name: String::new(),
            metadata: None,
            result: None,
        }
    }

    pub fn active(&self) -> bool {
        matches!(self.phase, Phase::Submitting | Phase::Running)
    }

    pub fn progress(&mut self, id: &LroRunId, name: &str, metadata: &Struct) -> bool {
        if self.id != *id
            || !self.active()
            || name.trim().is_empty()
            || (!self.operation_name.is_empty() && self.operation_name != name)
        {
            return false;
        }
        let Some(value) = struct_json(metadata) else {
            return false;
        };
        self.metadata = Some(value);
        self.operation_name = name.to_owned();
        self.phase = Phase::Running;
        true
    }

    pub fn complete(&mut self, id: &LroRunId, source: &Struct) -> bool {
        if self.id != *id || !self.active() {
            return false;
        }
        let Some(source) = struct_json(source) else {
            return false;
        };
        let result = if let Some(table) = self.panel.result.as_ref() {
            let Ok(rows) = render_table_bounded(&source, table) else {
                return false;
            };
            Some(CachedTable {
                rows,
                item_noun: table.item_noun.clone(),
            })
        } else {
            None
        };
        self.result = result;
        self.phase = Phase::Complete;
        true
    }

    pub fn fail(&mut self, id: &LroRunId, error: &str) -> bool {
        if self.id != *id || !self.active() {
            return false;
        }
        self.phase = Phase::Failed(error.to_owned());
        true
    }

    pub fn cancel(&mut self, id: &LroRunId) -> bool {
        if self.id != *id || !self.active() {
            return false;
        }
        self.phase = Phase::Canceled;
        true
    }

    pub fn status(&self) -> String {
        let headline = match &self.phase {
            Phase::Submitting => "Submitting…".to_owned(),
            Phase::Running => format!("Running: {}", self.operation_name),
            Phase::Complete => "Completed".to_owned(),
            Phase::Failed(error) => format!("Failed: {error}"),
            Phase::Canceled => "Canceled".to_owned(),
        };
        let mut text = headline;
        if let Some(metadata) = &self.metadata {
            text.push_str(if self.active() {
                "\n"
            } else {
                "\nLast metadata: "
            });
            text.push_str(&format_lro_metadata(metadata));
        }
        if !self.active() {
            text.push_str("\nEsc inputs · Enter run again");
        }
        text
    }
}

// Bound conversion before allocating renderer JSON or recursing deeply. This
// also rejects nonfinite manually-built WKT numbers instead of coercing to null.
fn struct_json(value: &Struct) -> Option<serde_json::Value> {
    fn convert(
        value: &Value,
        depth: usize,
        nodes: &mut usize,
        bytes: &mut usize,
    ) -> Option<serde_json::Value> {
        if depth > 64 {
            return None;
        }
        *nodes = nodes.checked_sub(1)?;
        Some(match value.kind.as_ref()? {
            Kind::NullValue(_) => serde_json::Value::Null,
            Kind::BoolValue(value) => (*value).into(),
            Kind::NumberValue(value) => {
                serde_json::Value::Number(serde_json::Number::from_f64(*value)?)
            }
            Kind::StringValue(value) => {
                *bytes = bytes.checked_sub(value.len())?;
                value.clone().into()
            }
            Kind::ListValue(values) => serde_json::Value::Array(
                values
                    .values
                    .iter()
                    .map(|value| convert(value, depth + 1, nodes, bytes))
                    .collect::<Option<_>>()?,
            ),
            Kind::StructValue(value) => object(value, depth + 1, nodes, bytes)?,
        })
    }
    fn object(
        value: &Struct,
        depth: usize,
        nodes: &mut usize,
        bytes: &mut usize,
    ) -> Option<serde_json::Value> {
        let mut fields = serde_json::Map::new();
        for (key, value) in &value.fields {
            *bytes = bytes.checked_sub(key.len())?;
            fields.insert(key.clone(), convert(value, depth, nodes, bytes)?);
        }
        Some(serde_json::Value::Object(fields))
    }
    object(value, 0, &mut 10_000, &mut (1024 * 1024))
}

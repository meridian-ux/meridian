use crate::proto::field_binding::Source;
use crate::proto::{
    form_field::Kind, ContextSource, FieldBinding, FormField, NestedBinding, RpcCall,
};
use serde_json::{Map, Value};
use std::collections::HashMap;

/// Runtime context the FieldBinding sources can pull from at call time.
///
/// Mirrors meridian.ui.descriptors.RequestBuilder.Context on the Java
/// side. The renderer populates it from whatever host-side state it
/// holds (the active resource path, the UI's representative Identity,
/// form input values, the selected row).
#[derive(Default, Clone)]
pub struct Context {
    /// The active resource path (CONTEXT_SOURCE.CURRENT_RESOURCE_PATH).
    pub current_resource_path: Option<String>,
    /// The UI's representative Identity proto, serialized as JSON.
    pub ui_identity: Option<Value>,
    /// The selected row (for RowAction bindings).
    pub selected_row: Option<Value>,
    /// Form field values keyed by field_id.
    pub form_values: HashMap<String, Value>,
    /// Live GRAMMAR/PANEL signal values keyed by name (a Vega selection's
    /// current value, read via the renderGrammar handle's getSignal). Populated
    /// by the host before firing a `signal`-bound RpcCall; empty on surfaces with
    /// no live signals (static / degraded renders), so those bindings are inert.
    pub signals: HashMap<String, Value>,
    /// The view's SELECTION BAG: values published by a sibling panel's scope
    /// picker ("which plan year is this page about?"), keyed by selection key.
    /// Distinct from `signals` (a grammar's own live selection) — this is
    /// view-level scope shared ACROSS panels. An unset key resolves to Null,
    /// which `apply_binding` omits from the request entirely; per rpc.proto that
    /// is required, not incidental — an unset scope must never silently widen
    /// the query by being sent empty.
    pub selections: HashMap<String, Value>,
}

/// Assembles a JSON request from an RpcCall's FieldBindings + runtime
/// context. Mirrors meridian.ui.descriptors.RequestBuilder on the
/// Java side; uses serde_json instead of prost reflection.
///
/// The host serializes the returned Value to proto bytes via its
/// own marshaling layer (tonic + a serde-aware codec, gRPC-Web JSON
/// mode, whatever).
pub struct RequestBuilder;

/// In-process assembly policy selected by the canonical panel arm.
#[derive(Clone, Copy)]
pub enum SubmissionKind {
    /// Field-ID values with explicit binding assignments taking precedence.
    Form,
    /// LRO input request paths, applied after explicit bindings.
    Lro,
}

fn unsafe_segment(key: &str) -> bool {
    matches!(key, "__proto__" | "constructor" | "prototype")
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
#[error("request construction limit exceeded")]
pub struct RequestLimitExceeded;

/// Borrowed in-process overrides, not a serialized context or copied row/form.
#[derive(Clone, Copy, Default)]
pub struct RequestOverrides<'a> {
    pub selected_row: Option<&'a Value>,
    pub form_values: Option<&'a Value>,
    /// Filter overridden form values to declared field IDs, without copying
    /// unmodeled prefill properties into the binding context.
    pub form_fields: Option<&'a std::collections::HashSet<&'a str>>,
}

const BOUNDARY_WORK: usize = 4 * 1024 * 1024;
const BOUNDARY_DEPTH: usize = 64;

/// Runtime work accounting shared by binding assembly and automatic form fields.
pub struct RequestBudget {
    remaining: Option<usize>,
    max_depth: Option<usize>,
}

struct CountWriter {
    remaining: usize,
}

impl std::io::Write for CountWriter {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        self.remaining = self
            .remaining
            .checked_sub(bytes.len())
            .ok_or_else(|| std::io::Error::other("request work limit"))?;
        Ok(bytes.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

impl RequestBudget {
    pub fn for_boundary(existing: &Value) -> Result<Self, RequestLimitExceeded> {
        let mut budget = Self {
            remaining: Some(BOUNDARY_WORK),
            max_depth: Some(BOUNDARY_DEPTH),
        };
        budget.charge(existing, "", 0)?;
        Ok(budget)
    }

    /// Validate borrowed values before copying or constructing a dotted path.
    /// Unlike binding omission, automatic form fields may deliberately set null.
    pub fn assign(
        &mut self,
        root: &mut Value,
        path: &str,
        value: &Value,
    ) -> Result<(), RequestLimitExceeded> {
        if path.is_empty() {
            return Ok(());
        }
        self.charge(value, path, path.split('.').count())?;
        if !root.is_object() {
            *root = Value::Object(Map::new());
        }
        RequestBuilder::set_path(
            root.as_object_mut().expect("object created"),
            path,
            value.clone(),
        );
        Ok(())
    }

    fn debit(left: &mut usize, count: usize) -> Result<(), RequestLimitExceeded> {
        *left = left.checked_sub(count).ok_or(RequestLimitExceeded)?;
        Ok(())
    }

    // A lower bound rejects huge values/containers without scanning or cloning
    // them in full. The bounded writer then charges exact JSON escaping/number
    // sizes without allocating an encoded temporary buffer.
    fn minimum(
        &self,
        value: &Value,
        depth: usize,
        left: &mut usize,
    ) -> Result<(), RequestLimitExceeded> {
        if self.max_depth.is_some_and(|max| depth > max) {
            return Err(RequestLimitExceeded);
        }
        match value {
            Value::Null => Self::debit(left, 4)?,
            Value::Bool(value) => Self::debit(left, if *value { 4 } else { 5 })?,
            Value::Number(_) => Self::debit(left, 1)?,
            Value::String(value) => Self::debit(
                left,
                value.len().checked_add(2).ok_or(RequestLimitExceeded)?,
            )?,
            Value::Array(values) => {
                Self::debit(left, 2 + values.len().saturating_sub(1))?;
                for value in values {
                    self.minimum(value, depth + 1, left)?;
                }
            }
            Value::Object(values) => {
                Self::debit(left, 2 + values.len().saturating_sub(1))?;
                for (key, value) in values {
                    Self::debit(left, key.len().checked_add(3).ok_or(RequestLimitExceeded)?)?;
                    self.minimum(value, depth + 1, left)?;
                }
            }
        }
        Ok(())
    }

    fn serialized<T: serde::Serialize + ?Sized>(
        &mut self,
        value: &T,
        path: &str,
    ) -> Result<(), RequestLimitExceeded> {
        let Some(remaining) = self.remaining else {
            return Ok(());
        };
        let mut writer = CountWriter {
            remaining: remaining
                .checked_sub(path.len())
                .ok_or(RequestLimitExceeded)?,
        };
        serde_json::to_writer(&mut writer, value).map_err(|_| RequestLimitExceeded)?;
        self.remaining = Some(writer.remaining);
        Ok(())
    }

    fn charge(
        &mut self,
        value: &Value,
        path: &str,
        depth: usize,
    ) -> Result<(), RequestLimitExceeded> {
        if self.remaining.is_none() {
            return Ok(());
        }
        let mut left = self
            .remaining
            .unwrap()
            .checked_sub(path.len())
            .ok_or(RequestLimitExceeded)?;
        self.minimum(value, depth, &mut left)?;
        self.serialized(value, path)
    }
}

enum Resolved<'a> {
    Borrowed(&'a Value),
    Text(&'a str),
    Owned(Value),
}

impl Resolved<'_> {
    fn is_null(&self) -> bool {
        match self {
            Self::Borrowed(value) => value.is_null(),
            Self::Owned(value) => value.is_null(),
            Self::Text(_) => false,
        }
    }
    fn charge(
        &self,
        budget: &mut RequestBudget,
        path: &str,
        depth: usize,
    ) -> Result<(), RequestLimitExceeded> {
        match self {
            Self::Borrowed(value) => budget.charge(value, path, depth),
            Self::Owned(value) => budget.charge(value, path, depth),
            Self::Text(value) => {
                if let Some(left) = budget.remaining {
                    if value
                        .len()
                        .checked_add(2)
                        .and_then(|n| n.checked_add(path.len()))
                        .is_none_or(|n| n > left)
                    {
                        return Err(RequestLimitExceeded);
                    }
                }
                budget.serialized(value, path)
            }
        }
    }
    fn into_owned(self) -> Value {
        match self {
            Self::Borrowed(value) => value.clone(),
            Self::Text(value) => Value::String(value.to_owned()),
            Self::Owned(value) => value,
        }
    }
}

impl RequestBuilder {
    /// Assemble bindings AND automatic fields using one cumulative work budget.
    /// Values are borrowed and never added to a second unbounded output object.
    pub fn build_submission(
        call: &RpcCall,
        ctx: &Context,
        fields: &[FormField],
        values: &Value,
        kind: SubmissionKind,
    ) -> Result<Value, RequestLimitExceeded> {
        use prost::Message;
        let mut declaration_bytes = 0usize;
        for field in fields {
            declaration_bytes = declaration_bytes
                .checked_add(field.encoded_len())
                .ok_or(RequestLimitExceeded)?;
            if declaration_bytes > 1024 * 1024 {
                return Err(RequestLimitExceeded);
            }
        }
        if !values.is_object() {
            return Err(RequestLimitExceeded);
        }
        let declared = fields.iter().map(|field| field.field_id.as_str()).collect();
        let (mut request, mut budget) = Self::start_for_boundary(
            call,
            ctx,
            RequestOverrides {
                form_values: Some(values),
                form_fields: Some(&declared),
                ..Default::default()
            },
        )?;
        match kind {
            SubmissionKind::Form => {
                for field in fields {
                    let key = &field.field_id;
                    if key.is_empty() || unsafe_segment(key) {
                        return Err(RequestLimitExceeded);
                    }
                    if request.get(key).is_some() {
                        continue;
                    }
                    let value = values.get(key).unwrap_or(&Value::Null);
                    budget.charge(value, key, 1)?;
                    request
                        .as_object_mut()
                        .expect("assembled object")
                        .insert(key.clone(), value.clone());
                }
            }
            SubmissionKind::Lro => {
                Self::merge_lro_fields(&mut request, fields, values, "", &mut budget, 0)?
            }
        }
        Ok(request)
    }

    fn merge_lro_fields(
        request: &mut Value,
        fields: &[FormField],
        values: &Value,
        prefix: &str,
        budget: &mut RequestBudget,
        nesting: usize,
    ) -> Result<(), RequestLimitExceeded> {
        if nesting > BOUNDARY_DEPTH {
            return Err(RequestLimitExceeded);
        }
        for field in fields {
            let segment = if field.request_field.is_empty() {
                &field.field_id
            } else {
                &field.request_field
            };
            if segment
                .split('.')
                .any(|key| key.is_empty() || unsafe_segment(key))
            {
                return Err(RequestLimitExceeded);
            }
            // Reject excessive paths before creating their combined string.
            if prefix.split('.').filter(|key| !key.is_empty()).count() + segment.split('.').count()
                > BOUNDARY_DEPTH
            {
                return Err(RequestLimitExceeded);
            }
            let path = if prefix.is_empty() {
                segment.clone()
            } else {
                format!("{prefix}.{segment}")
            };
            let value = values.get(&field.field_id).unwrap_or(&Value::Null);
            if let Some(Kind::Nested(nested)) = field.kind.as_ref() {
                Self::merge_lro_fields(request, &nested.fields, value, &path, budget, nesting + 1)?;
            } else {
                budget.assign(request, &path, value)?;
            }
        }
        Ok(())
    }

    pub fn build(call: &RpcCall, ctx: &Context) -> Value {
        Self::build_inner(
            &call.bindings,
            ctx,
            &mut RequestBudget {
                remaining: None,
                max_depth: None,
            },
            RequestOverrides::default(),
            0,
        )
        .expect("unlimited trusted request construction")
    }

    /// For descriptor boundaries: cap cumulative intermediate copy work and
    /// assembled depth BEFORE inserting values or constructing dotted paths.
    /// Nested/overwritten values still consume work; no partial request escapes.
    pub fn build_bounded(
        call: &RpcCall,
        ctx: &Context,
        max_work: usize,
        max_depth: usize,
    ) -> Result<Value, RequestLimitExceeded> {
        Self::build_inner(
            &call.bindings,
            ctx,
            &mut RequestBudget {
                remaining: Some(max_work),
                max_depth: Some(max_depth),
            },
            RequestOverrides::default(),
            0,
        )
    }

    pub fn build_for_boundary(
        call: &RpcCall,
        ctx: &Context,
    ) -> Result<Value, RequestLimitExceeded> {
        Self::build_for_boundary_with(call, ctx, RequestOverrides::default())
    }

    pub fn build_for_boundary_with(
        call: &RpcCall,
        ctx: &Context,
        overrides: RequestOverrides<'_>,
    ) -> Result<Value, RequestLimitExceeded> {
        Self::start_for_boundary(call, ctx, overrides).map(|(request, _)| request)
    }

    /// Continue automatic field assignment using the SAME cumulative budget.
    pub fn start_for_boundary(
        call: &RpcCall,
        ctx: &Context,
        overrides: RequestOverrides<'_>,
    ) -> Result<(Value, RequestBudget), RequestLimitExceeded> {
        use prost::Message;
        if call.encoded_len() > 64 * 1024 {
            return Err(RequestLimitExceeded);
        }
        let mut budget = RequestBudget {
            remaining: Some(BOUNDARY_WORK),
            max_depth: Some(BOUNDARY_DEPTH),
        };
        let request = Self::build_inner(&call.bindings, ctx, &mut budget, overrides, 0)?;
        Ok((request, budget))
    }

    fn build_inner(
        bindings: &[FieldBinding],
        ctx: &Context,
        budget: &mut RequestBudget,
        overrides: RequestOverrides<'_>,
        depth: usize,
    ) -> Result<Value, RequestLimitExceeded> {
        let mut root = Map::new();
        for binding in bindings {
            Self::apply_binding(&mut root, binding, ctx, budget, overrides, depth)?;
        }
        Ok(Value::Object(root))
    }

    fn apply_binding(
        root: &mut Map<String, Value>,
        binding: &FieldBinding,
        ctx: &Context,
        budget: &mut RequestBudget,
        overrides: RequestOverrides<'_>,
        depth: usize,
    ) -> Result<(), RequestLimitExceeded> {
        if binding.request_field.is_empty() {
            return Ok(());
        }
        if budget.remaining.is_some() && binding.request_field.split('.').any(unsafe_segment) {
            return Err(RequestLimitExceeded);
        }
        let depth = depth
            .checked_add(binding.request_field.split('.').count())
            .ok_or(RequestLimitExceeded)?;
        if budget.max_depth.is_some_and(|max| depth > max) {
            return Err(RequestLimitExceeded);
        }
        let value = match binding.source.as_ref() {
            Some(Source::Context(code)) => Self::resolve_context(*code, ctx),
            Some(Source::RowField(p)) => Resolved::Borrowed(crate::ProtoPaths::get(
                overrides
                    .selected_row
                    .or(ctx.selected_row.as_ref())
                    .unwrap_or(&Value::Null),
                p,
            )),
            Some(Source::FormField(id)) => Resolved::Borrowed(match overrides.form_values {
                Some(values)
                    if overrides
                        .form_fields
                        .is_none_or(|fields| fields.contains(id.as_str())) =>
                {
                    values.get(id).unwrap_or(&Value::Null)
                }
                Some(_) => &Value::Null,
                None => ctx.form_values.get(id).unwrap_or(&Value::Null),
            }),
            Some(Source::Literal(s)) => Resolved::Text(s),
            Some(Source::Nested(nested)) => {
                Resolved::Owned(Self::build_nested(nested, ctx, budget, overrides, depth)?)
            }
            // A live grammar/panel signal (a Vega selection). Resolves from
            // ctx.signals like form_field resolves from form_values; absent on
            // static/degraded surfaces → Null → the field is skipped (inert).
            Some(Source::Signal(name)) => {
                Resolved::Borrowed(ctx.signals.get(name).unwrap_or(&Value::Null))
            }
            // A view SELECTION key (a sibling scope picker's current value).
            // Resolves from ctx.selections; UNSET → Null → omitted below, which
            // rpc.proto requires: an unset scope must not be sent as empty and
            // silently widen the query.
            Some(Source::SelectionKey(key)) => {
                Resolved::Borrowed(ctx.selections.get(key).unwrap_or(&Value::Null))
            }
            None => return Ok(()),
        };
        if value.is_null() {
            return Ok(());
        }
        value.charge(budget, &binding.request_field, depth)?;
        Self::set_path(root, &binding.request_field, value.into_owned());
        Ok(())
    }

    fn build_nested(
        nested: &NestedBinding,
        ctx: &Context,
        budget: &mut RequestBudget,
        overrides: RequestOverrides<'_>,
        depth: usize,
    ) -> Result<Value, RequestLimitExceeded> {
        Self::build_inner(&nested.fields, ctx, budget, overrides, depth)
    }

    fn resolve_context(code: i32, ctx: &Context) -> Resolved<'_> {
        match ContextSource::try_from(code).unwrap_or(ContextSource::Unspecified) {
            ContextSource::CurrentResourcePath => ctx
                .current_resource_path
                .as_deref()
                .map(Resolved::Text)
                .unwrap_or(Resolved::Borrowed(&Value::Null)),
            ContextSource::UiIdentity => {
                Resolved::Borrowed(ctx.ui_identity.as_ref().unwrap_or(&Value::Null))
            }
            ContextSource::Unspecified => Resolved::Borrowed(&Value::Null),
        }
    }

    fn set_path(root: &mut Map<String, Value>, path: &str, value: Value) {
        let segments: Vec<&str> = path.split('.').collect();
        if segments.is_empty() {
            return;
        }
        let mut current = root;
        for segment in &segments[..segments.len() - 1] {
            let entry = current
                .entry((*segment).to_string())
                .or_insert_with(|| Value::Object(Map::new()));
            if !entry.is_object() {
                *entry = Value::Object(Map::new());
            }
            current = entry.as_object_mut().unwrap();
        }
        current.insert(segments.last().unwrap().to_string(), value);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn forms_keep_literal_field_ids_ignore_lro_paths_and_prefer_explicit_bindings() {
        let fields = vec![
            FormField {
                field_id: "a.b".into(),
                request_field: "ignored.path".into(),
                ..Default::default()
            },
            FormField {
                field_id: "title".into(),
                ..Default::default()
            },
            FormField {
                field_id: "nested".into(),
                ..Default::default()
            },
        ];
        let call = RpcCall {
            bindings: vec![
                fb("title", Source::Literal("bound".into())),
                fb("leaked", Source::FormField("secret".into())),
            ],
            ..Default::default()
        };
        let values =
            json!({"a.b":false, "title":"raw", "nested":{"child":0}, "secret":"do not send"});
        assert_eq!(
            RequestBuilder::build_submission(
                &call,
                &Context::default(),
                &fields,
                &values,
                SubmissionKind::Form
            )
            .unwrap(),
            json!({"a.b":false, "title":"bound", "nested":{"child":0}})
        );
    }

    #[test]
    fn lro_fields_map_all_nested_paths_and_keep_null_raw_lists_and_maps() {
        let leaf = FormField {
            field_id: "value".into(),
            request_field: "data.value".into(),
            ..Default::default()
        };
        let middle = FormField {
            field_id: "middle".into(),
            request_field: "inner".into(),
            kind: Some(Kind::Nested(crate::proto::NestedForm {
                fields: vec![leaf],
            })),
            ..Default::default()
        };
        let fields = vec![
            FormField {
                field_id: "outer".into(),
                request_field: "config".into(),
                kind: Some(Kind::Nested(crate::proto::NestedForm {
                    fields: vec![middle],
                })),
                ..Default::default()
            },
            FormField {
                field_id: "items".into(),
                ..Default::default()
            },
            FormField {
                field_id: "missing".into(),
                ..Default::default()
            },
        ];
        let values = json!({"outer":{"middle":{"value":false}},"items":[{"raw.key":"001.20"},0]});
        assert_eq!(
            RequestBuilder::build_submission(
                &RpcCall::default(),
                &Context::default(),
                &fields,
                &values,
                SubmissionKind::Lro
            )
            .unwrap(),
            json!({"config":{"inner":{"data":{"value":false}}}, "items":[{"raw.key":"001.20"},0],"missing":null})
        );
    }

    #[test]
    fn submissions_share_binding_and_automatic_field_work_and_reject_unsafe_paths() {
        let ctx = Context {
            ui_identity: Some(json!("x".repeat(700_000))),
            ..Default::default()
        };
        let call = RpcCall {
            bindings: (0..5)
                .map(|_| fb("same", Source::Context(ContextSource::UiIdentity as i32)))
                .collect(),
            ..Default::default()
        };
        let fields = vec![FormField {
            field_id: "extra".into(),
            ..Default::default()
        }];
        for kind in [SubmissionKind::Form, SubmissionKind::Lro] {
            assert!(RequestBuilder::build_submission(
                &call,
                &ctx,
                &fields,
                &json!({"extra":"y".repeat(900_000)}),
                kind
            )
            .is_err());
        }
        for path in ["__proto__.polluted", "constructor.prototype.value"] {
            let fields = vec![FormField {
                field_id: "value".into(),
                request_field: path.into(),
                ..Default::default()
            }];
            assert!(RequestBuilder::build_submission(
                &RpcCall::default(),
                &Context::default(),
                &fields,
                &json!({"value":false}),
                SubmissionKind::Lro
            )
            .is_err());
            let call = RpcCall {
                bindings: vec![fb(path, Source::Literal("no".into()))],
                ..Default::default()
            };
            assert!(RequestBuilder::build_for_boundary(&call, &Context::default()).is_err());
        }
    }

    #[test]
    fn borrowed_overrides_filter_prefill_and_do_not_copy_unused_large_rows() {
        let row = json!({"id":0, "unused":"x".repeat(5 * 1024 * 1024)});
        let forms = json!({"visible":false, "secret":"not a declared input"});
        let declared = ["visible"].into_iter().collect();
        let call = RpcCall {
            bindings: vec![
                fb("id", Source::RowField("id".into())),
                fb("flag", Source::FormField("visible".into())),
                fb("hidden", Source::FormField("secret".into())),
            ],
            ..Default::default()
        };
        let result = RequestBuilder::build_for_boundary_with(
            &call,
            &Context::default(),
            RequestOverrides {
                selected_row: Some(&row),
                form_values: Some(&forms),
                form_fields: Some(&declared),
            },
        )
        .unwrap();
        assert_eq!(result, json!({"id":0,"flag":false}));
        assert_eq!(row["unused"].as_str().unwrap().len(), 5 * 1024 * 1024);
    }

    #[test]
    fn work_counting_handles_escaping_and_rejects_borrowed_values_before_copying() {
        for (text, bytes) in [("é", 5), ("\"", 5), ("a\0", 10)] {
            let call = RpcCall {
                bindings: vec![fb("v", Source::Literal(text.into()))],
                ..Default::default()
            };
            assert!(RequestBuilder::build_bounded(&call, &Context::default(), bytes, 64).is_ok());
            assert_eq!(
                RequestBuilder::build_bounded(&call, &Context::default(), bytes - 1, 64),
                Err(RequestLimitExceeded)
            );
        }
        let ctx = Context {
            ui_identity: Some(json!("x".repeat(5 * 1024 * 1024))),
            ..Default::default()
        };
        let call = RpcCall {
            bindings: vec![fb(
                "identity",
                Source::Context(ContextSource::UiIdentity as i32),
            )],
            ..Default::default()
        };
        assert_eq!(
            RequestBuilder::build_for_boundary(&call, &ctx),
            Err(RequestLimitExceeded)
        );
    }

    #[test]
    fn automatic_fields_continue_the_binding_work_budget_and_keep_null_values() {
        let ctx = Context {
            ui_identity: Some(json!("x".repeat(400_000))),
            ..Default::default()
        };
        let call = RpcCall {
            bindings: (0..10)
                .map(|_| fb("same", Source::Context(ContextSource::UiIdentity as i32)))
                .collect(),
            ..Default::default()
        };
        let (mut request, mut budget) =
            RequestBuilder::start_for_boundary(&call, &ctx, RequestOverrides::default()).unwrap();
        assert_eq!(
            budget.assign(&mut request, "large", &json!("x".repeat(300_000))),
            Err(RequestLimitExceeded)
        );
        assert!(request.get("large").is_none());
        let mut small = json!({});
        let mut budget = RequestBudget::for_boundary(&small).unwrap();
        budget
            .assign(&mut small, "nested.null", &Value::Null)
            .unwrap();
        assert_eq!(small, json!({"nested":{"null":null}}));
    }

    #[test]
    fn bounded_builder_preserves_requests_and_rejects_intermediate_copy_amplification() {
        let ctx = Context {
            ui_identity: Some(json!("x".repeat(4096))),
            ..Default::default()
        };
        let call = RpcCall {
            bindings: (0..10)
                .map(|_| fb("same", Source::Context(ContextSource::UiIdentity as i32)))
                .collect(),
            ..Default::default()
        };
        // Final output is one value, but ten copies still cost work.
        assert_eq!(
            RequestBuilder::build(&call, &ctx)
                .as_object()
                .unwrap()
                .len(),
            1
        );
        assert_eq!(
            RequestBuilder::build_bounded(&call, &ctx, 8192, 64),
            Err(RequestLimitExceeded)
        );
        assert_eq!(
            RequestBuilder::build_bounded(&call, &ctx, 100_000, 64).unwrap(),
            RequestBuilder::build(&call, &ctx)
        );
    }

    #[test]
    fn bounded_builder_checks_combined_dotted_nested_and_value_depth_before_insertion() {
        let mut call = RpcCall {
            bindings: vec![fb("a.b.c", Source::Literal("value".into()))],
            ..Default::default()
        };
        assert!(RequestBuilder::build_bounded(&call, &Context::default(), 1000, 3).is_ok());
        assert_eq!(
            RequestBuilder::build_bounded(&call, &Context::default(), 1000, 2),
            Err(RequestLimitExceeded)
        );
        call.bindings = vec![fb(
            "outer",
            Source::Nested(NestedBinding {
                fields: vec![fb("a.b", Source::Literal("value".into()))],
            }),
        )];
        assert_eq!(
            RequestBuilder::build_bounded(&call, &Context::default(), 1000, 2),
            Err(RequestLimitExceeded)
        );
        call.bindings = vec![fb(
            "identity",
            Source::Context(ContextSource::UiIdentity as i32),
        )];
        let ctx = Context {
            ui_identity: Some(json!({"nested":{"leaf":0}})),
            ..Default::default()
        };
        assert_eq!(
            RequestBuilder::build_bounded(&call, &ctx, 1000, 2),
            Err(RequestLimitExceeded)
        );
    }

    // A SET selection key resolves like any other source; an UNSET one OMITS the
    // field. The omission is the load-bearing half: rpc.proto specifies that an
    // unset scope must never be sent empty, because an empty scope silently
    // WIDENS the query (every plan year instead of one) rather than failing.
    #[test]
    fn a_selection_key_resolves_when_set_and_is_omitted_when_not() {
        let call = RpcCall {
            service: "acme.Plans".into(),
            method: "ListPlans".into(),
            bindings: vec![
                fb("plan_year", Source::SelectionKey("plan_year".into())),
                fb("tenant", Source::Literal("acme".into())),
            ],
        };

        let mut ctx = Context::default();
        ctx.selections.insert("plan_year".into(), json!(2026));
        assert_eq!(
            RequestBuilder::build(&call, &ctx),
            json!({ "plan_year": 2026, "tenant": "acme" }),
        );

        // Unset ⇒ the field is absent entirely, NOT null and NOT "".
        let empty = Context::default();
        let built = RequestBuilder::build(&call, &empty);
        assert_eq!(built, json!({ "tenant": "acme" }));
        assert!(built.get("plan_year").is_none());
    }

    fn fb(request_field: &str, source: Source) -> FieldBinding {
        FieldBinding {
            request_field: request_field.into(),
            source: Some(source),
        }
    }

    #[test]
    fn context_binding_resolves() {
        let ctx = Context {
            current_resource_path: Some("/tmp/x.pdf".into()),
            ..Context::default()
        };
        let call = RpcCall {
            service: "p.v1.S".into(),
            method: "M".into(),
            bindings: vec![fb(
                "pdf_path",
                Source::Context(ContextSource::CurrentResourcePath as i32),
            )],
        };
        assert_eq!(
            RequestBuilder::build(&call, &ctx),
            json!({"pdf_path": "/tmp/x.pdf"}),
        );
    }

    #[test]
    fn nested_binding_builds_sub_object() {
        let mut ctx = Context::default();
        let mut forms = HashMap::new();
        forms.insert("secs".to_string(), json!(300));
        ctx.form_values = forms;
        let call = RpcCall {
            service: "p.v1.S".into(),
            method: "M".into(),
            bindings: vec![fb(
                "max_duration",
                Source::Nested(NestedBinding {
                    fields: vec![fb("seconds", Source::FormField("secs".into()))],
                }),
            )],
        };
        assert_eq!(
            RequestBuilder::build(&call, &ctx),
            json!({"max_duration": {"seconds": 300}}),
        );
    }
}

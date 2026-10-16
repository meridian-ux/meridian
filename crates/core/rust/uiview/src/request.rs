use crate::proto::field_binding::Source;
use crate::proto::{ContextSource, FieldBinding, NestedBinding, RpcCall};
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

#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
#[error("request construction limit exceeded")]
pub struct RequestLimitExceeded;

struct BuildBudget {
    remaining: Option<usize>,
    max_depth: Option<usize>,
}

impl BuildBudget {
    fn check_depth(&self, value: &Value, depth: usize) -> Result<(), RequestLimitExceeded> {
        let Some(max) = self.max_depth else {
            return Ok(());
        };
        if depth > max {
            return Err(RequestLimitExceeded);
        }
        match value {
            Value::Array(values) => {
                for value in values {
                    self.check_depth(value, depth + 1)?;
                }
            }
            Value::Object(values) => {
                for value in values.values() {
                    self.check_depth(value, depth + 1)?;
                }
            }
            _ => {}
        }
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
        self.check_depth(value, depth)?;
        // Charge every intermediate copy, including overwritten destinations
        // and nested assembly. A small final object must not hide huge work.
        let size = serde_json::to_vec(value)
            .map_err(|_| RequestLimitExceeded)?
            .len()
            .checked_add(path.len())
            .ok_or(RequestLimitExceeded)?;
        let remaining = self.remaining.as_mut().expect("checked above");
        *remaining = remaining.checked_sub(size).ok_or(RequestLimitExceeded)?;
        Ok(())
    }
}

impl RequestBuilder {
    pub fn build(call: &RpcCall, ctx: &Context) -> Value {
        Self::build_inner(
            &call.bindings,
            ctx,
            &mut BuildBudget {
                remaining: None,
                max_depth: None,
            },
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
            &mut BuildBudget {
                remaining: Some(max_work),
                max_depth: Some(max_depth),
            },
            0,
        )
    }

    fn build_inner(
        bindings: &[FieldBinding],
        ctx: &Context,
        budget: &mut BuildBudget,
        depth: usize,
    ) -> Result<Value, RequestLimitExceeded> {
        let mut root = Map::new();
        for binding in bindings {
            Self::apply_binding(&mut root, binding, ctx, budget, depth)?;
        }
        Ok(Value::Object(root))
    }

    fn apply_binding(
        root: &mut Map<String, Value>,
        binding: &FieldBinding,
        ctx: &Context,
        budget: &mut BuildBudget,
        depth: usize,
    ) -> Result<(), RequestLimitExceeded> {
        if binding.request_field.is_empty() {
            return Ok(());
        }
        let depth = depth
            .checked_add(binding.request_field.split('.').count())
            .ok_or(RequestLimitExceeded)?;
        if budget.max_depth.is_some_and(|max| depth > max) {
            return Err(RequestLimitExceeded);
        }
        let value = match binding.source.as_ref() {
            Some(Source::Context(code)) => Self::resolve_context(*code, ctx),
            Some(Source::RowField(p)) => ctx
                .selected_row
                .as_ref()
                .map(|r| crate::ProtoPaths::get(r, p).clone())
                .unwrap_or(Value::Null),
            Some(Source::FormField(id)) => ctx.form_values.get(id).cloned().unwrap_or(Value::Null),
            Some(Source::Literal(s)) => Value::String(s.clone()),
            Some(Source::Nested(nested)) => Self::build_nested(nested, ctx, budget, depth)?,
            // A live grammar/panel signal (a Vega selection). Resolves from
            // ctx.signals like form_field resolves from form_values; absent on
            // static/degraded surfaces → Null → the field is skipped (inert).
            Some(Source::Signal(name)) => ctx.signals.get(name).cloned().unwrap_or(Value::Null),
            // A view SELECTION key (a sibling scope picker's current value).
            // Resolves from ctx.selections; UNSET → Null → omitted below, which
            // rpc.proto requires: an unset scope must not be sent as empty and
            // silently widen the query.
            Some(Source::SelectionKey(key)) => {
                ctx.selections.get(key).cloned().unwrap_or(Value::Null)
            }
            None => return Ok(()),
        };
        if value.is_null() {
            return Ok(());
        }
        budget.charge(&value, &binding.request_field, depth)?;
        Self::set_path(root, &binding.request_field, value);
        Ok(())
    }

    fn build_nested(
        nested: &NestedBinding,
        ctx: &Context,
        budget: &mut BuildBudget,
        depth: usize,
    ) -> Result<Value, RequestLimitExceeded> {
        Self::build_inner(&nested.fields, ctx, budget, depth)
    }

    fn resolve_context(code: i32, ctx: &Context) -> Value {
        match ContextSource::try_from(code).unwrap_or(ContextSource::Unspecified) {
            ContextSource::CurrentResourcePath => ctx
                .current_resource_path
                .as_ref()
                .map(|s| Value::String(s.clone()))
                .unwrap_or(Value::Null),
            ContextSource::UiIdentity => ctx.ui_identity.clone().unwrap_or(Value::Null),
            ContextSource::Unspecified => Value::Null,
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

//! Read-only authored view projection shared by native and browser transcripts.
//! No transport, selection bag, clock, route resolver, or mutation exists here.
use crate::proto::{self, form_field, layout, panel_descriptor::Body, ViewDescriptor};
use std::fmt::{self, Write};

#[derive(Debug, Clone, Copy, thiserror::Error)]
#[error("static view construction limit exceeded")]
pub struct StaticViewError;

struct Text {
    value: String,
    remaining: usize,
    nodes: usize,
    lines: usize,
}

impl Write for Text {
    fn write_str(&mut self, text: &str) -> fmt::Result {
        for character in text.chars() {
            if character == '\n' {
                self.lines = self.lines.checked_sub(1).ok_or(fmt::Error)?;
            }
            // Terminal transcripts must not emit authored terminal escapes.
            if character.is_control() && !matches!(character, '\n' | '\t') {
                let escaped = format!("\\u{{{:x}}}", character as u32);
                self.remaining = self
                    .remaining
                    .checked_sub(escaped.len())
                    .ok_or(fmt::Error)?;
                self.value.push_str(&escaped);
            } else {
                self.remaining = self
                    .remaining
                    .checked_sub(character.len_utf8())
                    .ok_or(fmt::Error)?;
                self.value.push(character);
            }
        }
        Ok(())
    }
}

impl Text {
    fn node(&mut self, depth: usize) -> Result<(), StaticViewError> {
        self.nodes = self.nodes.checked_sub(1).ok_or(StaticViewError)?;
        if depth > 64 {
            return Err(StaticViewError);
        }
        Ok(())
    }
    fn line(&mut self, text: fmt::Arguments<'_>) -> Result<(), StaticViewError> {
        self.write_fmt(text)
            .and_then(|_| self.write_char('\n'))
            .map_err(|_| StaticViewError)
    }
    fn copy(&mut self, text: &str) -> Result<(), StaticViewError> {
        if text.is_empty() {
            Ok(())
        } else {
            self.line(format_args!("{text}"))
        }
    }
    fn rpc(&mut self, label: &str, call: Option<&proto::RpcCall>) -> Result<(), StaticViewError> {
        if let Some(call) = call {
            self.line(format_args!(
                "{label}: {}/{} [host required; not executed]",
                call.service, call.method
            ))?;
        }
        Ok(())
    }
    fn actions(&mut self, actions: &[proto::Action], depth: usize) -> Result<(), StaticViewError> {
        for action in actions {
            self.node(depth)?;
            self.line(format_args!("Action: {} [{}]", action.label, action.id))?;
            self.rpc("Destination", action.call.as_ref())?;
        }
        Ok(())
    }
    fn view(&mut self, view: &ViewDescriptor, depth: usize) -> Result<(), StaticViewError> {
        self.node(depth)?;
        self.line(format_args!("View: {} [{}]", view.title, view.id))?;
        self.actions(&view.actions, depth)?;
        if view.slots.len() > self.nodes {
            return Err(StaticViewError);
        }
        let mut slots: Vec<_> = view.slots.iter().collect();
        slots.sort_by_key(|slot| slot.position);
        for slot in slots
            .iter()
            .filter(|slot| slot.placement.as_ref().is_some_and(|p| p.header_row))
        {
            self.slot(slot, depth)?;
        }
        slots.retain(|slot| !slot.placement.as_ref().is_some_and(|p| p.header_row));
        match view.layout.as_ref().and_then(|layout| layout.mode.as_ref()) {
            Some(layout::Mode::TwoColumn(_)) => {
                for sidebar in [false, true] {
                    if sidebar
                        && slots
                            .iter()
                            .any(|slot| slot.placement.as_ref().is_some_and(|p| p.column == 2))
                    {
                        self.copy("Sidebar")?;
                    }
                    for slot in slots.iter().filter(|slot| {
                        slot.placement.as_ref().is_some_and(|p| p.column == 2) == sidebar
                    }) {
                        self.slot(slot, depth)?;
                    }
                }
            }
            Some(layout::Mode::Tabbed(_)) => {
                for slot in slots
                    .iter()
                    .filter(|s| s.placement.as_ref().is_none_or(|p| p.tab_label.is_empty()))
                {
                    self.slot(slot, depth)?;
                }
                slots.retain(|s| {
                    s.placement
                        .as_ref()
                        .is_some_and(|p| !p.tab_label.is_empty())
                });
                slots.sort_by_key(|slot| slot.placement.as_ref().unwrap().tab_position);
                for slot in slots {
                    self.line(format_args!(
                        "Tab: {}",
                        slot.placement.as_ref().unwrap().tab_label
                    ))?;
                    self.slot(slot, depth)?;
                }
            }
            _ => {
                for slot in slots {
                    self.slot(slot, depth)?;
                }
            }
        }
        if view.slots.is_empty() {
            self.copy("No sections.")?;
        }
        self.line(format_args!("End view: {}", view.id))?;
        Ok(())
    }
    fn slot(&mut self, slot: &proto::Slot, depth: usize) -> Result<(), StaticViewError> {
        self.node(depth)?;
        let title = if !slot.title.is_empty() {
            &slot.title
        } else if slot.sub_view.is_none() {
            slot.panel
                .as_ref()
                .map(|p| p.title.as_str())
                .unwrap_or(&slot.id)
        } else {
            &slot.id
        };
        self.line(format_args!("Section: {title} [{}]", slot.id))?;
        if !slot.depends_on_selection_key.is_empty() {
            self.copy(if slot.depends_on_placeholder.is_empty() {
                "Select a value to view this section."
            } else {
                &slot.depends_on_placeholder
            })?;
            self.line(format_args!(
                "Selection required: {} [host context unavailable]",
                slot.depends_on_selection_key
            ))?;
            return Ok(());
        }
        self.actions(&slot.actions, depth)?;
        if let Some(view) = &slot.sub_view {
            if slot.sub_view_populate.is_some() {
                self.copy("Repeated template only; records require an interactive/data host.")?;
                self.rpc("Rows", slot.sub_view_populate.as_ref())?;
            }
            self.view(view, depth + 1)?;
        } else if let Some(panel) = &slot.panel {
            self.panel(panel, depth + 1)?;
        } else {
            self.copy("No panel or nested view supplied.")?;
        }
        Ok(())
    }
    fn affordance(
        &mut self,
        action: &proto::Affordance,
        depth: usize,
    ) -> Result<(), StaticViewError> {
        self.node(depth)?;
        self.line(format_args!("Action: {} [not executed]", action.label))?;
        self.copy(&action.description)?;
        match &action.invoke {
            Some(proto::affordance::Invoke::Uri(uri)) => self.line(format_args!("URI: {uri}")),
            Some(proto::affordance::Invoke::Command(command)) => {
                self.line(format_args!("Command: {command}"))
            }
            Some(proto::affordance::Invoke::Rpc(call)) => self.rpc("Destination", Some(call)),
            Some(proto::affordance::Invoke::Navigate(navigate)) => self.line(format_args!(
                "Route: {} [host required; not executed]",
                navigate.route
            )),
            Some(proto::affordance::Invoke::OpenPanel(_)) => {
                self.copy("Panel destination [host required; not opened]")
            }
            Some(proto::affordance::Invoke::OpenView(view)) => {
                self.line(format_args!("View: {view} [host required; not opened]"))
            }
            Some(proto::affordance::Invoke::Copy(_)) => {
                self.copy("Copy destination [value hidden; not copied]")
            }
            None => self.copy("Destination requires a host."),
        }
    }
    fn snippet(&mut self, snippet: &proto::Snippet) -> Result<(), StaticViewError> {
        self.copy(&snippet.label)?;
        if !snippet.path.is_empty() {
            self.line(format_args!("Path: {}", snippet.path))?;
        }
        self.copy(&snippet.content)
    }
    fn copy_value(&mut self, value: &proto::CopyValue) -> Result<(), StaticViewError> {
        if !value.secret && value.value.len() > self.remaining {
            return Err(StaticViewError);
        }
        let shown = if value.secret {
            "[hidden]".into()
        } else if let Some(display) = &value.display {
            crate::format_display_value(&serde_json::Value::String(value.value.clone()), display)
        } else {
            value.value.clone()
        };
        self.line(format_args!("{}: {shown}", value.label))?;
        self.copy(&value.help)
    }
    fn fields(
        &mut self,
        fields: &[proto::FormField],
        defaults: bool,
        depth: usize,
    ) -> Result<(), StaticViewError> {
        if fields.len() > self.nodes {
            return Err(StaticViewError);
        }
        for field in fields {
            self.node(depth)?;
            self.line(format_args!(
                "Field: {} [{}; read-only transcript]",
                field.label, field.field_id
            ))?;
            self.copy(&field.description)?;
            use form_field::Kind;
            if matches!(&field.kind, Some(Kind::Masked(_))) {
                self.copy("[hidden]")?;
                continue;
            }
            if !defaults {
                self.copy("[record value unavailable]")?;
                continue;
            }
            let raw = match &field.kind {
                Some(Kind::Text(v)) => {
                    if v.default_value.len() > self.remaining {
                        return Err(StaticViewError);
                    }
                    Some(serde_json::json!(v.default_value))
                }
                Some(Kind::Integer(v)) => Some(serde_json::json!(v.default_value)),
                Some(Kind::Number(v)) => Some(serde_json::json!(v.default_value)),
                Some(Kind::Boolean(v)) => Some(serde_json::json!(v.default_value)),
                Some(Kind::EnumSelection(v)) => {
                    if let Some(source) = &v.options_source {
                        self.line(format_args!(
                            "Options: {}/{} [host required; not executed]",
                            source.service, source.method
                        ))?;
                    }
                    for option in &v.options {
                        self.node(depth)?;
                        self.line(format_args!("Option: {} [{}]", option.label, option.value))?;
                    }
                    for token in &v.allowed_values {
                        self.node(depth)?;
                        self.line(format_args!("Option: {token}"))?;
                    }
                    if v.default_value.len() > self.remaining {
                        return Err(StaticViewError);
                    }
                    Some(serde_json::json!(v.default_value))
                }
                Some(Kind::Nested(v)) => {
                    self.fields(&v.fields, true, depth + 1)?;
                    None
                }
                Some(Kind::Repeated(v)) => {
                    self.line(format_args!(
                        "Repeated item template (minimum {}; maximum {})",
                        v.min_items, v.max_items
                    ))?;
                    match &v.element {
                        Some(proto::repeated_field::Element::Scalar(v)) => {
                            self.fields(std::slice::from_ref(v), true, depth + 1)?
                        }
                        Some(proto::repeated_field::Element::Object(v)) => {
                            self.fields(&v.fields, true, depth + 1)?
                        }
                        None => self.copy("Unknown repeated element.")?,
                    }
                    None
                }
                Some(Kind::KeyValueMap(v)) => {
                    self.line(format_args!("Map: {} / {}", v.key_label, v.value_label))?;
                    None
                }
                _ => {
                    self.copy("Unknown input kind.")?;
                    None
                }
            };
            if let Some(raw) = raw {
                let value = field
                    .display
                    .as_ref()
                    .map(|d| crate::format_display_value(&raw, d))
                    .unwrap_or_else(|| crate::format_inferred_value(&raw));
                self.line(format_args!("Default: {value}"))?;
            }
        }
        Ok(())
    }
    fn table(&mut self, table: &proto::TablePanel, depth: usize) -> Result<(), StaticViewError> {
        self.rpc("Rows", table.populate.as_ref())?;
        self.copy(&table.placeholder)?;
        for column in &table.columns {
            self.node(depth)?;
            self.line(format_args!("Column: {}", column.header))?;
        }
        for action in &table.actions {
            self.node(depth)?;
            self.line(format_args!("Row action: {}", action.label))?;
            self.rpc("Destination", action.rpc.as_ref())?;
        }
        self.copy("[rows unavailable without host data]")
    }
    fn panel(
        &mut self,
        panel: &proto::PanelDescriptor,
        depth: usize,
    ) -> Result<(), StaticViewError> {
        self.node(depth)?;
        self.line(format_args!("Panel: {} [{}]", panel.title, panel.panel_id))?;
        match &panel.body {
            Some(Body::DetailHeader(p)) => {
                self.copy(&p.title)?;
                self.rpc("Record", p.populate.as_ref())?;
                for row in &p.descriptor_rows {
                    self.node(depth)?;
                    self.line(format_args!("{}: [record value unavailable]", row.label))?;
                }
                if !p.title_source_path.is_empty()
                    || !p.subtitle_source_path.is_empty()
                    || !p.status_source_path.is_empty()
                {
                    self.copy("[record title/subtitle/status require host data]")?;
                }
            }
            Some(Body::RecordCard(p)) => {
                self.rpc("Record", p.populate.as_ref())?;
                self.fields(&p.fields, false, depth + 1)?;
            }
            Some(Body::Form(p)) => {
                self.rpc("Prefill", p.prefill.as_ref())?;
                self.fields(&p.fields, true, depth + 1)?;
                self.rpc("Submit", p.submit.as_ref())?;
            }
            Some(Body::Prompt(p)) => {
                self.copy(&p.description)?;
                self.copy(&p.detail)?;
                self.fields(&p.fields, true, depth + 1)?;
                self.line(format_args!(
                    "Confirmation/input requires host: {} / {}",
                    p.accept_label, p.cancel_label
                ))?;
            }
            Some(Body::LlmPrompt(p)) => {
                self.copy(&p.description)?;
                // Templates may interpolate masked fields. Do not echo the
                // assembled prompt, templates, or schema in this passive tier.
                self.copy("Prompt preview/execution requires an interactive host.")?;
                for slot in &p.slots {
                    self.node(depth)?;
                    self.line(format_args!("Parameter: {}", slot.name))?;
                    if let Some(field) = &slot.field {
                        self.fields(std::slice::from_ref(field), true, depth + 1)?;
                    }
                }
            }
            Some(Body::Lro(p)) => {
                self.copy(&p.run_button_label)?;
                self.fields(&p.inputs, true, depth + 1)?;
                self.rpc("Start", p.start.as_ref())?;
                self.rpc("Finalize", p.finalize.as_ref())?;
                if let Some(table) = &p.result {
                    self.copy(
                        "Operation result unavailable until the host completes the operation.",
                    )?;
                    for column in &table.columns {
                        self.node(depth)?;
                        self.line(format_args!("Column: {}", column.header))?;
                    }
                }
            }
            Some(Body::Table(p)) => self.table(p, depth)?,
            Some(Body::Choice(p)) => {
                self.copy(&p.prompt)?;
                for (index, option) in p.options.iter().enumerate() {
                    self.node(depth)?;
                    let selected = option.id == p.default_option_id
                        || p.default_option_id.is_empty() && index == 0;
                    self.line(format_args!(
                        "Option: {}{}",
                        option.label,
                        if selected { " [default]" } else { "" }
                    ))?;
                    self.copy(&option.description)?;
                }
            }
            Some(Body::Snippet(p)) => {
                if let Some(s) = &p.snippet {
                    self.snippet(s)?;
                }
            }
            Some(Body::Action(p)) => {
                self.copy(&p.description)?;
                if let Some(a) = &p.action {
                    self.affordance(a, depth)?;
                }
            }
            Some(Body::CopyValue(p)) => {
                if let Some(v) = &p.value {
                    self.copy_value(v)?;
                }
            }
            Some(Body::ConnectFlow(p)) => {
                self.copy(&p.prompt)?;
                self.copy(&p.placeholder)?;
                if let Some(v) = &p.endpoint {
                    self.copy_value(v)?;
                }
                for target in &p.targets {
                    self.node(depth)?;
                    self.line(format_args!("Target: {} — {}", target.label, target.name))?;
                    self.copy(&target.description)?;
                    for action in &target.actions {
                        self.affordance(action, depth)?;
                    }
                    for config in &target.configs {
                        self.node(depth)?;
                        self.snippet(config)?;
                    }
                }
            }
            Some(Body::Catalog(p)) => {
                self.copy(&p.placeholder)?;
                for item in &p.items {
                    self.node(depth)?;
                    self.line(format_args!(
                        "Item: {} [{}; {}]",
                        item.name, item.tag, item.state
                    ))?;
                    self.copy(&item.description)?;
                    if let Some(a) = &item.action {
                        self.affordance(a, depth)?;
                    }
                }
            }
            Some(Body::Steps(p)) => {
                self.copy(&p.intro)?;
                for (index, step) in p.steps.iter().enumerate() {
                    self.node(depth)?;
                    self.line(format_args!(
                        "Step {}: {} — {}",
                        index + 1,
                        step.label,
                        step.actor
                    ))?;
                    self.copy(&step.detail)?;
                    self.copy(&step.media_alt)?;
                    self.copy(&step.media_uri)?;
                    if let Some(a) = &step.action {
                        self.affordance(a, depth)?;
                    }
                }
                self.copy(&p.outro)?;
            }
            Some(Body::Media(p)) => {
                self.copy(&p.alt)?;
                self.copy(&p.caption)?;
                self.line(format_args!(
                    "Source: {} [text only; duration {} ms]",
                    p.src_uri, p.duration_ms
                ))?;
                self.copy(&p.captions_uri)?;
                for chapter in &p.chapters {
                    self.node(depth)?;
                    self.line(format_args!(
                        "Chapter {} ms: {}",
                        chapter.start_ms, chapter.label
                    ))?;
                }
            }
            Some(Body::Grammar(p)) => {
                self.copy(&p.title)?;
                self.copy(&p.caption)?;
                self.copy(&p.alt)?;
                self.copy(&p.source)?;
                self.rpc("Data", p.populate.as_ref())?;
            }
            Some(Body::Terminal(p)) => {
                self.line(format_args!(
                    "Terminal: {} [requires interactive host; not connected]",
                    p.tool
                ))?;
                self.copy(&p.url)?;
            }
            Some(Body::Stream(p)) => {
                self.copy(&p.placeholder)?;
                self.rpc("Stream", p.subscribe.as_ref())?;
                self.copy("[no stream snapshot supplied]")?;
            }
            Some(Body::Stat(p)) => {
                self.copy(&p.label)?;
                self.copy(&p.caption)?;
                if p.populate.is_some() {
                    self.rpc("Value", p.populate.as_ref())?;
                    self.copy("[value requires host data]")?;
                } else {
                    if p.series.len() > self.nodes {
                        return Err(StaticViewError);
                    }
                    self.nodes -= p.series.len();
                    let computed = crate::compute_stat(p);
                    self.line(format_args!("{} {}", computed.formatted_value, p.unit))?;
                    if let Some(delta) = computed.formatted_delta {
                        self.line(format_args!("Delta: {delta} ({:?})", computed.trend))?;
                    }
                }
            }
            Some(Body::Gallery(p)) => {
                self.copy(&p.placeholder)?;
                self.rpc("Cards", p.populate.as_ref())?;
                self.copy("[gallery records require host data]")?;
            }
            Some(Body::ResourceCards(p)) => {
                self.copy(&p.empty_message)?;
                self.rpc("Cards", p.populate.as_ref())?;
                self.copy("[resource cards require host data]")?;
                if let Some(template) = &p.template {
                    for meta in &template.meta {
                        self.node(depth)?;
                        self.line(format_args!("{}: [record value unavailable]", meta.label))?;
                    }
                    if let Some(actions) = &template.actions {
                        for action in &actions.actions {
                            self.node(depth)?;
                            self.line(format_args!("Action: {}", action.label))?;
                            self.rpc("Destination", action.invoke.as_ref())?;
                        }
                    }
                }
            }
            Some(Body::Chart(p)) => {
                if let Some(c) = &p.chart {
                    self.copy(&c.title)?;
                    self.rpc("Chart rows", c.populate.as_ref())?;
                }
                self.copy("[chart rows require host data]")?;
            }
            Some(Body::Adhoc(p)) => self.line(format_args!(
                "Adhoc handler: {} [host required]",
                p.handler_id
            ))?,
            None => self.copy("Unsupported or unset panel shape.")?,
        }
        Ok(())
    }
}

/// Render authored composition without granting execution or fabricating data.
/// Tabs expand, nested views recurse, gated bodies retain placeholders, repeated
/// views show their template once. Entire output fails closed beyond depth 64,
/// 1,000 visited nodes, 4,096 newlines, or 1 MiB output. Declared masked values
/// stay hidden and controls stay inert; ordinary authored text is not redacted.
pub fn static_view_text(view: &ViewDescriptor) -> Result<String, StaticViewError> {
    let mut text = Text {
        value: String::new(),
        remaining: 1024 * 1024,
        nodes: 1000,
        lines: 4096,
    };
    text.view(view, 0)?;
    Ok(text.value)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::proto::*;

    #[test]
    fn typed_destinations_are_passive_and_do_not_disclose_copy_values() {
        use affordance::Invoke;
        let cases = [
            (Invoke::Uri("/uri".into()), "URI: /uri"),
            (Invoke::Command("command".into()), "Command: command"),
            (
                Invoke::Rpc(RpcCall {
                    service: "fixture.Service".into(),
                    method: "Delete".into(),
                    ..Default::default()
                }),
                "fixture.Service/Delete [host required; not executed]",
            ),
            (
                Invoke::Navigate(Navigate {
                    route: "/route".into(),
                }),
                "Route: /route",
            ),
            (
                Invoke::OpenPanel(Box::new(PanelDescriptor {
                    title: "nested-content-must-not-mount".into(),
                    ..Default::default()
                })),
                "Panel destination [host required; not opened]",
            ),
            (Invoke::OpenView("view-id".into()), "View: view-id"),
            (
                Invoke::Copy("clipboard-secret".into()),
                "Copy destination [value hidden; not copied]",
            ),
        ];
        for (invoke, expected) in cases {
            let mut text = Text {
                value: String::new(),
                remaining: 4096,
                nodes: 10,
                lines: 20,
            };
            text.affordance(
                &Affordance {
                    label: "Activate".into(),
                    invoke: Some(invoke),
                    ..Default::default()
                },
                0,
            )
            .unwrap();
            assert!(text.value.contains("Activate [not executed]"));
            assert!(text.value.contains(expected), "{}", text.value);
            assert!(!text.value.contains("clipboard-secret"));
            assert!(!text.value.contains("nested-content-must-not-mount"));
        }
    }

    fn slot(id: &str, position: i32) -> Slot {
        Slot {
            id: id.into(),
            title: id.into(),
            position,
            panel: Some(PanelDescriptor {
                title: format!("Panel {id}"),
                body: Some(Body::DetailHeader(DetailHeaderPanel {
                    title: format!("Content {id}"),
                    ..Default::default()
                })),
                ..Default::default()
            }),
            ..Default::default()
        }
    }
    #[test]
    fn tabs_expand_every_body_after_headers_and_persistent_regions() {
        let mut a = slot("first", -1);
        a.placement = Some(Placement {
            tab_label: "First label".into(),
            tab_position: 1,
            ..Default::default()
        });
        let mut b = slot("later", 10);
        b.placement = Some(Placement {
            tab_label: "Earlier tab".into(),
            ..Default::default()
        });
        let mut header = slot("header", 99);
        header.placement = Some(Placement {
            header_row: true,
            ..Default::default()
        });
        let view = ViewDescriptor {
            id: "root".into(),
            layout: Some(Layout {
                mode: Some(layout::Mode::Tabbed(TabbedLayout {})),
            }),
            slots: vec![a, b, slot("persistent", 0), header],
            ..Default::default()
        };
        let text = static_view_text(&view).unwrap();
        let mut previous = 0;
        for expected in [
            "Section: header",
            "Section: persistent",
            "Tab: Earlier tab",
            "Content later",
            "Tab: First label",
            "Content first",
            "End view: root",
        ] {
            let found = text.find(expected).unwrap();
            assert!(found >= previous);
            previous = found;
        }
    }
    #[test]
    fn sidebar_order_nested_precedence_and_closed_gates_are_explicit() {
        let mut side = slot("side", -5);
        side.placement = Some(Placement {
            column: 2,
            ..Default::default()
        });
        let mut nested = slot("legacy", 0);
        nested.sub_view = Some(ViewDescriptor {
            id: "child".into(),
            title: "Child view".into(),
            ..Default::default()
        });
        let mut gated = slot("closed", 2);
        gated.depends_on_selection_key = "scope".into();
        gated.depends_on_placeholder = "Choose a scope".into();
        let view = ViewDescriptor {
            layout: Some(Layout {
                mode: Some(layout::Mode::TwoColumn(TwoColumnLayout {})),
            }),
            slots: vec![side, nested, gated],
            ..Default::default()
        };
        let text = static_view_text(&view).unwrap();
        assert!(text.find("Child view").unwrap() < text.find("Sidebar").unwrap());
        assert!(!text.contains("Content legacy"));
        assert!(!text.contains("Content closed"));
        assert!(text.contains("Choose a scope"));
        assert!(text.contains("Section: side"));
    }
    #[test]
    fn marked_secrets_stay_hidden_while_raw_defaults_and_destinations_remain_inert() {
        let fields = vec![
            FormField {
                field_id: "secret".into(),
                kind: Some(form_field::Kind::Masked(MaskedInput {
                    default_value: "never-print-me".into(),
                    ..Default::default()
                })),
                ..Default::default()
            },
            FormField {
                field_id: "raw".into(),
                kind: Some(form_field::Kind::Text(TextInput {
                    default_value: "001.20".into(),
                    ..Default::default()
                })),
                ..Default::default()
            },
            FormField {
                field_id: "zero".into(),
                kind: Some(form_field::Kind::Integer(IntegerSpinner::default())),
                ..Default::default()
            },
            FormField {
                field_id: "false".into(),
                kind: Some(form_field::Kind::Boolean(BooleanToggle::default())),
                ..Default::default()
            },
        ];
        let view = ViewDescriptor {
            slots: vec![
                Slot {
                    panel: Some(PanelDescriptor {
                        body: Some(Body::Form(Box::new(FormPanel {
                            fields,
                            submit: Some(RpcCall {
                                service: "fixture".into(),
                                method: "Delete".into(),
                                ..Default::default()
                            }),
                            ..Default::default()
                        }))),
                        ..Default::default()
                    }),
                    ..Default::default()
                },
                Slot {
                    panel: Some(PanelDescriptor {
                        body: Some(Body::CopyValue(CopyValuePanel {
                            value: Some(CopyValue {
                                value: "never-print-me".into(),
                                secret: true,
                                ..Default::default()
                            }),
                        })),
                        ..Default::default()
                    }),
                    ..Default::default()
                },
            ],
            ..Default::default()
        };
        let text = static_view_text(&view).unwrap();
        assert!(!text.contains("never-print-me"));
        assert!(text.contains("[hidden]"));
        assert!(
            text.contains("001.20") && text.contains("Default: 0") && text.contains("Default: No")
        );
        assert!(text.contains("fixture/Delete [host required; not executed]"));
    }
    #[test]
    fn output_line_node_and_depth_limits_fail_closed() {
        let snippet = |content| ViewDescriptor {
            slots: vec![Slot {
                panel: Some(PanelDescriptor {
                    body: Some(Body::Snippet(SnippetPanel {
                        snippet: Some(Snippet {
                            content,
                            ..Default::default()
                        }),
                    })),
                    ..Default::default()
                }),
                ..Default::default()
            }],
            ..Default::default()
        };
        assert!(static_view_text(&snippet("x".repeat(1024 * 1024))).is_err());
        assert!(static_view_text(&snippet("\n".repeat(4097))).is_err());
        assert!(static_view_text(&ViewDescriptor {
            slots: vec![Slot::default(); 1001],
            ..Default::default()
        })
        .is_err());
        let mut view = ViewDescriptor::default();
        for _ in 0..66 {
            view = ViewDescriptor {
                slots: vec![Slot {
                    sub_view: Some(view),
                    ..Default::default()
                }],
                ..Default::default()
            };
        }
        assert!(static_view_text(&view).is_err());
    }
    #[test]
    fn terminal_control_sequences_are_literal_text_not_instructions() {
        let view = ViewDescriptor {
            title: "Hello\u{1b}[2J\u{7}".into(),
            ..Default::default()
        };
        let text = static_view_text(&view).unwrap();
        assert!(!text.contains('\u{1b}') && !text.contains('\u{7}'));
        assert!(text.contains("\\u{1b}[2J\\u{7}"));
    }
}

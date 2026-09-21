// Terminal renderers for meridian's six brand-neutral *content* shapes —
// Choice, Snippet, ActionPanel (Affordance), ConnectFlowPanel, CopyValuePanel,
// CatalogPanel. These are the static (no-RpcCall) surfaces used by landing /
// setup / "how to connect" panels; they are the TUI peers of the web-react
// htmlKit/shadcnKit content components and (eventually) a chat renderer.
//
// Like the rest of the TUI, EVERY color/modifier comes from the `Palette`
// (derived from a `meridian.theme.v1.Theme`): no `Color::` / `Style::` literal
// lives here, so one skin drives the terminal look identically to the web.
//
// Modality mapping (per the descriptor docs):
//   * Choice        → an arrow-key list; the selected option is highlighted.
//   * Snippet       → a bordered box (caption = path/label) + an OSC52 copy hint.
//   * Affordance    → a keybinding-style line ("↵ label → uri" / "$ command").
//   * ConnectFlow   → a target list (Choice) + the selected target's affordances
//                     + config snippets.
//   * CopyValue     → the value + a copy hint ("[c] copy"); secrets are masked.
//   * Catalog       → a list, one row per item (name · state — description).

use meridian_uiview::proto::{
    affordance::Invoke, Affordance, AffordanceStyle, CatalogPanel, ChartPanel, ChoicePanel,
    ConnectFlowPanel, CopyValue, CopyValuePanel, DetailHeaderPanel, GrammarPanel,
    form_field::Kind, FormField, FormMode, FormPanel, LroPanel, MediaPanel, RecordCardPanel,
    ResourceAction, ResourceCardPanel, Snippet, SnippetPanel, StatPanel, StepsPanel, StreamPanel,
};
use meridian_uiview::{compute_stat, format_value, trend_arrow, ProtoPaths, StatSemantics};
use meridian_uiview::RenderedCard;
use ratatui::layout::{Constraint, Layout, Rect};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, Borders, Paragraph, Wrap};
use ratatui::Frame;
use serde_json::Value;

use crate::theme::Palette;

/// Render an ordered walkthrough as text. Images are omitted in the terminal;
/// media_alt is retained as the accessible degradation.
pub fn render_steps(frame: &mut Frame, area: Rect, panel: &StepsPanel, palette: &Palette) {
    let mut lines = Vec::new();
    if !panel.intro.is_empty() {
        lines.push(Line::from(Span::styled(
            panel.intro.clone(),
            palette.meta(),
        )));
        lines.push(Line::from(""));
    }
    for (index, step) in panel.steps.iter().enumerate() {
        let actor = if step.actor.is_empty() {
            String::new()
        } else {
            format!(" [{}]", step.actor)
        };
        lines.push(Line::from(vec![
            Span::styled(format!("{}. ", index + 1), palette.title()),
            Span::styled(step.label.clone(), palette.text()),
            Span::styled(actor, palette.meta()),
        ]));
        if !step.detail.is_empty() {
            lines.push(Line::from(Span::styled(
                format!("   {}", step.detail),
                palette.meta(),
            )));
        } else if !step.media_alt.is_empty() {
            lines.push(Line::from(Span::styled(
                format!("   {}", step.media_alt),
                palette.meta(),
            )));
        }
    }
    if !panel.outro.is_empty() {
        lines.push(Line::from(""));
        lines.push(Line::from(Span::styled(
            panel.outro.clone(),
            palette.meta(),
        )));
    }
    frame.render_widget(Paragraph::new(lines).wrap(Wrap { trim: true }), area);
}

/// Render the static degradation of a stream when no live stream transport is
/// available. The panel's authored placeholder remains visible and the noun
/// makes the waiting state understandable on a terminal surface.
pub fn render_stream(frame: &mut Frame, area: Rect, panel: &StreamPanel, palette: &Palette) {
    let noun = if panel.item_noun.is_empty() {
        "stream"
    } else {
        &panel.item_noun
    };
    let text = if panel.placeholder.is_empty() {
        format!("Waiting for {noun}…")
    } else {
        panel.placeholder.clone()
    };
    frame.render_widget(
        Paragraph::new(Line::from(Span::styled(text, palette.meta()))).block(
            Block::default()
                .borders(Borders::ALL)
                .border_style(palette.border_style()),
        ),
        area,
    );
}

/// Render populated resources as selectable terminal cards. The TUI uses a
/// compact numbered-block degradation rather than a multi-column grid; the
/// selected row remains available through `PanelView::selected_row`, so hosts
/// can build an action request with the same `row_field` bindings as web kits.
pub fn render_resource_cards(
    frame: &mut Frame,
    area: Rect,
    panel: &ResourceCardPanel,
    rows: &[Value],
    palette: &Palette,
    selected: usize,
    error: Option<&str>,
) {
    let mut lines: Vec<Line> = Vec::new();
    if let Some(message) = error {
        lines.push(Line::from(Span::styled(message.to_string(), palette.meta())));
        frame.render_widget(bordered(lines, palette), area);
        return;
    }
    if rows.is_empty() {
        let noun = if panel.item_noun.is_empty() {
            "resources"
        } else {
            &panel.item_noun
        };
        let message = if panel.empty_message.is_empty() {
            format!("No {noun}.")
        } else {
            panel.empty_message.clone()
        };
        lines.push(Line::from(Span::styled(message, palette.meta())));
        frame.render_widget(bordered(lines, palette), area);
        return;
    }

    let Some(template) = panel.template.as_ref() else {
        lines.push(Line::from(Span::styled(
            "Invalid resource-card descriptor.",
            palette.meta(),
        )));
        frame.render_widget(bordered(lines, palette), area);
        return;
    };

    let selected = selected % rows.len();
    for (index, row) in rows.iter().enumerate() {
        let active = index == selected;
        let title_style = if active {
            palette.focused()
        } else {
            palette.header()
        };
        let marker = if active { "▶ " } else { "  " };
        lines.push(Line::from(vec![
            Span::styled(format!("{marker}{}. ", index + 1), title_style),
            Span::styled(value_at(row, &template.title_field), title_style),
        ]));

        if !template.subtitle_field.is_empty() {
            lines.push(Line::from(vec![
                Span::raw("    "),
                Span::styled(value_at(row, &template.subtitle_field), palette.meta()),
            ]));
        }
        if !template.status_field.is_empty() {
            lines.push(Line::from(vec![
                Span::raw("    status: "),
                Span::styled(value_at(row, &template.status_field), palette.title()),
            ]));
        }
        for field in &template.meta {
            lines.push(Line::from(vec![
                Span::raw("    "),
                Span::styled(format!("{}: ", field.label), palette.meta()),
                Span::styled(value_at(row, &field.field_path), palette.text()),
            ]));
        }

        let actions: Vec<&ResourceAction> = template
            .actions
            .as_ref()
            .map(|set| {
                set.actions
                    .iter()
                    .filter(|action| resource_action_visible(action, row))
                    .collect()
            })
            .unwrap_or_default();
        if !actions.is_empty() {
            let labels = actions
                .iter()
                .enumerate()
                .map(|(action_index, action)| format!("[{}] {}", action_index + 1, action.label))
                .collect::<Vec<_>>()
                .join("  ");
            lines.push(Line::from(vec![
                Span::raw("    "),
                Span::styled(labels, palette.title()),
            ]));
        }
        if index + 1 < rows.len() {
            lines.push(Line::from(""));
        }
    }
    frame.render_widget(bordered(lines, palette), area);
}

fn value_at(row: &Value, path: &str) -> String {
    format_value(
        ProtoPaths::get(row, path),
        meridian_uiview::proto::ColumnFormat::Unspecified,
    )
}

/// The shared visibility predicate used by the web kits: a deliberately small
/// equality expression keeps action availability deterministic on every surface.
pub fn resource_action_visible(action: &ResourceAction, row: &Value) -> bool {
    if action.visible_when.is_empty() {
        return true;
    }
    let Some((path, expected)) = action.visible_when.split_once("==") else {
        return false;
    };
    value_at(row, path.trim()) == expected.trim()
}

/// Render a populated gallery as a selectable terminal card list. Image slots
/// are intentionally omitted on a text surface; the card's text, icon, status,
/// link, and action label remain visible.
pub fn render_gallery(
    frame: &mut Frame,
    area: Rect,
    panel: &meridian_uiview::proto::GalleryPanel,
    cards: &[RenderedCard],
    palette: &Palette,
    selected: usize,
) {
    let mut lines: Vec<Line> = Vec::new();
    if cards.is_empty() {
        lines.push(Line::from(Span::styled(
            if panel.placeholder.is_empty() {
                "No items.".to_string()
            } else {
                panel.placeholder.clone()
            },
            palette.meta(),
        )));
        frame.render_widget(bordered(lines, palette), area);
        return;
    }

    let selected = selected % cards.len();
    for (index, card) in cards.iter().enumerate() {
        let active = index == selected;
        let style = if active {
            palette.focused()
        } else {
            palette.header()
        };
        let marker = if active { "▶ " } else { "  " };
        let mut title = vec![
            Span::styled(format!("{marker}{}. ", index + 1), style),
        ];
        if !card.icon.is_empty() {
            title.push(Span::styled(format!("{} ", glyph(&card.icon)), palette.meta()));
        }
        title.push(Span::styled(card.title.clone(), style));
        if !card.status.is_empty() {
            title.push(Span::styled(format!("  [{}]", card.status), palette.title()));
        }
        lines.push(Line::from(title));
        if !card.subtitle.is_empty() {
            lines.push(Line::from(vec![
                Span::raw("    "),
                Span::styled(card.subtitle.clone(), palette.meta()),
            ]));
        }
        if !card.action_label.is_empty() || !card.href.is_empty() {
            let label = if card.action_label.is_empty() {
                "Open"
            } else {
                &card.action_label
            };
            let mut action = vec![
                Span::raw("    "),
                Span::styled(format!("[{}] {}", index + 1, label), palette.title()),
            ];
            if !card.href.is_empty() {
                action.push(Span::styled(format!("  {}", card.href), palette.meta()));
            }
            lines.push(Line::from(action));
        }
        if index + 1 < cards.len() {
            lines.push(Line::from(""));
        }
    }
    frame.render_widget(bordered(lines, palette), area);
}

/// Render the record-bound detail header. A terminal has no chip or grid
/// primitive, so the same descriptor values become a compact labeled block.
pub fn render_detail_header(
    frame: &mut Frame,
    area: Rect,
    panel: &DetailHeaderPanel,
    record: Option<&Value>,
    palette: &Palette,
) {
    let record = record.unwrap_or(&Value::Null);
    let title = if panel.title_source_path.is_empty() {
        if panel.title.is_empty() {
            "Details".to_string()
        } else {
            panel.title.clone()
        }
    } else {
        let resolved = value_at(record, &panel.title_source_path);
        if resolved.is_empty() {
            panel.title.clone()
        } else {
            resolved
        }
    };
    let mut lines = vec![Line::from(Span::styled(title, palette.title()))];
    if !panel.subtitle_source_path.is_empty() {
        lines.push(Line::from(Span::styled(
            value_at(record, &panel.subtitle_source_path),
            palette.meta(),
        )));
    }
    if !panel.status_source_path.is_empty() {
        lines.push(Line::from(Span::styled(
            format!("[{}]", value_at(record, &panel.status_source_path)),
            palette.title(),
        )));
    }
    for row in &panel.descriptor_rows {
        lines.push(labeled_value(&row.label, &value_at(record, &row.source_path), palette));
    }
    frame.render_widget(bordered(lines, palette), area);
}

/// Render a read-only record card as a terminal key/value block.
pub fn render_record_card(
    frame: &mut Frame,
    area: Rect,
    panel: &RecordCardPanel,
    record: Option<&Value>,
    palette: &Palette,
) {
    let record = record.unwrap_or(&Value::Null);
    let lines = panel
        .fields
        .iter()
        .map(|field| {
            labeled_value(
                if field.label.is_empty() {
                    &field.field_id
                } else {
                    &field.label
                },
                &value_at(record, &field.field_id),
                palette,
            )
        })
        .collect::<Vec<_>>();
    frame.render_widget(bordered(lines, palette), area);
}

fn labeled_value(label: &str, value: &str, palette: &Palette) -> Line<'static> {
    Line::from(vec![
        Span::styled(format!("{label}: "), palette.meta()),
        Span::styled(value.to_string(), palette.text()),
    ])
}

/// Build the initial values for a FormPanel from its declared field defaults.
/// The map is keyed by `field_id`, matching `Context.form_values` and the
/// `form_field` binding source used by submit RPCs.
pub fn form_defaults(fields: &[FormField]) -> Value {
    let mut values = serde_json::Map::new();
    for field in fields {
        values.insert(field.field_id.clone(), form_field_default(field));
    }
    Value::Object(values)
}

fn form_field_default(field: &FormField) -> Value {
    match field.kind.as_ref() {
        Some(Kind::Integer(input)) => Value::from(input.default_value),
        Some(Kind::Text(input)) => Value::String(input.default_value.clone()),
        Some(Kind::EnumSelection(input)) => {
            let value = if !input.default_value.is_empty() {
                input.default_value.clone()
            } else if let Some(option) = input.options.first() {
                option.value.clone()
            } else {
                input.allowed_values.first().cloned().unwrap_or_default()
            };
            Value::String(value)
        }
        Some(Kind::Masked(input)) => Value::String(input.default_value.clone()),
        Some(Kind::Boolean(input)) => Value::Bool(input.default_value),
        Some(Kind::Number(input)) => Value::from(input.default_value),
        Some(Kind::Nested(nested)) => form_defaults(&nested.fields),
        Some(Kind::Repeated(_)) => Value::Array(Vec::new()),
        Some(Kind::KeyValueMap(_)) => Value::Object(serde_json::Map::new()),
        None => Value::Null,
    }
}

fn form_value<'a>(values: &'a Value, field_id: &str) -> &'a Value {
    values
        .get(field_id)
        .or_else(|| {
            if field_id.contains('.') {
                Some(ProtoPaths::get(values, field_id))
            } else {
                None
            }
        })
        .unwrap_or(&Value::Null)
}

fn form_value_text(field: &FormField, value: &Value) -> String {
    match field.kind.as_ref() {
        Some(Kind::Masked(_)) => {
            if value.as_str().is_some_and(|text| !text.is_empty()) {
                "••••••".to_string()
            } else {
                "(empty)".to_string()
            }
        }
        Some(Kind::Nested(_)) => "(nested object)".to_string(),
        Some(Kind::Repeated(_)) => match value.as_array() {
            Some(items) => format!("{} item{}", items.len(), if items.len() == 1 { "" } else { "s" }),
            None => "(list)".to_string(),
        },
        Some(Kind::KeyValueMap(_)) => match value.as_object() {
            Some(entries) => format!("{} entr{}", entries.len(), if entries.len() == 1 { "y" } else { "ies" }),
            None => "(map)".to_string(),
        },
        _ => {
            let text = format_value(value, meridian_uiview::proto::ColumnFormat::Unspecified);
            if text.is_empty() { "—".to_string() } else { text }
        }
    }
}

fn render_form_fields(
    lines: &mut Vec<Line<'static>>,
    fields: &[FormField],
    values: &Value,
    palette: &Palette,
    selected: &mut usize,
    next_index: &mut usize,
    indent: usize,
    selectable: bool,
) {
    for field in fields {
        let index = *next_index;
        if selectable {
            *next_index += 1;
        }
        let active = selectable && index == *selected;
        let marker = if active { "▶ " } else { "  " };
        let label = if field.label.is_empty() {
            field.field_id.as_str()
        } else {
            field.label.as_str()
        };
        let prefix = " ".repeat(indent);
        let style = if active { palette.focused() } else { palette.meta() };
        lines.push(Line::from(vec![
            Span::styled(format!("{prefix}{marker}{label}: "), style),
            Span::styled(form_value_text(field, form_value(values, &field.field_id)), palette.text()),
        ]));
        if !field.description.is_empty() {
            lines.push(Line::from(Span::styled(
                format!("{prefix}   {}", field.description),
                palette.meta(),
            )));
        }
        if let Some(Kind::Nested(nested)) = field.kind.as_ref() {
            let nested_values = form_value(values, &field.field_id);
            render_form_fields(
                lines,
                &nested.fields,
                nested_values,
                palette,
                selected,
                next_index,
                indent + 3,
                false,
            );
        }
    }
}

/// Render a FormPanel as a selectable terminal form. Scalar defaults are
/// visible and editable through `PanelView::handle_form_key`; nested, repeated,
/// and map fields remain visible as honest summaries until their richer row
/// editors are added to the shared TUI interaction model.
pub fn render_form(
    frame: &mut Frame,
    area: Rect,
    panel: &FormPanel,
    values: &Value,
    palette: &Palette,
    selected: usize,
) {
    let mut lines = Vec::new();
    let mode = if panel.mode == FormMode::Edit as i32 {
        "Edit"
    } else {
        "Read-only"
    };
    let noun = if panel.item_noun.is_empty() {
        "item"
    } else {
        panel.item_noun.as_str()
    };
    lines.push(Line::from(Span::styled(
        format!("{mode} {noun}"),
        palette.title(),
    )));
    lines.push(Line::from(Span::styled(
        if panel.mode == FormMode::Edit as i32 {
            "↑/↓ select · edit scalar · Enter submit"
        } else {
            "read-only form"
        },
        palette.meta(),
    )));
    lines.push(Line::from(""));
    let mut next_index = 0;
    let mut selected_index = selected.min(panel.fields.len().saturating_sub(1));
    render_form_fields(
        &mut lines,
        &panel.fields,
        values,
        palette,
        &mut selected_index,
        &mut next_index,
        0,
        true,
    );
    frame.render_widget(bordered(lines, palette), area);
}

/// Render the input/run half of an LRO panel. Starting the operation is a
/// renderer event; polling `google.longrunning.Operation` and rendering the
/// optional result table remain host transport responsibilities.
pub fn render_lro(
    frame: &mut Frame,
    area: Rect,
    panel: &LroPanel,
    values: &Value,
    palette: &Palette,
    selected: usize,
) {
    let mut lines = vec![Line::from(Span::styled(
        if panel.run_button_label.is_empty() { "Run".to_string() } else { panel.run_button_label.clone() },
        palette.title(),
    ))];
    lines.push(Line::from(Span::styled(
        "↑/↓ select · edit scalar · Enter start operation",
        palette.meta(),
    )));
    if panel.inputs.is_empty() {
        lines.push(Line::from(Span::styled(
            "Press Enter to start.",
            palette.meta(),
        )));
    } else {
        lines.push(Line::from(""));
        let mut selected_index = selected.min(panel.inputs.len().saturating_sub(1));
        let mut next_index = 0;
        render_form_fields(
            &mut lines,
            &panel.inputs,
            values,
            palette,
            &mut selected_index,
            &mut next_index,
            0,
            true,
        );
    }
    frame.render_widget(bordered(lines, palette), area);
}

/// Render MediaPanel's terminal degradation rung: the authored accessible
/// description, source URI, duration, captions URI, and chapter contents. A
/// terminal cannot play or display the medium, but it can preserve the useful
/// text and the link the host can copy/open.
pub fn render_media(frame: &mut Frame, area: Rect, panel: &MediaPanel, palette: &Palette) {
    let mut lines = Vec::new();
    let heading = if panel.caption.is_empty() {
        "Media"
    } else {
        panel.caption.as_str()
    };
    lines.push(Line::from(Span::styled(heading.to_string(), palette.title())));
    if !panel.alt.is_empty() {
        lines.push(Line::from(vec![
            Span::styled("Description: ".to_string(), palette.meta()),
            Span::styled(panel.alt.clone(), palette.text()),
        ]));
    } else {
        lines.push(Line::from(Span::styled(
            "No text description was provided.",
            palette.meta(),
        )));
    }
    if panel.duration_ms > 0 {
        lines.push(Line::from(Span::styled(
            format!("Duration: {}", format_duration(panel.duration_ms)),
            palette.meta(),
        )));
    }
    if !panel.captions_uri.is_empty() {
        lines.push(Line::from(vec![
            Span::styled("Captions: ".to_string(), palette.meta()),
            Span::styled(panel.captions_uri.clone(), palette.text()),
        ]));
    }
    if !panel.src_uri.is_empty() {
        lines.push(Line::from(vec![
            Span::styled("Source: ".to_string(), palette.meta()),
            Span::styled(panel.src_uri.clone(), palette.text()),
        ]));
    }
    for chapter in &panel.chapters {
        lines.push(Line::from(vec![
            Span::styled("Chapter: ".to_string(), palette.meta()),
            Span::styled(format_duration(chapter.start_ms), palette.meta()),
            Span::raw(" — "),
            Span::styled(chapter.label.clone(), palette.text()),
        ]));
    }
    frame.render_widget(bordered(lines, palette), area);
}

fn format_duration(milliseconds: u32) -> String {
    let total_seconds = milliseconds / 1000;
    format!("{:02}:{:02}", total_seconds / 60, total_seconds % 60)
}

// ── shared line builders ─────────────────────────────────────────────────────

/// Brand-neutral terminal glyph for an icon KEY. A terminal can't host the
/// host's vector glyph (the web `renderIcon` seam), so meridian maps the key to a
/// single Unicode marker — a small semantic set + a generic fallback. The key
/// itself is never lost; hosts wanting richer handling read `.icon` directly.
pub fn glyph(key: &str) -> &'static str {
    match key {
        "" => "",
        "download" | "install" | "add" => "↓",
        "link" | "open" | "external" => "↗",
        "copy" => "⧉",
        "check" | "connected" | "done" => "✓",
        "tool" | "settings" | "config" => "⚙",
        "resource" | "doc" | "guide" => "▤",
        _ => "◆",
    }
}

fn affordance_line(a: &Affordance, palette: &Palette) -> Line<'static> {
    let (marker, target) = match a.invoke.as_ref() {
        Some(Invoke::Uri(u)) => ("↵", u.clone()),
        Some(Invoke::Command(c)) => ("$", c.clone()),
        None => ("•", String::new()),
    };
    let label_style = if a.style == AffordanceStyle::Primary as i32 {
        palette.title()
    } else {
        palette.text()
    };
    let mut spans = vec![Span::styled(format!(" {marker} "), palette.title())];
    if !a.icon.is_empty() {
        spans.push(Span::styled(format!("{} ", glyph(&a.icon)), palette.meta()));
    }
    spans.push(Span::styled(a.label.clone(), label_style));
    if !target.is_empty() {
        spans.push(Span::raw("  "));
        spans.push(Span::styled(target, palette.meta()));
    }
    // Affordance.description — realized inline so it is never dropped, including
    // where an Affordance appears without an ActionPanel wrapper (CatalogItem,
    // ConnectTarget).
    if !a.description.is_empty() {
        spans.push(Span::styled(
            format!("  — {}", a.description),
            palette.meta(),
        ));
    }
    Line::from(spans)
}

fn snippet_lines(s: &Snippet, palette: &Palette) -> Vec<Line<'static>> {
    let mut out = Vec::new();
    let caption = if !s.path.is_empty() {
        s.path.clone()
    } else {
        s.label.clone()
    };
    if !caption.is_empty() {
        let mut spans = vec![Span::styled(caption, palette.meta())];
        if !s.language.is_empty() {
            spans.push(Span::styled(format!("  ({})", s.language), palette.meta()));
        }
        out.push(Line::from(spans));
    }
    for line in s.content.lines() {
        out.push(Line::from(Span::styled(line.to_string(), palette.value())));
    }
    out.push(Line::from(Span::styled(
        "[c] copy (OSC52)".to_string(),
        palette.meta(),
    )));
    out
}

fn copy_value_line(v: &CopyValue, palette: &Palette, revealed: bool) -> Line<'static> {
    // Secrets mask until revealed; copy always yields the plaintext.
    let shown = if v.secret && !revealed {
        "••••••••".to_string()
    } else {
        v.value.clone()
    };
    let mut spans = Vec::new();
    if !v.label.is_empty() {
        spans.push(Span::styled(format!("{}: ", v.label), palette.meta()));
    }
    spans.push(Span::styled(shown, palette.value()));
    spans.push(Span::styled("   [c] copy".to_string(), palette.meta()));
    if v.secret {
        let hint = if revealed {
            "  [r] hide"
        } else {
            "  [r] reveal"
        };
        spans.push(Span::styled(hint.to_string(), palette.meta()));
    }
    Line::from(spans)
}

// ── per-shape renderers ──────────────────────────────────────────────────────

/// Render a ChoicePanel as an arrow-key list. `selected` is the active option
/// index (wraps via the host's select_next/prev, mirroring table selection).
pub fn render_choice(
    frame: &mut Frame,
    area: Rect,
    panel: &ChoicePanel,
    palette: &Palette,
    selected: usize,
) {
    let mut lines: Vec<Line> = Vec::new();
    if !panel.prompt.is_empty() {
        lines.push(Line::from(Span::styled(
            panel.prompt.clone(),
            palette.meta(),
        )));
        lines.push(Line::from(""));
    }
    let sel = choice_selected_index(panel, selected);
    for (i, opt) in panel.options.iter().enumerate() {
        let active = i == sel;
        let marker = if active { "▶ " } else { "  " };
        let style = if active {
            palette.focused()
        } else {
            palette.text()
        };
        let mut spans = vec![Span::styled(marker, style)];
        if !opt.icon.is_empty() {
            spans.push(Span::styled(
                format!("{} ", glyph(&opt.icon)),
                palette.meta(),
            ));
        }
        spans.push(Span::styled(opt.label.clone(), style));
        if !opt.description.is_empty() {
            spans.push(Span::styled(
                format!("  — {}", opt.description),
                palette.meta(),
            ));
        }
        lines.push(Line::from(spans));
    }
    frame.render_widget(bordered(lines, palette), area);
}

/// Render a SnippetPanel as a bordered box.
pub fn render_snippet(frame: &mut Frame, area: Rect, panel: &SnippetPanel, palette: &Palette) {
    let lines = panel
        .snippet
        .as_ref()
        .map(|s| snippet_lines(s, palette))
        .unwrap_or_else(|| {
            vec![Line::from(Span::styled(
                "(empty snippet)".to_string(),
                palette.meta(),
            ))]
        });
    frame.render_widget(bordered(lines, palette), area);
}

/// Render an ActionPanel (a single Affordance + optional lead copy).
pub fn render_action(
    frame: &mut Frame,
    area: Rect,
    panel: &meridian_uiview::proto::ActionPanel,
    palette: &Palette,
) {
    let mut lines: Vec<Line> = Vec::new();
    if !panel.description.is_empty() {
        lines.push(Line::from(Span::styled(
            panel.description.clone(),
            palette.meta(),
        )));
        lines.push(Line::from(""));
    }
    if let Some(a) = panel.action.as_ref() {
        lines.push(affordance_line(a, palette));
    }
    frame.render_widget(bordered(lines, palette), area);
}

/// Render a CopyValuePanel. `revealed` unmasks a secret value (host toggles it
/// via `PanelView::toggle_reveal`); copy still yields the plaintext.
pub fn render_copy_value(
    frame: &mut Frame,
    area: Rect,
    panel: &CopyValuePanel,
    palette: &Palette,
    revealed: bool,
) {
    let mut lines: Vec<Line> = Vec::new();
    if let Some(v) = panel.value.as_ref() {
        lines.push(copy_value_line(v, palette, revealed));
        if !v.help.is_empty() {
            lines.push(Line::from(Span::styled(v.help.clone(), palette.meta())));
        }
    }
    frame.render_widget(bordered(lines, palette), area);
}

/// Render a CatalogPanel as a selectable list. `selected` highlights one item
/// (the host advances it via select_next/prev, and resolves its affordance via
/// `content::selected_affordance` to open/run on Enter, like table row actions).
pub fn render_catalog(
    frame: &mut Frame,
    area: Rect,
    panel: &CatalogPanel,
    palette: &Palette,
    selected: usize,
) {
    let mut lines: Vec<Line> = Vec::new();
    if panel.items.is_empty() {
        let ph = if panel.placeholder.is_empty() {
            "(empty)".to_string()
        } else {
            panel.placeholder.clone()
        };
        lines.push(Line::from(Span::styled(ph, palette.meta())));
        frame.render_widget(bordered(lines, palette), area);
        return;
    }
    let sel = if panel.items.is_empty() {
        0
    } else {
        selected % panel.items.len()
    };
    for (i, item) in panel.items.iter().enumerate() {
        let active = i == sel;
        let name_style = if active {
            palette.focused()
        } else {
            palette.header()
        };
        let mut head = vec![Span::styled(if active { "▶ " } else { "  " }, name_style)];
        if !item.icon.is_empty() {
            head.push(Span::styled(
                format!("{} ", glyph(&item.icon)),
                palette.meta(),
            ));
        }
        head.push(Span::styled(item.name.clone(), name_style));
        if !item.state.is_empty() {
            head.push(Span::styled(format!("  [{}]", item.state), palette.title()));
        }
        if !item.tag.is_empty() {
            head.push(Span::styled(format!("  {}", item.tag), palette.meta()));
        }
        lines.push(Line::from(head));
        if !item.description.is_empty() {
            lines.push(Line::from(vec![
                Span::raw("    "),
                Span::styled(item.description.clone(), palette.meta()),
            ]));
        }
        if let Some(a) = item.action.as_ref() {
            lines.push(affordance_line(a, palette));
        }
        lines.push(Line::from(""));
    }
    frame.render_widget(bordered(lines, palette), area);
}

/// Resolve the affordance the host should invoke (open the URI / run the command)
/// for the current content selection — the TUI peer of the web renderers'
/// clickable Affordance. Catalog → selected item's action; Action → its
/// affordance; ConnectFlow → the selected target's first affordance.
pub fn selected_affordance(
    body: &meridian_uiview::proto::panel_descriptor::Body,
    selected: usize,
) -> Option<&Affordance> {
    use meridian_uiview::proto::panel_descriptor::Body;
    match body {
        Body::Catalog(p) if !p.items.is_empty() => {
            p.items[selected % p.items.len()].action.as_ref()
        }
        Body::Action(p) => p.action.as_ref(),
        Body::ConnectFlow(p) if !p.targets.is_empty() => {
            p.targets[selected % p.targets.len()].actions.first()
        }
        _ => None,
    }
}

/// Render a ConnectFlowPanel: the shared endpoint, the target Choice, and the
/// selected target's affordances + config snippets. `selected` is the active
/// target index; `revealed` unmasks a secret endpoint.
pub fn render_connect_flow(
    frame: &mut Frame,
    area: Rect,
    panel: &ConnectFlowPanel,
    palette: &Palette,
    selected: usize,
    revealed: bool,
) {
    // Empty targets → prompt + endpoint + placeholder (consistent with Catalog).
    if panel.targets.is_empty() {
        let mut lines: Vec<Line> = Vec::new();
        if !panel.prompt.is_empty() {
            lines.push(Line::from(Span::styled(
                panel.prompt.clone(),
                palette.meta(),
            )));
        }
        if let Some(v) = panel.endpoint.as_ref() {
            lines.push(copy_value_line(v, palette, revealed));
        }
        let ph = if panel.placeholder.is_empty() {
            "(no targets)".to_string()
        } else {
            panel.placeholder.clone()
        };
        lines.push(Line::from(Span::styled(ph, palette.meta())));
        frame.render_widget(bordered(lines, palette), area);
        return;
    }

    let chunks = Layout::vertical([Constraint::Length(3), Constraint::Min(1)]).split(area);

    // Top: prompt + endpoint chip.
    let mut top: Vec<Line> = Vec::new();
    if !panel.prompt.is_empty() {
        top.push(Line::from(Span::styled(
            panel.prompt.clone(),
            palette.meta(),
        )));
    }
    if let Some(v) = panel.endpoint.as_ref() {
        top.push(copy_value_line(v, palette, revealed));
    }
    frame.render_widget(Paragraph::new(top).wrap(Wrap { trim: false }), chunks[0]);

    // Bottom: target list | selected target detail.
    let cols = Layout::horizontal([Constraint::Length(20), Constraint::Min(1)]).split(chunks[1]);
    let sel = connect_selected_index(panel, selected);

    // Target list (the Choice).
    let mut list: Vec<Line> = Vec::new();
    for (i, t) in panel.targets.iter().enumerate() {
        let active = i == sel;
        let style = if active {
            palette.focused()
        } else {
            palette.text()
        };
        let mut spans = vec![Span::styled(if active { "▶ " } else { "  " }, style)];
        if !t.icon.is_empty() {
            spans.push(Span::styled(format!("{} ", glyph(&t.icon)), palette.meta()));
        }
        spans.push(Span::styled(t.label.clone(), style));
        list.push(Line::from(spans));
    }
    frame.render_widget(bordered(list, palette), cols[0]);

    // Selected target detail.
    let mut detail: Vec<Line> = Vec::new();
    if let Some(t) = panel.targets.get(sel) {
        let name = if t.name.is_empty() { &t.label } else { &t.name };
        detail.push(Line::from(Span::styled(name.clone(), palette.title())));
        if !t.description.is_empty() {
            detail.push(Line::from(Span::styled(
                t.description.clone(),
                palette.meta(),
            )));
        }
        for a in &t.actions {
            detail.push(affordance_line(a, palette));
        }
        for s in &t.configs {
            detail.push(Line::from(""));
            detail.extend(snippet_lines(s, palette));
        }
    }
    frame.render_widget(bordered(detail, palette), cols[1]);
}

// ── selection helpers (wrap the active index into range) ─────────────────────

pub fn choice_selected_index(panel: &ChoicePanel, selected: usize) -> usize {
    let n = panel.options.len();
    if n == 0 {
        return 0;
    }
    // Honor default_option_id when the host hasn't moved the cursor (selected 0
    // and a default is set to a non-first option).
    if selected == 0 && !panel.default_option_id.is_empty() {
        if let Some(i) = panel
            .options
            .iter()
            .position(|o| o.id == panel.default_option_id)
        {
            return i;
        }
    }
    selected % n
}

pub fn connect_selected_index(panel: &ConnectFlowPanel, selected: usize) -> usize {
    let n = panel.targets.len();
    if n == 0 {
        return 0;
    }
    if selected == 0 && !panel.default_target_id.is_empty() {
        if let Some(i) = panel
            .targets
            .iter()
            .position(|t| t.id == panel.default_target_id)
        {
            return i;
        }
    }
    selected % n
}

// ── GrammarPanel (the TUI's capability set: text + a sparkline; no svg/raster) ─

/// GrammarLanguage → token. 1=markdown 2=mermaid 3=plantuml 4=graphviz
/// 5=vega-lite 6=vega.
pub fn grammar_language_name(language: i32) -> &'static str {
    match language {
        1 => "markdown",
        2 => "mermaid",
        3 => "plantuml",
        4 => "graphviz",
        5 => "vega-lite",
        6 => "vega",
        _ => "",
    }
}

/// Render a GrammarPanel per the TUI's capabilities. The terminal can display
/// text (and a coarse sparkline) but not svg/raster, so it simply lacks the
/// transcoders for mermaid/plantuml/graphviz/vega and DEGRADES down the ladder —
/// exactly the content-negotiation model, no modality special-casing:
///   markdown        → ANSI-styled text (native);
///   vega(-lite)     → a compact sparkline if the source carries a numeric series,
///                     else the ladder;
///   everything else → ladder: `alt` if set, else the source in a titled box.
pub fn render_grammar(frame: &mut Frame, area: Rect, panel: &GrammarPanel, palette: &Palette) {
    let lang = grammar_language_name(panel.language);
    let mut lines: Vec<Line> = Vec::new();
    if !panel.title.is_empty() {
        lines.push(Line::from(Span::styled(
            panel.title.clone(),
            palette.title(),
        )));
    }
    match lang {
        "markdown" => lines.extend(markdown_lines(&panel.source, palette)),
        "vega-lite" | "vega" => match extract_series(&panel.source) {
            Some(series) => {
                lines.push(Line::from(Span::styled(
                    sparkline(&series),
                    palette.accent_line(),
                )));
                lines.push(Line::from(Span::styled(
                    format!(
                        "{} points  min {}  max {}",
                        series.len(),
                        fmt_num(min(&series)),
                        fmt_num(max(&series))
                    ),
                    palette.meta(),
                )));
            }
            None => lines.extend(grammar_ladder(panel, lang, palette)),
        },
        _ => lines.extend(grammar_ladder(panel, lang, palette)),
    }
    if !panel.caption.is_empty() {
        lines.push(Line::from(Span::styled(
            panel.caption.clone(),
            palette.meta(),
        )));
    }
    frame.render_widget(bordered(lines, palette), area);
}

// Ladder step 2/3 for a grammar the TUI can't natively render: alt, else source.
fn grammar_ladder(panel: &GrammarPanel, lang: &str, palette: &Palette) -> Vec<Line<'static>> {
    let mut out = Vec::new();
    if !panel.alt.is_empty() {
        out.push(Line::from(Span::styled(panel.alt.clone(), palette.text())));
    } else {
        let label = if lang.is_empty() { "source" } else { lang };
        out.push(Line::from(Span::styled(
            format!("[{label}]"),
            palette.meta(),
        )));
        for line in panel.source.lines() {
            out.push(Line::from(Span::styled(line.to_string(), palette.value())));
        }
    }
    out
}

// Minimal markdown → ratatui Lines: ATX headings, fenced code, `-` lists, inline
// **bold** / `code`. The TUI-native fidelity for the "markdown is text" rung.
fn markdown_lines(source: &str, palette: &Palette) -> Vec<Line<'static>> {
    let mut out = Vec::new();
    let mut in_code = false;
    for raw in source.lines() {
        if raw.starts_with("```") {
            in_code = !in_code;
            continue;
        }
        if in_code {
            out.push(Line::from(Span::styled(raw.to_string(), palette.value())));
            continue;
        }
        if let Some(rest) = raw.strip_prefix("# ").or_else(|| raw.strip_prefix("## ")) {
            out.push(Line::from(Span::styled(rest.to_string(), palette.title())));
        } else if raw.starts_with("- ") || raw.starts_with("* ") {
            let mut spans = vec![Span::styled("  • ".to_string(), palette.meta())];
            spans.extend(inline_md(&raw[2..], palette));
            out.push(Line::from(spans));
        } else if raw.trim().is_empty() {
            out.push(Line::from(""));
        } else {
            out.push(Line::from(inline_md(raw, palette)));
        }
    }
    out
}

// Inline **bold** + `code` → styled spans.
fn inline_md(text: &str, palette: &Palette) -> Vec<Span<'static>> {
    let mut spans = Vec::new();
    let bytes = text.as_bytes();
    let mut i = 0;
    let mut plain = String::new();
    let flush = |plain: &mut String, spans: &mut Vec<Span<'static>>| {
        if !plain.is_empty() {
            spans.push(Span::styled(std::mem::take(plain), palette.text()));
        }
    };
    while i < bytes.len() {
        if text[i..].starts_with("**") {
            if let Some(end) = text[i + 2..].find("**") {
                flush(&mut plain, &mut spans);
                spans.push(Span::styled(
                    text[i + 2..i + 2 + end].to_string(),
                    palette.header(),
                ));
                i += 2 + end + 2;
                continue;
            }
        }
        if bytes[i] == b'`' {
            if let Some(end) = text[i + 1..].find('`') {
                flush(&mut plain, &mut spans);
                spans.push(Span::styled(
                    text[i + 1..i + 1 + end].to_string(),
                    palette.value(),
                ));
                i += 1 + end + 1;
                continue;
            }
        }
        let ch = text[i..].chars().next().unwrap();
        plain.push(ch);
        i += ch.len_utf8();
    }
    flush(&mut plain, &mut spans);
    spans
}

// A coarse Unicode-block sparkline for a numeric series.
fn sparkline(series: &[f64]) -> String {
    const BARS: [char; 8] = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];
    if series.is_empty() {
        return String::new();
    }
    let lo = min(series);
    let hi = max(series);
    let span = if (hi - lo).abs() < f64::EPSILON {
        1.0
    } else {
        hi - lo
    };
    series
        .iter()
        .map(|v| {
            let idx = (((v - lo) / span) * (BARS.len() as f64 - 1.0)).round() as usize;
            BARS[idx.min(BARS.len() - 1)]
        })
        .collect()
}

// Pull the first all-numeric array out of a Vega(-Lite) JSON source (e.g. an
// inline data `values`), for the sparkline. serde_json keeps it dependency-free
// of prost-types Struct traversal.
fn extract_series(source: &str) -> Option<Vec<f64>> {
    fn find(v: &serde_json::Value) -> Option<Vec<f64>> {
        match v {
            serde_json::Value::Array(a) => {
                let nums: Vec<f64> = a.iter().filter_map(serde_json::Value::as_f64).collect();
                if nums.len() == a.len() && nums.len() >= 2 {
                    return Some(nums);
                }
                a.iter().find_map(find)
            }
            serde_json::Value::Object(o) => o.values().find_map(find),
            _ => None,
        }
    }
    find(&serde_json::from_str(source).ok()?)
}

fn min(s: &[f64]) -> f64 {
    s.iter().copied().fold(f64::INFINITY, f64::min)
}
fn max(s: &[f64]) -> f64 {
    s.iter().copied().fold(f64::NEG_INFINITY, f64::max)
}
fn fmt_num(n: f64) -> String {
    if n.fract() == 0.0 {
        format!("{}", n as i64)
    } else {
        format!("{n:.2}")
    }
}

// ── StatPanel (KPI tile) — full-parity content shape ─────────────────────────

/// Render a StatPanel as a stat line: label, formatted value + unit, the
/// COMPUTED delta arrow + delta (neutral unless higher_is_better), and a Unicode
/// sparkline. Delta/trend/formatting come from the shared `compute_stat`
/// (meridian-uiview-core), identical to the web renderers — no divergence.
pub fn render_stat(frame: &mut Frame, area: Rect, panel: &StatPanel, palette: &Palette) {
    let c = compute_stat(panel);
    let mut lines: Vec<Line> = Vec::new();
    // Label.
    lines.push(Line::from(Span::styled(
        panel.label.clone(),
        palette.meta(),
    )));
    // Value + delta badge.
    let mut value_spans = vec![Span::styled(c.formatted_value.clone(), palette.title())];
    if let Some(delta) = &c.formatted_delta {
        let style = match c.semantics {
            StatSemantics::Good => palette.success_style(),
            StatSemantics::Bad => palette.danger_style(),
            StatSemantics::Neutral => palette.meta(),
        };
        let arrow = trend_arrow(c.trend);
        let badge = if arrow.is_empty() {
            delta.clone()
        } else {
            format!("{arrow} {delta}")
        };
        value_spans.push(Span::raw("   "));
        value_spans.push(Span::styled(badge, style));
    }
    lines.push(Line::from(value_spans));
    // Sparkline.
    if !c.series.is_empty() {
        lines.push(Line::from(Span::styled(
            sparkline(&c.series),
            palette.accent_line(),
        )));
    }
    // Caption.
    if !panel.caption.is_empty() {
        lines.push(Line::from(Span::styled(
            panel.caption.clone(),
            palette.meta(),
        )));
    }
    frame.render_widget(bordered(lines, palette), area);
}

/// Render a portable ChartPanel as a terminal-native summary and bounded data
/// table. The TUI does not assume a chart library; populated responses use the
/// descriptor's x/y encodings, while absent data keeps the intent summary.
pub fn render_chart(
    frame: &mut Frame,
    area: Rect,
    panel: &ChartPanel,
    palette: &Palette,
    rows: Option<&[(String, String)]>,
) {
    let Some(chart) = panel.chart.as_ref() else {
        frame.render_widget(
            bordered(vec![Line::from("Empty chart descriptor")], palette),
            area,
        );
        return;
    };
    let title = if chart.title.is_empty() {
        "Chart"
    } else {
        &chart.title
    };
    let x = chart
        .x
        .as_ref()
        .map(|e| e.field_name.as_str())
        .unwrap_or("category");
    let y = chart
        .y
        .as_ref()
        .map(|e| e.field_name.as_str())
        .unwrap_or("value");
    let mut lines = vec![
        Line::from(Span::styled(title.to_owned(), palette.title())),
        Line::from(Span::styled(format!("{} by {}", y, x), palette.meta())),
    ];
    match rows {
        Some(rows) if !rows.is_empty() => {
            lines.push(Line::from(Span::styled(
                format!("{x}  |  {y}"),
                palette.header(),
            )));
            for (category, value) in rows {
                lines.push(Line::from(vec![
                    Span::styled(category.clone(), palette.text()),
                    Span::styled("  |  ", palette.meta()),
                    Span::styled(value.clone(), palette.value()),
                ]));
            }
        }
        _ => lines.push(Line::from(Span::styled(
            "Chart data is available to an invoker-aware host.",
            palette.meta(),
        ))),
    }
    frame.render_widget(bordered(lines, palette), area);
}

/// Extract bounded chart rows from a populate response. Chart descriptors keep
/// the response path explicit so every modality can make the same projection;
/// an empty path treats the response itself as the row array.
pub fn chart_rows(
    response: &Value,
    rows_field: &str,
    x_field: &str,
    y_field: &str,
) -> Vec<(String, String)> {
    let mut value = response;
    for segment in rows_field.split('.').filter(|segment| !segment.is_empty()) {
        let Some(next) = value.get(segment) else {
            return Vec::new();
        };
        value = next;
    }
    let Some(rows) = value.as_array() else {
        return Vec::new();
    };
    rows.iter()
        .filter_map(|row| {
            let x = row.get(x_field)?.to_string_value()?;
            let y = row.get(y_field)?.to_string_value()?;
            Some((x, y))
        })
        .take(256)
        .collect()
}

trait JsonDisplayValue {
    fn to_string_value(&self) -> Option<String>;
}

impl JsonDisplayValue for Value {
    fn to_string_value(&self) -> Option<String> {
        match self {
            Value::String(value) => Some(value.clone()),
            Value::Number(value) => Some(value.to_string()),
            Value::Bool(value) => Some(value.to_string()),
            _ => None,
        }
    }
}

fn bordered(lines: Vec<Line<'static>>, palette: &Palette) -> Paragraph<'static> {
    Paragraph::new(lines)
        .wrap(Wrap { trim: false })
        .style(palette.text())
        .block(
            Block::default()
                .borders(Borders::ALL)
                .border_style(palette.border_style()),
        )
}

/// Build an OSC52 terminal escape sequence that copies `text` to the system
/// clipboard. Hosts write the returned string to the terminal (stdout) when the
/// user presses the snippet/copy key. Base64 per the OSC52 spec.
pub fn osc52(text: &str) -> String {
    let b64 = base64_encode(text.as_bytes());
    format!("\x1b]52;c;{}\x07", b64)
}

// Minimal, dependency-free base64 (standard alphabet) for the OSC52 payload —
// keeps the TUI crate's dep set unchanged.
fn base64_encode(input: &[u8]) -> String {
    const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity((input.len() + 2) / 3 * 4);
    for chunk in input.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = *chunk.get(1).unwrap_or(&0) as u32;
        let b2 = *chunk.get(2).unwrap_or(&0) as u32;
        let n = (b0 << 16) | (b1 << 8) | b2;
        out.push(ALPHABET[((n >> 18) & 63) as usize] as char);
        out.push(ALPHABET[((n >> 12) & 63) as usize] as char);
        out.push(if chunk.len() > 1 {
            ALPHABET[((n >> 6) & 63) as usize] as char
        } else {
            '='
        });
        out.push(if chunk.len() > 2 {
            ALPHABET[(n & 63) as usize] as char
        } else {
            '='
        });
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base64_matches_known_vectors() {
        assert_eq!(base64_encode(b""), "");
        assert_eq!(base64_encode(b"f"), "Zg==");
        assert_eq!(base64_encode(b"fo"), "Zm8=");
        assert_eq!(base64_encode(b"foo"), "Zm9v");
        assert_eq!(base64_encode(b"foobar"), "Zm9vYmFy");
    }

    #[test]
    fn osc52_wraps_payload() {
        let seq = osc52("hi");
        assert!(seq.starts_with("\x1b]52;c;"));
        assert!(seq.ends_with('\x07'));
        assert!(seq.contains("aGk=")); // base64("hi")
    }

    #[test]
    fn choice_index_honors_default_then_wraps() {
        use meridian_uiview::proto::ChoiceOption;
        let panel = ChoicePanel {
            options: vec![
                ChoiceOption {
                    id: "a".into(),
                    label: "A".into(),
                    description: String::new(),
                    icon: String::new(),
                },
                ChoiceOption {
                    id: "b".into(),
                    label: "B".into(),
                    description: String::new(),
                    icon: String::new(),
                },
            ],
            default_option_id: "b".into(),
            style: 0,
            prompt: String::new(),
        };
        assert_eq!(choice_selected_index(&panel, 0), 1); // default = b
        assert_eq!(choice_selected_index(&panel, 3), 1); // 3 % 2
    }

    #[test]
    fn glyph_maps_known_keys_and_falls_back() {
        assert_eq!(glyph("download"), "↓");
        assert_eq!(glyph("open"), "↗");
        assert_eq!(glyph(""), ""); // empty key → no glyph
        assert_eq!(glyph("github"), "◆"); // unknown key → generic marker
    }

    #[test]
    fn copy_value_masks_secret_until_revealed_but_still_carries_plaintext() {
        let palette = Palette::default();
        let secret = CopyValue {
            value: "sk-123".into(),
            label: "Token".into(),
            secret: true,
            help: String::new(),
        };
        // Masked when not revealed; plaintext when revealed. (`value` is always the
        // source the host copies via OSC52.)
        let masked = line_text(&copy_value_line(&secret, &palette, false));
        assert!(masked.contains("••••••••"));
        assert!(!masked.contains("sk-123"));
        let revealed = line_text(&copy_value_line(&secret, &palette, true));
        assert!(revealed.contains("sk-123"));
        assert_eq!(secret.value, "sk-123"); // copy source unchanged
    }

    #[test]
    fn selected_affordance_resolves_catalog_item_action() {
        use meridian_uiview::proto::panel_descriptor::Body;
        use meridian_uiview::proto::{affordance::Invoke, CatalogItem, CatalogPanel};
        let aff = Affordance {
            id: "open".into(),
            label: "Open".into(),
            description: String::new(),
            icon: String::new(),
            style: 0,
            invoke: Some(Invoke::Uri("https://x".into())),
        };
        let body = Body::Catalog(CatalogPanel {
            items: vec![CatalogItem {
                id: "a".into(),
                name: "A".into(),
                description: String::new(),
                tag: String::new(),
                state: String::new(),
                icon: String::new(),
                action: Some(aff),
            }],
            style: 0,
            placeholder: String::new(),
        });
        let got = selected_affordance(&body, 0).expect("catalog item affordance");
        assert_eq!(got.label, "Open");
    }

    #[test]
    fn grammar_language_name_maps_enum() {
        assert_eq!(grammar_language_name(1), "markdown");
        assert_eq!(grammar_language_name(5), "vega-lite");
        assert_eq!(grammar_language_name(6), "vega");
        assert_eq!(grammar_language_name(0), "");
    }

    #[test]
    fn markdown_renders_headings_bold_code_lists_natively() {
        let palette = Palette::default();
        let lines = markdown_lines("# Title\n\n**bold** and `code`\n\n- one\n- two", &palette);
        let text: String = lines.iter().map(line_text).collect::<Vec<_>>().join("\n");
        assert!(text.contains("Title"));
        assert!(text.contains("bold"));
        assert!(text.contains("code"));
        assert!(text.contains("• one"));
        assert!(text.contains("• two"));
    }

    #[test]
    fn sparkline_scales_a_numeric_series() {
        let s = sparkline(&[0.0, 1.0, 2.0, 3.0]);
        assert_eq!(s.chars().count(), 4);
        assert!(s.starts_with('▁')); // min → lowest bar
        assert!(s.ends_with('█')); // max → highest bar
    }

    #[test]
    fn extract_series_finds_the_first_numeric_array_in_a_vega_source() {
        let series = extract_series(r#"{"mark":"bar","data":{"values":[1,2,3,5,8]}}"#)
            .expect("numeric series");
        assert_eq!(series, vec![1.0, 2.0, 3.0, 5.0, 8.0]);
        // no array → None (falls through to the ladder).
        assert!(extract_series(r#"{"mark":"bar"}"#).is_none());
    }

    #[test]
    fn grammar_ladder_prefers_alt_then_source() {
        let palette = Palette::default();
        let with_alt = GrammarPanel {
            title: String::new(),
            caption: String::new(),
            language: 2, // mermaid
            source: "graph TD; A-->B".into(),
            data: None,
            alt: "flowchart A to B".into(),
            // ..Default: this fixture asserts the alt/source ladder, not the
            // shape of GrammarPanel. Enumerating every field made additive
            // schema growth (populate, 0.24.0) a test failure.
            ..Default::default()
        };
        let t: String = grammar_ladder(&with_alt, "mermaid", &palette)
            .iter()
            .map(line_text)
            .collect();
        assert!(t.contains("flowchart A to B"));
        assert!(!t.contains("graph TD")); // alt wins, source not shown

        let no_alt = GrammarPanel {
            alt: String::new(),
            ..with_alt
        };
        let t2: String = grammar_ladder(&no_alt, "mermaid", &palette)
            .iter()
            .map(line_text)
            .collect::<Vec<_>>()
            .join("\n");
        assert!(t2.contains("[mermaid]")); // labeled source box
        assert!(t2.contains("graph TD; A-->B"));
    }

    #[test]
    fn stat_renders_value_and_computed_down_delta() {
        use ratatui::{backend::TestBackend, Terminal};
        let panel = StatPanel {
            label: "Headcount".into(),
            value: 120.0,
            format: 1,
            unit: String::new(),
            previous: Some(150.0),
            series: vec![10.0, 8.0, 6.0, 5.0],
            delta_override: None,
            trend_override: 0,
            higher_is_better: Some(true),
            caption: String::new(),
            // ..Default: this asserts the computed down-delta, not StatPanel's
            // shape. Enumerating every field turned additive growth (populate /
            // previous_field / display_field) into a test failure.
            ..Default::default()
        };
        let palette = Palette::default();
        let mut term = Terminal::new(TestBackend::new(48, 6)).unwrap();
        term.draw(|f| render_stat(f, f.area(), &panel, &palette))
            .unwrap();
        let text: String = term
            .backend()
            .buffer()
            .content
            .iter()
            .map(|c| c.symbol())
            .collect();
        assert!(text.contains("Headcount"));
        assert!(text.contains("120"));
        assert!(text.contains('↓')); // computed DOWN, not an author arrow
        assert!(text.contains("-30")); // 120 − 150
    }

    #[test]
    fn chart_renders_portable_intent_as_terminal_summary() {
        use meridian_uiview::proto::{ChartPanel, ChartSpec, Encoding};
        use ratatui::{backend::TestBackend, Terminal};

        let panel = ChartPanel {
            chart: Some(ChartSpec {
                title: "Latency".into(),
                x: Some(Encoding {
                    field_name: "service".into(),
                    ..Default::default()
                }),
                y: Some(Encoding {
                    field_name: "p95".into(),
                    ..Default::default()
                }),
                ..Default::default()
            }),
        };
        let palette = Palette::default();
        let mut term = Terminal::new(TestBackend::new(48, 6)).unwrap();
        term.draw(|f| render_chart(f, f.area(), &panel, &palette, None))
            .unwrap();
        let text: String = term
            .backend()
            .buffer()
            .content
            .iter()
            .map(|c| c.symbol())
            .collect();
        assert!(text.contains("Latency"));
        assert!(text.contains("p95 by service"));
    }

    #[test]
    fn chart_rows_extracts_nested_response_and_bounds_output() {
        let response = serde_json::json!({
            "result": {"points": [
                {"service": "api", "p95": 42},
                {"service": "worker", "p95": 7}
            ]}
        });
        assert_eq!(
            chart_rows(&response, "result.points", "service", "p95"),
            vec![("api".into(), "42".into()), ("worker".into(), "7".into())]
        );
    }

    #[test]
    fn chart_renders_populated_rows_instead_of_summary_placeholder() {
        use meridian_uiview::proto::{ChartPanel, ChartSpec, Encoding};
        use ratatui::{backend::TestBackend, Terminal};

        let panel = ChartPanel {
            chart: Some(ChartSpec {
                title: "Latency".into(),
                x: Some(Encoding {
                    field_name: "service".into(),
                    ..Default::default()
                }),
                y: Some(Encoding {
                    field_name: "p95".into(),
                    ..Default::default()
                }),
                ..Default::default()
            }),
        };
        let rows = vec![("api".to_string(), "42".to_string())];
        let palette = Palette::default();
        let mut term = Terminal::new(TestBackend::new(48, 8)).unwrap();
        term.draw(|f| render_chart(f, f.area(), &panel, &palette, Some(&rows)))
            .unwrap();
        let text: String = term
            .backend()
            .buffer()
            .content
            .iter()
            .map(|c| c.symbol())
            .collect();
        assert!(text.contains("service  |  p95"));
        assert!(text.contains("api  |  42"));
        assert!(!text.contains("invoker-aware"));
    }

    #[test]
    fn steps_render_numbered_labels_and_details() {
        use meridian_uiview::proto::{Step, StepsPanel};
        use ratatui::{backend::TestBackend, Terminal};

        let panel = StepsPanel {
            intro: "Deploy the service".into(),
            steps: vec![
                Step {
                    label: "Open settings".into(),
                    detail: "Choose production".into(),
                    actor: "Admin".into(),
                    ..Default::default()
                },
                Step {
                    label: "Click deploy".into(),
                    ..Default::default()
                },
            ],
            outro: "Deployment started".into(),
        };
        let palette = Palette::default();
        let mut term = Terminal::new(TestBackend::new(48, 10)).unwrap();
        term.draw(|f| render_steps(f, f.area(), &panel, &palette))
            .unwrap();
        let text: String = term
            .backend()
            .buffer()
            .content
            .iter()
            .map(|c| c.symbol())
            .collect();
        assert!(text.contains("1. Open settings [Admin]"));
        assert!(text.contains("Choose production"));
        assert!(text.contains("2. Click deploy"));
        assert!(text.contains("Deployment started"));
    }

    #[test]
    fn resource_cards_render_populated_rows_and_visible_actions() {
        use meridian_uiview::proto::{
            ActionSet, ActionStyle, MetaField, ResourceAction, ResourceCardPanel,
            ResourceCardTemplate, RpcCall,
        };
        use ratatui::{backend::TestBackend, Terminal};

        let panel = ResourceCardPanel {
            populate: Some(RpcCall {
                service: "demo.Workspaces".into(),
                method: "List".into(),
                ..Default::default()
            }),
            rows_field: "workspaces".into(),
            item_noun: "workspaces".into(),
            template: Some(ResourceCardTemplate {
                title_field: "name".into(),
                subtitle_field: "owner".into(),
                status_field: "phase".into(),
                meta: vec![MetaField {
                    label: "Region".into(),
                    field_path: "region".into(),
                }],
                actions: Some(ActionSet {
                    actions: vec![
                        ResourceAction {
                            id: "launch".into(),
                            label: "Launch".into(),
                            style: ActionStyle::Primary as i32,
                            visible_when: "phase==Stopped".into(),
                            ..Default::default()
                        },
                        ResourceAction {
                            id: "stop".into(),
                            label: "Stop".into(),
                            visible_when: "phase==Running".into(),
                            ..Default::default()
                        },
                    ],
                }),
            }),
            ..Default::default()
        };
        let rows = vec![
            serde_json::json!({"name":"api-prod","owner":"platform","phase":"Running","region":"us-east"}),
            serde_json::json!({"name":"worker-dev","owner":"infra","phase":"Stopped","region":"us-west"}),
        ];
        let palette = Palette::default();
        let mut term = Terminal::new(TestBackend::new(72, 16)).unwrap();
        term.draw(|f| render_resource_cards(f, f.area(), &panel, &rows, &palette, 0, None))
            .unwrap();
        let text: String = term
            .backend()
            .buffer()
            .content
            .iter()
            .map(|c| c.symbol())
            .collect();
        assert!(text.contains("api-prod"));
        assert!(text.contains("status: Running"));
        assert!(text.contains("Region: us-east"));
        assert!(text.contains("[1] Stop"));
        assert!(text.contains("[1] Launch"));
        assert!(resource_action_visible(
            &panel.template.as_ref().unwrap().actions.as_ref().unwrap().actions[0],
            &rows[1]
        ));
        assert!(!resource_action_visible(
            &panel.template.as_ref().unwrap().actions.as_ref().unwrap().actions[0],
            &rows[0]
        ));
    }

    #[test]
    fn gallery_renders_populated_cards_as_selectable_text() {
        use meridian_uiview::proto::{CardSpec, GalleryPanel, RpcCall};
        use ratatui::{backend::TestBackend, Terminal};

        let panel = GalleryPanel {
            populate: Some(RpcCall {
                service: "demo.Catalog".into(),
                method: "List".into(),
                ..Default::default()
            }),
            rows_field: "items".into(),
            placeholder: "No integrations".into(),
            card: Some(CardSpec {
                title_field: "name".into(),
                subtitle_field: "description".into(),
                icon_field: "icon".into(),
                status_field: "status".into(),
                href_field: "href".into(),
                action_label_field: "action".into(),
                ..Default::default()
            }),
        };
        let response = serde_json::json!({
            "items": [{
                "name": "GitHub",
                "description": "Source control",
                "icon": "github",
                "status": "Connected",
                "href": "https://github.com",
                "action": "Manage"
            }]
        });
        let cards = meridian_uiview::render_gallery(&response, &panel);
        let palette = Palette::default();
        let mut term = Terminal::new(TestBackend::new(72, 9)).unwrap();
        term.draw(|f| render_gallery(f, f.area(), &panel, &cards, &palette, 0))
            .unwrap();
        let text: String = term
            .backend()
            .buffer()
            .content
            .iter()
            .map(|c| c.symbol())
            .collect();
        assert!(text.contains("GitHub"));
        assert!(text.contains("Source control"));
        assert!(text.contains("[Connected]"));
        assert!(text.contains("Manage"));
        assert!(text.contains("https://github.com"));
    }

    #[test]
    fn detail_header_and_record_card_render_dotted_record_values() {
        use meridian_uiview::proto::{
            DescriptorRow, DetailHeaderPanel, FormField, RecordCardPanel,
        };
        use ratatui::{backend::TestBackend, Terminal};

        let record = serde_json::json!({
            "name": "Build 42",
            "owner": "Platform",
            "phase": "Running",
            "metadata": {"region": "us-east"}
        });
        let header = DetailHeaderPanel {
            title: "Build".into(),
            title_source_path: "name".into(),
            subtitle_source_path: "owner".into(),
            status_source_path: "phase".into(),
            descriptor_rows: vec![DescriptorRow {
                label: "Region".into(),
                source_path: "metadata.region".into(),
                ..Default::default()
            }],
            ..Default::default()
        };
        let card = RecordCardPanel {
            item_noun: "build".into(),
            fields: vec![
                FormField {
                    field_id: "name".into(),
                    label: "Name".into(),
                    ..Default::default()
                },
                FormField {
                    field_id: "metadata.region".into(),
                    label: "Region".into(),
                    ..Default::default()
                },
            ],
            ..Default::default()
        };
        let palette = Palette::default();
        let mut header_term = Terminal::new(TestBackend::new(64, 8)).unwrap();
        header_term
            .draw(|f| render_detail_header(f, f.area(), &header, Some(&record), &palette))
            .unwrap();
        let header_text: String = header_term
            .backend()
            .buffer()
            .content
            .iter()
            .map(|c| c.symbol())
            .collect();
        assert!(header_text.contains("Build 42"));
        assert!(header_text.contains("[Running]"));
        assert!(header_text.contains("Region: us-east"));

        let mut card_term = Terminal::new(TestBackend::new(64, 8)).unwrap();
        card_term
            .draw(|f| render_record_card(f, f.area(), &card, Some(&record), &palette))
            .unwrap();
        let card_text: String = card_term
            .backend()
            .buffer()
            .content
            .iter()
            .map(|c| c.symbol())
            .collect();
        assert!(card_text.contains("Name: Build 42"));
        assert!(card_text.contains("Region: us-east"));
    }

    #[test]
    fn stream_renders_placeholder_and_default_noun() {
        use meridian_uiview::proto::StreamPanel;
        use ratatui::{backend::TestBackend, Terminal};

        let panel = StreamPanel {
            placeholder: "Waiting for build output".into(),
            ..Default::default()
        };
        let palette = Palette::default();
        let mut term = Terminal::new(TestBackend::new(48, 5)).unwrap();
        term.draw(|f| render_stream(f, f.area(), &panel, &palette))
            .unwrap();
        let text: String = term
            .backend()
            .buffer()
            .content
            .iter()
            .map(|c| c.symbol())
            .collect();
        assert!(text.contains("Waiting for build output"));

        let panel = StreamPanel {
            item_noun: "events".into(),
            ..Default::default()
        };
        let mut term = Terminal::new(TestBackend::new(48, 5)).unwrap();
        term.draw(|f| render_stream(f, f.area(), &panel, &palette))
            .unwrap();
        let text: String = term
            .backend()
            .buffer()
            .content
            .iter()
            .map(|c| c.symbol())
            .collect();
        assert!(text.contains("Waiting for events"));
    }

    // Concatenate a Line's span contents for assertions.
    fn line_text(line: &Line) -> String {
        line.spans.iter().map(|s| s.content.as_ref()).collect()
    }
}

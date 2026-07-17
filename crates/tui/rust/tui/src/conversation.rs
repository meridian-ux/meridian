// Terminal renderer for `meridian.ui.v1` conversations — the agent chat.
//
// The TUI peer of @savvifi/meridian-chat's `<m-assistant-panel>` / `<Conversation>`:
// the SAME ConversationEvent stream, folded by the SAME model
// (meridian_uiview::ConversationModel — the shared core, not a second
// implementation), painted with ratatui instead of the DOM. A tool block that
// flips RUNNING→OK replaces in place here exactly as it does in the browser,
// because both tiers upsert through that one model.
//
// This renderer draws a transcript; it owns no transport. The web tier's
// EventSource has no terminal analog worth inventing — a host already has its own
// runtime, so it feeds `ConversationModel::ingest` from whatever stream it has
// (SSE, gRPC, a channel) and draws. That keeps this module pure and testable.
//
// Like the rest of the TUI, EVERY color/modifier comes from the `Palette`, so one
// skin drives the terminal look identically to the web.
//
// Modality mapping (the web block kinds → terminal shapes):
//   * markdown  → wrapped text; the `**bold**` / `` `code` `` inline markers the
//                 web's mdInline honors become bold / code-styled spans.
//   * context   → a muted provenance line (glyph + text).
//   * tool      → a state marker (◐ running / ✓ ok / ✗ error) + name + args + summary.
//   * list      → a heading + one line per item (title · subtitle [badges]).
//   * fields    → aligned key/value pairs.
//   * code      → an indented block in the code style (language as a caption).
//   * divider   → a hairline.
//   * table     → aligned columns with a header row.

use meridian_uiview::proto::{block, Block, Status};
use meridian_uiview::ConversationModel;
use ratatui::layout::Rect;
use ratatui::style::{Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Paragraph, Wrap};
use ratatui::Frame;

use crate::content::glyph;
use crate::theme::Palette;

/// Marker for a tool block's state — the terminal peer of the web renderer's
/// spinner / ok-dot / error-dot.
fn tool_marker(state: i32) -> &'static str {
    match block::tool_block::State::try_from(state) {
        Ok(block::tool_block::State::Ok) => "✓",
        Ok(block::tool_block::State::Error) => "✗",
        // RUNNING (and anything unrecognized — a newer state we don't know yet
        // is still in flight as far as this renderer is concerned).
        _ => "◐",
    }
}

/// Inline markdown → styled spans. Mirrors the two markers @savvifi/meridian-chat's
/// `mdInline` (dom.ts) honors — `**bold**` and `` `code` `` — with newlines splitting
/// lines. Everything else is literal text, in both tiers. Earliest marker wins, so a
/// marker nested inside another renders literally rather than recursing.
fn md_lines(text: &str, palette: &Palette, base: Style) -> Vec<Line<'static>> {
    text.split('\n')
        .map(|line| Line::from(md_spans(line, palette, base)))
        .collect()
}

fn md_spans(line: &str, palette: &Palette, base: Style) -> Vec<Span<'static>> {
    let chars: Vec<char> = line.chars().collect();
    let mut spans: Vec<Span<'static>> = Vec::new();
    let mut literal = String::new();
    let mut i = 0usize;

    // Find the closing marker for a span opened at `from`, rejecting the run if
    // the content contains `reject` (mirrors the web regexes' [^*]+ / [^`]+).
    let closer = |from: usize, marker: &[char], reject: char| -> Option<usize> {
        let mut j = from;
        while j + marker.len() <= chars.len() {
            if chars[j..j + marker.len()] == *marker {
                return if j > from { Some(j) } else { None };
            }
            if chars[j] == reject {
                return None;
            }
            j += 1;
        }
        None
    };

    while i < chars.len() {
        // **bold**
        if i + 1 < chars.len() && chars[i] == '*' && chars[i + 1] == '*' {
            if let Some(end) = closer(i + 2, &['*', '*'], '*') {
                if !literal.is_empty() {
                    spans.push(Span::styled(std::mem::take(&mut literal), base));
                }
                let inner: String = chars[i + 2..end].iter().collect();
                spans.push(Span::styled(inner, base.add_modifier(Modifier::BOLD)));
                i = end + 2;
                continue;
            }
        }
        // `code`
        if chars[i] == '`' {
            if let Some(end) = closer(i + 1, &['`'], '\n') {
                if !literal.is_empty() {
                    spans.push(Span::styled(std::mem::take(&mut literal), base));
                }
                let inner: String = chars[i + 1..end].iter().collect();
                spans.push(Span::styled(inner, palette.value()));
                i = end + 1;
                continue;
            }
        }
        literal.push(chars[i]);
        i += 1;
    }
    if !literal.is_empty() {
        spans.push(Span::styled(literal, base));
    }
    if spans.is_empty() {
        spans.push(Span::styled(String::new(), base));
    }
    spans
}

/// One block → its terminal lines. Pure, so the mapping is testable without a TTY.
pub fn block_lines(block: &Block, palette: &Palette) -> Vec<Line<'static>> {
    // `role` drives bubble alignment on the web; a terminal transcript reads top
    // to bottom, so the role becomes a speaker marker instead.
    let is_user = block.role == "user";
    let base = if is_user { palette.meta() } else { palette.text() };

    match block.kind.as_ref() {
        Some(block::Kind::Markdown(md)) => {
            let mut lines = md_lines(&md.text, palette, base);
            if let Some(first) = lines.first_mut() {
                let marker = if is_user { "› " } else { "  " };
                first.spans.insert(0, Span::styled(marker, palette.title()));
            }
            lines
        }
        Some(block::Kind::Context(ctx)) => {
            let mut spans = vec![Span::styled("  ", palette.meta())];
            if !ctx.icon.is_empty() {
                spans.push(Span::styled(format!("{} ", glyph(&ctx.icon)), palette.meta()));
            }
            spans.push(Span::styled(ctx.text.clone(), palette.meta()));
            vec![Line::from(spans)]
        }
        Some(block::Kind::Tool(tool)) => {
            let is_error =
                block::tool_block::State::try_from(tool.state) == Ok(block::tool_block::State::Error);
            let marker_style = if is_error {
                palette.danger_style()
            } else {
                palette.success_style()
            };
            let mut spans = vec![
                Span::styled(format!("  {} ", tool_marker(tool.state)), marker_style),
                Span::styled(tool.name.clone(), palette.header()),
            ];
            // The web hides an empty args object rather than printing "{}".
            if !tool.args_json.is_empty() && tool.args_json != "{}" {
                spans.push(Span::styled(format!(" {}", tool.args_json), palette.meta()));
            }
            if !tool.summary.is_empty() {
                spans.push(Span::styled(format!(" — {}", tool.summary), palette.meta()));
            }
            vec![Line::from(spans)]
        }
        Some(block::Kind::List(list)) => {
            let mut lines = Vec::new();
            if !list.title.is_empty() {
                lines.push(Line::styled(format!("  {}", list.title), palette.header()));
            }
            for item in &list.items {
                let mut spans = vec![Span::styled("   • ", palette.meta())];
                if !item.icon.is_empty() {
                    spans.push(Span::styled(format!("{} ", glyph(&item.icon)), palette.meta()));
                }
                spans.push(Span::styled(item.title.clone(), base));
                if !item.subtitle.is_empty() {
                    spans.push(Span::styled(format!("  {}", item.subtitle), palette.meta()));
                }
                for badge in &item.badges {
                    spans.push(Span::styled(format!("  [{badge}]"), palette.accent_line()));
                }
                lines.push(Line::from(spans));
            }
            lines
        }
        Some(block::Kind::Fields(fields)) => {
            let width = fields
                .fields
                .iter()
                .map(|f| f.key.chars().count())
                .max()
                .unwrap_or(0);
            fields
                .fields
                .iter()
                .map(|f| {
                    Line::from(vec![
                        Span::styled(
                            format!("  {:width$}  ", f.key, width = width),
                            palette.meta(),
                        ),
                        Span::styled(f.value.clone(), base),
                    ])
                })
                .collect()
        }
        Some(block::Kind::Code(code)) => {
            let mut lines = Vec::new();
            if !code.language.is_empty() {
                lines.push(Line::styled(format!("  {}", code.language), palette.meta()));
            }
            lines.extend(
                code.text
                    .split('\n')
                    .map(|l| Line::styled(format!("  │ {l}"), palette.value())),
            );
            lines
        }
        Some(block::Kind::Divider(_)) => {
            vec![Line::styled("  ────────", palette.border_style())]
        }
        Some(block::Kind::Table(table)) => table_lines(table, palette, base),
        // A block kind this renderer doesn't know (a newer schema than this
        // build) still occupies its slot — visibly, rather than vanishing.
        None => vec![Line::styled("  (empty block)", palette.meta())],
    }
}

fn table_lines(table: &block::Table, palette: &Palette, base: Style) -> Vec<Line<'static>> {
    let mut lines = Vec::new();
    if !table.title.is_empty() {
        lines.push(Line::styled(format!("  {}", table.title), palette.header()));
    }
    // The web falls back to the column key when there's no label.
    let headers: Vec<String> = table
        .columns
        .iter()
        .map(|c| {
            if c.label.is_empty() {
                c.key.clone()
            } else {
                c.label.clone()
            }
        })
        .collect();
    // Size each column to the widest of its header and its cells.
    let widths: Vec<usize> = table
        .columns
        .iter()
        .enumerate()
        .map(|(i, col)| {
            let cells = table
                .rows
                .iter()
                .map(|r| r.cells.get(&col.key).map(|v| v.chars().count()).unwrap_or(0))
                .max()
                .unwrap_or(0);
            cells.max(headers[i].chars().count())
        })
        .collect();

    lines.push(Line::styled(
        format!(
            "  {}",
            headers
                .iter()
                .enumerate()
                .map(|(i, h)| format!("{:width$}", h, width = widths[i]))
                .collect::<Vec<_>>()
                .join("  ")
        ),
        palette.header(),
    ));
    for row in &table.rows {
        lines.push(Line::styled(
            format!(
                "  {}",
                table
                    .columns
                    .iter()
                    .enumerate()
                    .map(|(i, col)| {
                        let v = row.cells.get(&col.key).cloned().unwrap_or_default();
                        format!("{:width$}", v, width = widths[i])
                    })
                    .collect::<Vec<_>>()
                    .join("  ")
            ),
            base,
        ));
    }
    lines
}

/// The transient status line (the peer of the web's thinking/working indicator).
pub fn status_line(status: &Status, palette: &Palette) -> Line<'static> {
    let detail = if status.detail.is_empty() {
        "Working…".to_string()
    } else {
        status.detail.clone()
    };
    Line::from(vec![
        Span::styled("  ◐ ", palette.accent_line()),
        Span::styled(detail, palette.meta()),
    ])
}

/// Every line of the transcript: the blocks, then the live status / last error.
pub fn conversation_lines(
    model: &ConversationModel,
    palette: &Palette,
    empty_state: &str,
) -> Vec<Line<'static>> {
    let blocks = model.blocks();
    if blocks.is_empty() && model.status().is_none() && model.error().is_none() {
        return vec![Line::styled(format!("  {empty_state}"), palette.meta())];
    }
    let mut lines = Vec::new();
    for block in blocks {
        lines.extend(block_lines(block, palette));
    }
    if let Some(status) = model.status() {
        lines.push(status_line(status, palette));
    }
    if let Some(error) = model.error() {
        lines.push(Line::styled(format!("  ✗ {error}"), palette.danger_style()));
    }
    lines
}

/// Render a conversation transcript into `area`, tailing the newest lines when
/// the transcript is taller than the viewport (a terminal transcript scrolls to
/// the bottom, as the web log does).
pub fn render_conversation(
    frame: &mut Frame,
    area: Rect,
    model: &ConversationModel,
    palette: &Palette,
    empty_state: &str,
) {
    let lines = conversation_lines(model, palette, empty_state);
    let height = area.height as usize;
    let scroll = lines.len().saturating_sub(height) as u16;
    frame.render_widget(
        Paragraph::new(lines)
            .wrap(Wrap { trim: false })
            .scroll((scroll, 0)),
        area,
    );
}

#[cfg(test)]
mod tests {
    use super::*;
    use meridian_uiview::proto::{conversation_event, status, ConversationEvent};

    fn palette() -> Palette {
        Palette::default()
    }

    fn text_of(line: &Line<'_>) -> String {
        line.spans.iter().map(|s| s.content.as_ref()).collect()
    }

    fn block_of(kind: block::Kind) -> Block {
        Block {
            block_id: "b1".into(),
            role: "assistant".into(),
            kind: Some(kind),
        }
    }

    #[test]
    fn markdown_honors_the_same_two_inline_markers_as_the_web() {
        let b = block_of(block::Kind::Markdown(block::Markdown {
            text: "a **bold** and `code` here".into(),
        }));
        let lines = block_lines(&b, &palette());
        assert_eq!(text_of(&lines[0]), "  a bold and code here");
        // The markers are consumed into styling, not left as literal text.
        let bolded = lines[0]
            .spans
            .iter()
            .find(|s| s.content == "bold")
            .expect("a bold span");
        assert!(bolded.style.add_modifier.contains(Modifier::BOLD));
    }

    #[test]
    fn markdown_splits_on_newlines() {
        let b = block_of(block::Kind::Markdown(block::Markdown {
            text: "one\ntwo".into(),
        }));
        let lines = block_lines(&b, &palette());
        assert_eq!(lines.len(), 2);
        assert_eq!(text_of(&lines[1]), "two");
    }

    #[test]
    fn unclosed_marker_stays_literal() {
        let b = block_of(block::Kind::Markdown(block::Markdown {
            text: "2 ** 3 = ?".into(),
        }));
        let lines = block_lines(&b, &palette());
        assert_eq!(text_of(&lines[0]), "  2 ** 3 = ?");
    }

    #[test]
    fn tool_state_drives_the_marker() {
        let running = block_of(block::Kind::Tool(block::ToolBlock {
            name: "forge·list_repos".into(),
            state: block::tool_block::State::Running as i32,
            ..Default::default()
        }));
        assert!(text_of(&block_lines(&running, &palette())[0]).contains("◐"));

        let ok = block_of(block::Kind::Tool(block::ToolBlock {
            name: "forge·list_repos".into(),
            state: block::tool_block::State::Ok as i32,
            summary: "12 repos".into(),
            ..Default::default()
        }));
        let line = text_of(&block_lines(&ok, &palette())[0]);
        assert!(line.contains("✓"), "{line}");
        assert!(line.contains("12 repos"), "{line}");
    }

    #[test]
    fn empty_tool_args_are_hidden_as_on_the_web() {
        let b = block_of(block::Kind::Tool(block::ToolBlock {
            name: "t".into(),
            args_json: "{}".into(),
            ..Default::default()
        }));
        assert!(!text_of(&block_lines(&b, &palette())[0]).contains("{}"));
    }

    #[test]
    fn table_falls_back_to_the_column_key_and_aligns() {
        let mut cells = std::collections::HashMap::new();
        cells.insert("name".to_string(), "alpha".to_string());
        cells.insert("state".to_string(), "ok".to_string());
        let b = block_of(block::Kind::Table(block::Table {
            title: String::new(),
            columns: vec![
                block::Column {
                    key: "name".into(),
                    label: "Name".into(),
                },
                // No label ⇒ the header shows the key.
                block::Column {
                    key: "state".into(),
                    label: String::new(),
                },
            ],
            rows: vec![block::Row { cells }],
        }));
        let lines = block_lines(&b, &palette());
        assert_eq!(text_of(&lines[0]), "  Name   state");
        assert_eq!(text_of(&lines[1]), "  alpha  ok   ");
    }

    #[test]
    fn a_missing_cell_renders_as_blank_not_a_dropped_column() {
        let b = block_of(block::Kind::Table(block::Table {
            title: String::new(),
            columns: vec![
                block::Column { key: "a".into(), label: "A".into() },
                block::Column { key: "b".into(), label: "B".into() },
            ],
            rows: vec![block::Row {
                cells: std::collections::HashMap::new(),
            }],
        }));
        let lines = block_lines(&b, &palette());
        // The row still occupies both columns' width — blank cells, not a
        // collapsed row that silently loses its alignment with the header.
        assert_eq!(text_of(&lines[0]), "  A  B");
        assert_eq!(text_of(&lines[1]).len(), text_of(&lines[0]).len());
        assert!(text_of(&lines[1]).trim().is_empty());
    }

    #[test]
    fn fields_align_on_the_widest_key() {
        let b = block_of(block::Kind::Fields(block::Fields {
            fields: vec![
                block::Field { key: "id".into(), value: "1".into() },
                block::Field { key: "longer".into(), value: "2".into() },
            ],
        }));
        let lines = block_lines(&b, &palette());
        assert_eq!(text_of(&lines[0]), "  id      1");
        assert_eq!(text_of(&lines[1]), "  longer  2");
    }

    #[test]
    fn transcript_reflects_the_shared_models_upsert() {
        let mut model = ConversationModel::new();
        let running = ConversationEvent {
            seq: 1,
            event: Some(conversation_event::Event::Block(block_of(block::Kind::Tool(
                block::ToolBlock {
                    name: "t".into(),
                    state: block::tool_block::State::Running as i32,
                    ..Default::default()
                },
            )))),
        };
        model.ingest(&running);
        let done = ConversationEvent {
            seq: 2,
            event: Some(conversation_event::Event::Block(block_of(block::Kind::Tool(
                block::ToolBlock {
                    name: "t".into(),
                    state: block::tool_block::State::Ok as i32,
                    ..Default::default()
                },
            )))),
        };
        model.ingest(&done);
        // Same block_id ⇒ ONE line, flipped — not two.
        let lines = conversation_lines(&model, &palette(), "empty");
        assert_eq!(lines.len(), 1);
        assert!(text_of(&lines[0]).contains("✓"));
    }

    #[test]
    fn status_and_error_trail_the_transcript() {
        let mut model = ConversationModel::new();
        model.ingest(&ConversationEvent {
            seq: 1,
            event: Some(conversation_event::Event::Status(Status {
                state: status::State::Working as i32,
                detail: "Calling forge·list_repos".into(),
            })),
        });
        let lines = conversation_lines(&model, &palette(), "empty");
        assert!(text_of(lines.last().unwrap()).contains("Calling forge·list_repos"));
    }

    #[test]
    fn empty_state_shows_until_the_first_block() {
        let model = ConversationModel::new();
        let lines = conversation_lines(&model, &palette(), "Ask about your repos");
        assert_eq!(text_of(&lines[0]), "  Ask about your repos");
    }
}

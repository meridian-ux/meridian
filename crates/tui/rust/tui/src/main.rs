//! `meridian-tui` — render a `meridian.ui.v1.PanelDescriptor` in a terminal.
//!
//! This is the first executable in the estate. Until the monorepo merge there
//! could not be one: the crate depended on `meridian_uiview` and `theme_proto`,
//! which only Bazel's `rust_prost_library` produced, so `cargo build` of this
//! crate was not merely unwired but impossible — there was nothing to run.
//!
//! It reads a descriptor off disk rather than talking to a `LayoutService`,
//! deliberately. `LayoutService` has two servers and zero clients today, and a
//! renderer that can only be exercised by standing up a backend is a renderer
//! nobody exercises. A `.binpb` on disk is what the conformance corpus emits and
//! what `//packages/web/bazel:panel_bundle` already builds from textproto, so the
//! same fixture drives the terminal and the browser.
//!
//! ```text
//! meridian-tui panel.binpb              # render a PanelDescriptor
//! meridian-tui panel.binpb --theme t.binpb --dark
//! ```
//!
//! Keys: ↑/↓ or j/k move the selection, r reveals a masked value, q or Esc quits.

use std::io::{self, IsTerminal as _};
use std::path::PathBuf;
use std::process::ExitCode;

use crossterm::event::{self, Event, KeyCode, KeyEventKind};
use crossterm::terminal::{disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen};
use crossterm::execute;
use prost::Message as _;
use ratatui::backend::CrosstermBackend;
use ratatui::Terminal;

use meridian_tui::{Mode, Palette, PanelView, RpcError, RpcInvoker, Theme};
use meridian_uiview::proto::PanelDescriptor;
use meridian_uiview::Context;

/// The renderer draws; the host wires. With no backend to dial, every call is
/// refused — and refused LOUDLY rather than returning `{}`, because a silent
/// empty response renders as a panel that looks like it worked.
///
/// This mirrors the seam the web renderers use, and it is deliberately the same
/// posture as `meridian-schemas`' admission gate: reads are what a descriptor
/// fires automatically on mount, and a viewer with no backend must not appear to
/// have satisfied them.
struct OfflineInvoker;

impl RpcInvoker for OfflineInvoker {
    fn invoke(
        &self,
        service: &str,
        method: &str,
        _request: serde_json::Value,
    ) -> Result<serde_json::Value, RpcError> {
        Err(RpcError::Transport(format!(
            "{service}/{method}: meridian-tui renders descriptors offline and has no transport. \
             Populate the data into the descriptor, or embed this crate and supply an RpcInvoker."
        )))
    }
}

struct Args {
    descriptor: PathBuf,
    theme: Option<PathBuf>,
    mode: Mode,
}

fn parse_args() -> Result<Args, String> {
    let mut descriptor = None;
    let mut theme = None;
    let mut mode = Mode::Dark;
    let mut it = std::env::args().skip(1);
    while let Some(a) = it.next() {
        match a.as_str() {
            "-h" | "--help" => return Err(String::new()),
            "--dark" => mode = Mode::Dark,
            "--light" => mode = Mode::Light,
            "--theme" => {
                theme = Some(PathBuf::from(
                    it.next().ok_or("--theme needs a path to a meridian.theme.v1.Theme .binpb")?,
                ))
            }
            other if other.starts_with('-') => return Err(format!("unknown flag {other}")),
            other => {
                if descriptor.is_some() {
                    return Err(format!("unexpected second positional argument {other}"));
                }
                descriptor = Some(PathBuf::from(other));
            }
        }
    }
    Ok(Args {
        descriptor: descriptor.ok_or("no descriptor given")?,
        theme,
        mode,
    })
}

const USAGE: &str = "\
meridian-tui — render a meridian.ui.v1.PanelDescriptor in a terminal

USAGE:
    meridian-tui <descriptor.binpb> [--theme <theme.binpb>] [--light|--dark]

The descriptor is a wire-format PanelDescriptor: the same bytes the conformance
fixtures emit and the web renderer's panel bundles are built from.

KEYS:
    up/down, j/k    move the selection
    r               reveal a masked value
    q, Esc          quit
";

fn main() -> ExitCode {
    let args = match parse_args() {
        Ok(a) => a,
        Err(msg) => {
            if msg.is_empty() {
                print!("{USAGE}");
                return ExitCode::SUCCESS;
            }
            eprintln!("meridian-tui: {msg}\n\n{USAGE}");
            return ExitCode::from(2);
        }
    };

    match run(args) {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("meridian-tui: {e}");
            ExitCode::FAILURE
        }
    }
}

fn run(args: Args) -> Result<(), String> {
    let bytes = std::fs::read(&args.descriptor)
        .map_err(|e| format!("reading {}: {e}", args.descriptor.display()))?;
    let descriptor = PanelDescriptor::decode(bytes.as_slice()).map_err(|e| {
        format!(
            "{} is not a wire-format meridian.ui.v1.PanelDescriptor: {e}",
            args.descriptor.display()
        )
    })?;

    let palette = match &args.theme {
        Some(p) => {
            let b = std::fs::read(p).map_err(|e| format!("reading {}: {e}", p.display()))?;
            let theme = Theme::decode(b.as_slice()).map_err(|e| {
                format!("{} is not a meridian.theme.v1.Theme: {e}", p.display())
            })?;
            Palette::from_theme(&theme, args.mode)
        }
        // Palette::default() is brand-neutral by design — the fastverk look ships
        // from @brand as a Theme rather than being baked in here.
        None => Palette::default(),
    };

    // Refuse to take over a terminal that isn't one. Piping this into a file
    // would otherwise emit alternate-screen escapes and look like a hang.
    if !io::stdout().is_terminal() {
        return Err("stdout is not a terminal; meridian-tui draws an interactive view".into());
    }

    enable_raw_mode().map_err(|e| format!("enabling raw mode: {e}"))?;
    let mut out = io::stdout();
    execute!(out, EnterAlternateScreen).map_err(|e| format!("entering alternate screen: {e}"))?;
    let mut terminal =
        Terminal::new(CrosstermBackend::new(out)).map_err(|e| format!("creating terminal: {e}"))?;

    let result = event_loop(&mut terminal, &descriptor, palette);

    // Restore unconditionally. A panic or an early error must not leave the
    // user's terminal in raw mode on the alternate screen.
    let _ = disable_raw_mode();
    let _ = execute!(terminal.backend_mut(), LeaveAlternateScreen);
    let _ = terminal.show_cursor();

    result
}

fn event_loop(
    terminal: &mut Terminal<CrosstermBackend<io::Stdout>>,
    descriptor: &PanelDescriptor,
    palette: Palette,
) -> Result<(), String> {
    let mut view = PanelView::with_palette(palette);
    let context = Context::default();
    let invoker = OfflineInvoker;

    loop {
        terminal
            .draw(|frame| {
                let area = frame.area();
                view.render(frame, area, descriptor, &context, &invoker);
            })
            .map_err(|e| format!("drawing: {e}"))?;

        match event::read().map_err(|e| format!("reading input: {e}"))? {
            Event::Key(k) if k.kind == KeyEventKind::Press => match k.code {
                KeyCode::Char('q') | KeyCode::Esc => return Ok(()),
                KeyCode::Down | KeyCode::Char('j') => view.select_next(),
                KeyCode::Up | KeyCode::Char('k') => view.select_prev(),
                KeyCode::Char('r') => view.toggle_reveal(),
                _ => {}
            },
            // A resize invalidates any cached layout the view derived from the
            // old rect; the next draw rebuilds it.
            Event::Resize(_, _) => view.invalidate(),
            _ => {}
        }
    }
}

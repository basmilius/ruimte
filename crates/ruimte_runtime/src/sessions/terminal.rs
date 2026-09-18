use std::{
    collections::HashSet,
    ops::Range,
    sync::{Arc, Mutex},
};

use alacritty_terminal::{
    event::{Event, EventListener},
    grid::{Cursor, Dimensions, Grid},
    index::{Column, Line},
    term::{
        CharacterWidth, Config, Term, TermMode,
        cell::{Cell, Flags, Hyperlink},
        test::TermSize,
    },
    vte::ansi::{Color, NamedColor, Processor, Rgb},
};

use super::unicode_width::xterm_unicode6_width;

const SCROLLBACK_LINES: usize = 10_000;

#[derive(Clone, Default)]
struct ResponseListener(Arc<Mutex<Vec<String>>>);

impl EventListener for ResponseListener {
    fn send_event(&self, event: Event) {
        if let Event::PtyWrite(data) = event {
            self.0
                .lock()
                .expect("terminal response lock poisoned")
                .push(data);
        }
    }
}

pub struct TerminalState {
    terminal: Term<ResponseListener>,
    parser: Processor,
    clients: HashSet<String>,
    utf8_tail: Vec<u8>,
    listener: ResponseListener,
}

impl TerminalState {
    pub fn new(rows: u16, cols: u16, restored: Option<&str>) -> Self {
        let size = TermSize::new(usize::from(cols), usize::from(rows));
        let config = Config {
            scrolling_history: SCROLLBACK_LINES,
            character_width: Some(CharacterWidth::new(xterm_unicode6_width)),
            clear_wrapline_on_linefeed: true,
            repair_wide_cells_after_edit: true,
            clear_wrap_on_save_cursor: true,
            preserve_wrapline_after_edit: true,
            ..Config::default()
        };
        let listener = ResponseListener::default();
        let mut state = Self {
            terminal: Term::new(config.clone(), &size, listener.clone()),
            parser: Processor::new(),
            clients: HashSet::new(),
            utf8_tail: Vec::new(),
            listener,
        };
        if let Some(screen) = restored {
            state.process_terminal(screen.as_bytes());
            state.process_terminal(
                b"\r\n\x1b[2m[session restored, previous shell ended]\x1b[0m\r\n",
            );
        }
        state.take_responses();
        state
    }

    pub fn attach(&mut self, client_id: String) -> String {
        let screen = self.serialize();
        self.clients.insert(client_id);
        screen
    }

    pub fn detach(&mut self, client_id: &str) -> bool {
        self.clients.remove(client_id)
    }

    pub fn clients(&self) -> impl Iterator<Item = &str> {
        self.clients.iter().map(String::as_str)
    }

    pub fn client_count(&self) -> usize {
        self.clients.len()
    }

    pub fn process(&mut self, bytes: &[u8]) -> (Option<String>, Vec<String>) {
        self.process_terminal(bytes);
        (self.decode(bytes, false), self.take_responses())
    }

    pub fn finish_output(&mut self) -> Option<String> {
        self.decode(&[], true)
    }

    pub fn resize(&mut self, rows: u16, cols: u16) {
        self.terminal
            .resize(TermSize::new(usize::from(cols), usize::from(rows)));
    }

    pub fn clear(&mut self) -> String {
        let grid = self.terminal.grid_mut();
        let cursor_line = grid.cursor.point.line;
        if grid.history_size() != 0 || cursor_line.0 != 0 {
            let prompt = grid[cursor_line].clone();
            grid.clear_history();
            for line in 0..grid.screen_lines() {
                for column in 0..grid.columns() {
                    grid[Line(line as i32)][Column(column)] = Cell::default();
                }
            }
            grid[Line(0)] = prompt;
            grid.cursor.point.line = Line(0);
        }
        self.serialize()
    }

    pub fn notice(&mut self, text: &str) -> Option<String> {
        let text = text
            .chars()
            .take(4_096)
            .map(|character| {
                if character.is_control() {
                    ' '
                } else {
                    character
                }
            })
            .collect::<String>();
        let output = format!("\r\n\x1b[2m{text}\x1b[0m\r\n");
        self.process(&output.into_bytes()).0
    }

    pub fn serialize(&self) -> String {
        let active_is_alternate = self.terminal.mode().contains(TermMode::ALT_SCREEN);
        let primary = if active_is_alternate {
            self.terminal.inactive_grid()
        } else {
            self.terminal.grid()
        };
        let scroll_region = self.terminal.scroll_region();
        let mut output = serialize_grid(primary, self.terminal.mode(), &scroll_region, true);
        if active_is_alternate {
            output.push_str("\x1b[?1049h");
            output.push_str(&serialize_grid(
                self.terminal.grid(),
                self.terminal.mode(),
                &scroll_region,
                false,
            ));
        }
        output
    }

    pub fn plain_text(&self) -> String {
        text_of(self.terminal.grid())
    }

    fn process_terminal(&mut self, bytes: &[u8]) {
        self.parser.advance(&mut self.terminal, bytes);
    }

    fn take_responses(&self) -> Vec<String> {
        std::mem::take(
            &mut *self
                .listener
                .0
                .lock()
                .expect("terminal response lock poisoned"),
        )
    }

    fn decode(&mut self, bytes: &[u8], finish: bool) -> Option<String> {
        self.utf8_tail.extend_from_slice(bytes);
        if self.utf8_tail.is_empty() {
            return None;
        }
        let mut text = String::new();
        let mut consumed = 0;
        loop {
            match std::str::from_utf8(&self.utf8_tail[consumed..]) {
                Ok(valid) => {
                    text.push_str(valid);
                    consumed = self.utf8_tail.len();
                    break;
                }
                Err(error) => {
                    let valid_end = consumed + error.valid_up_to();
                    text.push_str(
                        std::str::from_utf8(&self.utf8_tail[consumed..valid_end])
                            .expect("UTF-8 prefix was validated"),
                    );
                    match error.error_len() {
                        Some(length) => {
                            text.push('\u{fffd}');
                            consumed = valid_end + length;
                        }
                        None if finish => {
                            text.push('\u{fffd}');
                            consumed = self.utf8_tail.len();
                            break;
                        }
                        None => {
                            consumed = valid_end;
                            break;
                        }
                    }
                }
            }
        }
        self.utf8_tail.drain(..consumed);
        (!text.is_empty()).then_some(text)
    }
}

fn text_of(grid: &Grid<Cell>) -> String {
    let mut text = String::new();
    for line_number in grid.topmost_line().0..=grid.bottommost_line().0 {
        let row = &grid[Line(line_number)];
        let mut end = grid.columns();
        if !row[grid.last_column()].flags.contains(Flags::WRAPLINE) {
            while end > 0 && cell_is_blank(&row[Column(end - 1)]) {
                end -= 1;
            }
        }
        for column in 0..end {
            let cell = &row[Column(column)];
            if !cell
                .flags
                .intersects(Flags::WIDE_CHAR_SPACER | Flags::LEADING_WIDE_CHAR_SPACER)
            {
                text.push(cell.c);
                for character in cell.zerowidth().into_iter().flatten() {
                    text.push(*character);
                }
            }
        }
        if !row[grid.last_column()].flags.contains(Flags::WRAPLINE) {
            text.push('\n');
        }
    }
    while text.ends_with('\n') {
        text.pop();
    }
    text
}

fn serialize_grid(
    grid: &Grid<Cell>,
    mode: &TermMode,
    scroll_region: &Range<Line>,
    reset: bool,
) -> String {
    let mut output = String::new();
    if reset {
        output.push_str("\x1bc");
    } else {
        output.push_str("\x1b[2J\x1b[H");
    }

    let mut pending_wrap_cleanup = None;
    for line_number in grid.topmost_line().0..=grid.bottommost_line().0 {
        let row = &grid[Line(line_number)];
        let mut end = grid.columns();
        if !row[grid.last_column()].flags.contains(Flags::WRAPLINE) {
            while end > 0 && cell_is_blank(&row[Column(end - 1)]) {
                end -= 1;
            }
        }
        let wrapped = row[grid.last_column()].flags.contains(Flags::WRAPLINE);
        let mut style = None;
        let mut column = 0;
        while column < end {
            let cell = &row[Column(column)];
            if cell.c == '\t' {
                output.push_str("\x1b[1C");
                column += 1;
                continue;
            }
            if cell_is_blank(cell)
                && pending_wrap_cleanup.is_none_or(|(source_line, _, _)| source_line != line_number)
            {
                let start = column;
                while column < end && cell_is_blank(&row[Column(column)]) {
                    column += 1;
                }
                if !wrapped || column < end {
                    output.push_str(&format!("\x1b[{}C", column - start));
                    continue;
                }
                pending_wrap_cleanup = Some((line_number, start, column - start));
                column = start;
            }
            if cell
                .flags
                .intersects(Flags::WIDE_CHAR_SPACER | Flags::LEADING_WIDE_CHAR_SPACER)
            {
                column += 1;
                continue;
            }
            let next_style = CellStyle::from(cell);
            if style.as_ref() != Some(&next_style) {
                push_style(&mut output, &next_style);
                style = Some(next_style);
            }
            output.push(cell.c);
            for character in cell.zerowidth().into_iter().flatten() {
                output.push(*character);
            }
            if let Some((source_line, start, count)) = pending_wrap_cleanup
                && source_line < line_number
            {
                output.push_str(&format!(
                    "\x1b7\x1b[1A\x1b[{}G\x1b[{}X\x1b8",
                    start + 1,
                    count
                ));
                pending_wrap_cleanup = None;
            }
            column += 1;
        }
        output.push_str("\x1b[0m\x1b]8;;\x1b\\");
        if line_number != grid.bottommost_line().0
            && !row[grid.last_column()].flags.contains(Flags::WRAPLINE)
        {
            output.push_str("\r\n");
        }
    }

    push_modes(&mut output, mode, false);
    output.push_str(&format!(
        "\x1b[{};{}r",
        scroll_region.start.0 + 1,
        scroll_region.end.0
    ));
    push_modes(&mut output, mode, true);
    push_cursor(&mut output, grid, &grid.saved_cursor, scroll_region, mode);
    output.push_str("\x1b7");
    push_cursor(&mut output, grid, &grid.cursor, scroll_region, mode);
    push_edit_modes(&mut output, mode);
    output
}

#[derive(Clone, PartialEq, Eq)]
struct CellStyle {
    fg: Color,
    bg: Color,
    flags: Flags,
    underline_color: Option<Color>,
    hyperlink: Option<Hyperlink>,
}

impl From<&Cell> for CellStyle {
    fn from(cell: &Cell) -> Self {
        Self {
            fg: cell.fg,
            bg: cell.bg,
            flags: cell.flags & !(Flags::WRAPLINE | Flags::XTERM_EXPLICIT_SPACE),
            underline_color: cell.underline_color(),
            hyperlink: cell.hyperlink(),
        }
    }
}

fn cell_is_blank(cell: &Cell) -> bool {
    cell.c == ' '
        && cell.fg == Color::Named(NamedColor::Foreground)
        && cell.bg == Color::Named(NamedColor::Background)
        && (cell.flags - Flags::WRAPLINE).is_empty()
        && cell.underline_color().is_none()
        && cell.hyperlink().is_none()
        && cell.zerowidth().is_none_or(<[char]>::is_empty)
}

fn push_style(output: &mut String, style: &CellStyle) {
    let mut codes = vec!["0".to_owned()];
    let flags = style.flags;
    for (flag, code) in [
        (Flags::BOLD, "1"),
        (Flags::DIM, "2"),
        (Flags::ITALIC, "3"),
        (Flags::UNDERLINE, "4"),
        (Flags::DOUBLE_UNDERLINE, "4:2"),
        (Flags::UNDERCURL, "4:3"),
        (Flags::DOTTED_UNDERLINE, "4:4"),
        (Flags::DASHED_UNDERLINE, "4:5"),
        (Flags::INVERSE, "7"),
        (Flags::HIDDEN, "8"),
        (Flags::STRIKEOUT, "9"),
    ] {
        if flags.contains(flag) {
            codes.push(code.into());
        }
    }
    codes.extend(color_codes(style.fg, 30, 38, 39));
    codes.extend(color_codes(style.bg, 40, 48, 49));
    codes.extend(
        style
            .underline_color
            .map(|color| color_codes(color, 0, 58, 59))
            .unwrap_or_else(|| vec!["59".into()]),
    );
    output.push_str("\x1b[");
    output.push_str(&codes.join(";"));
    output.push('m');
    output.push_str("\x1b]8;;\x1b\\");
    if let Some(hyperlink) = &style.hyperlink {
        output.push_str("\x1b]8;id=");
        output.push_str(hyperlink.id());
        output.push(';');
        output.push_str(hyperlink.uri());
        output.push_str("\x1b\\");
    }
}

fn color_codes(color: Color, base: u8, extended: u8, default: u8) -> Vec<String> {
    match color {
        Color::Named(NamedColor::Foreground) if base == 30 => vec![default.to_string()],
        Color::Named(NamedColor::Background) if base == 40 => vec![default.to_string()],
        Color::Named(NamedColor::Foreground | NamedColor::Background) if base == 0 => {
            vec![default.to_string()]
        }
        Color::Named(named) if base == 0 => named_color_index(named)
            .map(|index| format!("{extended};5;{index}"))
            .into_iter()
            .collect(),
        Color::Named(named) => named_color_index(named)
            .map(|index| {
                if index < 8 {
                    (base + index).to_string()
                } else {
                    (base + 52 + index).to_string()
                }
            })
            .into_iter()
            .collect(),
        Color::Indexed(index) => vec![format!("{extended};5;{index}")],
        Color::Spec(Rgb { r, g, b }) => vec![format!("{extended};2;{r};{g};{b}")],
    }
}

fn named_color_index(color: NamedColor) -> Option<u8> {
    match color {
        NamedColor::Black | NamedColor::DimBlack => Some(0),
        NamedColor::Red | NamedColor::DimRed => Some(1),
        NamedColor::Green | NamedColor::DimGreen => Some(2),
        NamedColor::Yellow | NamedColor::DimYellow => Some(3),
        NamedColor::Blue | NamedColor::DimBlue => Some(4),
        NamedColor::Magenta | NamedColor::DimMagenta => Some(5),
        NamedColor::Cyan | NamedColor::DimCyan => Some(6),
        NamedColor::White | NamedColor::DimWhite => Some(7),
        NamedColor::BrightBlack => Some(8),
        NamedColor::BrightRed => Some(9),
        NamedColor::BrightGreen => Some(10),
        NamedColor::BrightYellow => Some(11),
        NamedColor::BrightBlue => Some(12),
        NamedColor::BrightMagenta => Some(13),
        NamedColor::BrightCyan => Some(14),
        NamedColor::BrightWhite | NamedColor::BrightForeground => Some(15),
        NamedColor::Foreground
        | NamedColor::Background
        | NamedColor::Cursor
        | NamedColor::DimForeground => None,
    }
}

fn push_cursor(
    output: &mut String,
    grid: &Grid<Cell>,
    cursor: &Cursor<Cell>,
    scroll_region: &Range<Line>,
    mode: &TermMode,
) {
    let origin = mode.contains(TermMode::ORIGIN);
    let row = if origin {
        cursor.point.line.0 - scroll_region.start.0 + 1
    } else {
        cursor.point.line.0 + 1
    };
    output.push_str(&format!(
        "\x1b[{};{}H",
        row.max(1),
        cursor.point.column.0 + 1
    ));
    if cursor.input_needs_wrap {
        let mut point = cursor.point;
        if grid[point].flags.contains(Flags::WIDE_CHAR_SPACER) && point.column.0 > 0 {
            point.column -= 1;
            output.push_str(&format!("\x1b[{};{}H", row.max(1), point.column.0 + 1));
        }
        let cell = &grid[point];
        push_style(output, &CellStyle::from(cell));
        output.push(cell.c);
        for character in cell.zerowidth().into_iter().flatten() {
            output.push(*character);
        }
    }
    push_style(output, &CellStyle::from(&cursor.template));
}

fn push_modes(output: &mut String, mode: &TermMode, origin_only: bool) {
    if origin_only {
        output.push_str(if mode.contains(TermMode::ORIGIN) {
            "\x1b[?6h"
        } else {
            "\x1b[?6l"
        });
        return;
    }
    for (flag, code) in [
        (TermMode::APP_CURSOR, 1),
        (TermMode::LINE_WRAP, 7),
        (TermMode::SHOW_CURSOR, 25),
        (TermMode::MOUSE_REPORT_CLICK, 1000),
        (TermMode::MOUSE_DRAG, 1002),
        (TermMode::MOUSE_MOTION, 1003),
        (TermMode::FOCUS_IN_OUT, 1004),
        (TermMode::SGR_MOUSE, 1006),
        (TermMode::BRACKETED_PASTE, 2004),
    ] {
        output.push_str(&format!(
            "\x1b[?{code}{}",
            if mode.contains(flag) { 'h' } else { 'l' }
        ));
    }
    output.push_str(if mode.contains(TermMode::APP_KEYPAD) {
        "\x1b="
    } else {
        "\x1b>"
    });
    output.push_str("\x1b[4l");
    output.push_str(&format!(
        "\x1b[20{}",
        if mode.contains(TermMode::LINE_FEED_NEW_LINE) {
            'h'
        } else {
            'l'
        }
    ));
}

fn push_edit_modes(output: &mut String, mode: &TermMode) {
    output.push_str(&format!(
        "\x1b[4{}",
        if mode.contains(TermMode::INSERT) {
            'h'
        } else {
            'l'
        }
    ));
}

#[cfg(test)]
mod tests {
    use std::{
        io::Write,
        path::Path,
        process::{Command, Stdio},
    };

    use serde_json::json;

    use super::*;

    #[test]
    fn preserves_utf8_split_across_reads() {
        let mut terminal = TerminalState::new(4, 20, None);
        assert_eq!(terminal.process(&[0xf0, 0x9f]).0, None);
        assert_eq!(terminal.process(&[0x98, 0x80]).0, Some("😀".into()));
        assert!(terminal.plain_text().contains("😀"));
    }

    #[test]
    fn reports_invalid_utf8_without_discarding_an_incomplete_suffix() {
        let mut terminal = TerminalState::new(4, 20, None);
        assert_eq!(terminal.process(&[0xff, 0xe7]).0, Some("�".into()));
        assert_eq!(terminal.process(&[0x95, 0x8c]).0, Some("界".into()));
    }

    #[test]
    fn notice_updates_the_screen_without_accepting_terminal_controls() {
        let mut terminal = TerminalState::new(4, 40, None);
        let output = terminal.notice("Task done\n\x1b[31mbad").unwrap();
        assert!(output.contains("\x1b[2mTask done  [31mbad\x1b[0m"));
        let text = terminal.plain_text();
        assert!(text.contains("Task done  [31mbad"));
    }

    #[test]
    fn serializes_scrollback_and_visible_screen() {
        let mut terminal = TerminalState::new(2, 20, None);
        terminal.process(b"one\r\ntwo\r\nthree");
        let restored = TerminalState::new(2, 20, Some(&terminal.serialize()));
        let text = restored.plain_text();
        assert!(text.contains("one"));
        assert!(text.contains("two"));
        assert!(text.contains("three"));
    }

    #[test]
    fn snapshot_keeps_primary_and_alternate_buffers() {
        let mut terminal = TerminalState::new(6, 40, None);
        terminal.process("before 界".as_bytes());
        terminal.process(b"\x1b[?1049h\x1b[2J\x1b[Halternate");
        let snapshot = terminal.serialize();
        let mut restored = TerminalState::new(6, 40, Some(&snapshot));
        assert!(restored.plain_text().contains("alternate"));
        restored.process(b"\x1b[?1049l");
        assert!(restored.plain_text().contains("before 界"));
    }

    #[test]
    fn resize_reflows_without_losing_text() {
        let mut terminal = TerminalState::new(3, 12, None);
        terminal.process(b"abcdefghijklmnop");
        terminal.resize(3, 6);
        assert!(
            terminal
                .plain_text()
                .replace('\n', "")
                .contains("abcdefghijklmnop")
        );
    }

    #[test]
    #[ignore = "requires Bun and @xterm/headless oracle"]
    fn snapshot_matches_xterm_primary_alternate_style_and_cursor() {
        let mut terminal = TerminalState::new(3, 20, None);
        terminal.process(b"\x1b[31mbefore\x1b[0m\r\nsecond\x1b[2;4H");
        terminal.process(b"\x1b[?1049h\x1b[2J\x1b[H\x1b[32malternate\x1b[2;3H");
        let snapshot = terminal.serialize();
        let alternate = xterm_state(&snapshot);
        assert_eq!(alternate["type"], "alternate");
        assert!(alternate["text"].as_str().unwrap().contains("alternate"));
        assert_eq!(
            (alternate["cursorX"].as_u64(), alternate["cursorY"].as_u64()),
            (Some(2), Some(1))
        );
        assert_eq!(alternate["fg"].as_u64(), Some(2));

        let primary = xterm_state(&(snapshot + "\x1b[?1049l"));
        assert_eq!(primary["type"], "normal");
        assert!(primary["text"].as_str().unwrap().contains("before"));
        assert!(primary["text"].as_str().unwrap().contains("second"));
        assert_eq!(
            (primary["cursorX"].as_u64(), primary["cursorY"].as_u64()),
            (Some(3), Some(1))
        );
    }

    #[test]
    #[ignore = "requires Bun and @xterm/headless oracle"]
    fn snapshot_matches_xterm_cells_modes_saved_cursor_wrap_and_continuation() {
        let before_resize = "abcdefghijklmno\r\nsecond";
        let after_resize = concat!(
            "\x1b[2;5r\x1b[?6h\x1b[?1h\x1b[?7h\x1b[?2004h\x1b[4h",
            "\x1b[2;3H\x1b[33m\x1b7",
            "\x1b[4;9H\x1b[4;38;2;10;20;30;58;2;12;34;56m",
            "\x1b]8;id=wide;https://example.test/path\x1b\\界"
        );
        let continuation = "Z\x1b8S";
        let mut terminal = TerminalState::new(4, 8, None);
        terminal.process(before_resize.as_bytes());
        terminal.resize(5, 10);
        terminal.process(after_resize.as_bytes());

        let comparison = xterm_differential(
            before_resize,
            after_resize,
            &terminal.serialize(),
            continuation,
        );

        assert_eq!(comparison["restored"], comparison["baseline"]);
        assert_eq!(comparison["restoredAfter"], comparison["baselineAfter"]);
    }

    #[test]
    #[ignore = "requires Bun and @xterm/headless oracle"]
    fn snapshot_matches_xterm_across_alternate_buffer_continuation() {
        let before_resize = "\x1b[31mPRIMARY\x1b[0m\x1b[2;4H\x1b[34m\x1b7";
        let after_resize = concat!(
            "\x1b[?1049h\x1b[2J\x1b[H\x1b[32mALT",
            "\x1b[2;2H\x1b[36m\x1b7",
            "\x1b[3;10H\x1b[35mX"
        );
        let continuation = "Q\x1b8S\x1b[?1049lP";
        let mut terminal = TerminalState::new(4, 8, None);
        terminal.process(before_resize.as_bytes());
        terminal.resize(5, 10);
        terminal.process(after_resize.as_bytes());

        let comparison = xterm_differential(
            before_resize,
            after_resize,
            &terminal.serialize(),
            continuation,
        );

        assert_eq!(comparison["restored"], comparison["baseline"]);
        assert_eq!(comparison["restoredAfter"], comparison["baselineAfter"]);
    }

    #[test]
    #[ignore = "requires Bun and @xterm/headless oracle"]
    fn clear_matches_xterm_prompt_line_and_continuation() {
        let input = concat!(
            "one\r\ntwo\r\nthree\r\nfour\r\n",
            "\x1b[31mprompt\x1b[0m \x1b[32m>\x1b[0m "
        );
        let mut terminal = TerminalState::new(3, 20, None);
        terminal.process(input.as_bytes());
        let snapshot = terminal.clear();

        let comparison = xterm_clear_differential(input, &snapshot, "continued");

        assert_eq!(comparison["restored"], comparison["baseline"]);
        assert_eq!(comparison["restoredAfter"], comparison["baselineAfter"]);
    }

    #[test]
    #[ignore = "requires Bun and @xterm/headless oracle"]
    fn snapshot_matches_xterm_unicode6_widths_and_combining_cells() {
        let input = "\x1bcA😀B界C e\u{301}Z\r\n123456789😀XY\r\n👩\u{200d}💻 flags 🇳🇱 end\r\ntext 🙂 after\x1b[2;11H!";
        let continuation = "\r\n\u{300}Q😀界";
        let mut terminal = TerminalState::new(6, 12, None);
        terminal.process(input.as_bytes());

        let comparison = xterm_unicode_differential(input, &terminal.serialize(), continuation);

        assert_eq!(comparison["restored"], comparison["baseline"]);
        assert_eq!(comparison["restoredAfter"], comparison["baselineAfter"]);

        terminal.process(b"logout\r\n");
        let input_after_exit = format!("{input}logout\r\n");
        let comparison =
            xterm_unicode_differential(&input_after_exit, &terminal.serialize(), "post-exit");

        assert_eq!(comparison["restored"], comparison["baseline"]);
        assert_eq!(comparison["restoredAfter"], comparison["baselineAfter"]);
    }

    #[test]
    #[ignore = "requires Bun and @xterm/headless oracle"]
    fn snapshot_matches_xterm_wide_edits_tabs_and_erased_wraps() {
        for input in [
            "界界界abc\x1b[1;2HX\x1b[1;5HY",
            "123456789012abcdefghijkl\x1b[1;4H\x1b[K\x1b[2;1Hend",
            "A界BC界D\x1b[1;3H\x1b[2@XX\x1b[1;7H\x1b[2P",
            "A\tB\r\n123\x1bH\r\tX\x1b[3g\r\tZ",
        ] {
            let mut terminal = TerminalState::new(6, 12, None);
            terminal.process(input.as_bytes());
            let snapshot = terminal.serialize();
            let comparison = xterm_unicode_differential(input, &snapshot, "tail");
            assert_eq!(comparison["restored"], comparison["baseline"], "{input:?}");
            assert_eq!(
                comparison["restoredAfter"], comparison["baselineAfter"],
                "{input:?}"
            );
        }
    }

    fn xterm_state(input: &str) -> serde_json::Value {
        let script = r#"
import { Terminal } from '@xterm/headless';
const terminal = new Terminal({ cols: 20, rows: 3, scrollback: 10000, allowProposedApi: true });
let input = '';
const decoder = new TextDecoder();
for await (const chunk of Bun.stdin.stream()) input += decoder.decode(chunk, { stream: true });
input += decoder.decode();
await new Promise(resolve => terminal.write(input, resolve));
const buffer = terminal.buffer.active;
const lines = [];
for (let index = 0; index < buffer.length; index++) lines.push(buffer.getLine(index)?.translateToString(true) ?? '');
const cell = buffer.getLine(0)?.getCell(0);
console.log(JSON.stringify({ type: buffer.type, text: lines.join('\n'), cursorX: buffer.cursorX, cursorY: buffer.cursorY, fg: cell?.getFgColor() ?? null }));
"#;
        let mut child = Command::new("bun")
            .arg("-e")
            .arg(script)
            .current_dir(Path::new(env!("CARGO_MANIFEST_DIR")).join("../../apps/server-rust"))
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .expect("start Bun xterm oracle");
        child
            .stdin
            .take()
            .unwrap()
            .write_all(input.as_bytes())
            .unwrap();
        let output = child.wait_with_output().unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        serde_json::from_slice(&output.stdout).unwrap()
    }

    fn xterm_differential(
        before_resize: &str,
        after_resize: &str,
        snapshot: &str,
        continuation: &str,
    ) -> serde_json::Value {
        let script = r#"
import { Terminal } from '@xterm/headless';
const request = await Bun.stdin.json();
const write = (terminal, data) => new Promise(resolve => terminal.write(data, resolve));
const capture = terminal => {
  const buffer = terminal.buffer.active;
  const cells = [];
  for (let y = 0; y < buffer.length; y++) {
    const line = buffer.getLine(y);
    const row = [];
    for (let x = 0; x < terminal.cols; x++) {
      const cell = line?.getCell(x);
      row.push(cell ? [
        cell.getChars() || ' ', cell.getWidth(), cell.getFgColorMode(), cell.getFgColor(),
        cell.getBgColorMode(), cell.getBgColor(), cell.isBold(), cell.isDim(),
        cell.isItalic(), cell.isUnderline(), cell.isInverse(), cell.isInvisible(),
        cell.isStrikethrough()
      ] : null);
    }
    cells.push(row);
  }
  return {
    type: buffer.type,
    cursorX: buffer.cursorX,
    cursorY: buffer.cursorY,
    baseY: buffer.baseY,
    viewportY: buffer.viewportY,
    cells,
    modes: terminal.modes
  };
};
const baseline = new Terminal({ cols: 8, rows: 4, scrollback: 10000, allowProposedApi: true });
await write(baseline, request.beforeResize);
baseline.resize(10, 5);
await write(baseline, request.afterResize);
const restored = new Terminal({ cols: 10, rows: 5, scrollback: 10000, allowProposedApi: true });
await write(restored, request.snapshot);
const result = { baseline: capture(baseline), restored: capture(restored) };
await write(baseline, request.continuation);
await write(restored, request.continuation);
result.baselineAfter = capture(baseline);
result.restoredAfter = capture(restored);
console.log(JSON.stringify(result));
"#;
        let request = json!({
            "beforeResize": before_resize,
            "afterResize": after_resize,
            "snapshot": snapshot,
            "continuation": continuation,
        });
        let mut child = Command::new("bun")
            .arg("-e")
            .arg(script)
            .current_dir(Path::new(env!("CARGO_MANIFEST_DIR")).join("../../apps/server-rust"))
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .expect("start Bun xterm oracle");
        child
            .stdin
            .take()
            .unwrap()
            .write_all(serde_json::to_string(&request).unwrap().as_bytes())
            .unwrap();
        let output = child.wait_with_output().unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        serde_json::from_slice(&output.stdout).unwrap()
    }

    fn xterm_clear_differential(
        input: &str,
        snapshot: &str,
        continuation: &str,
    ) -> serde_json::Value {
        let script = r#"
import { Terminal } from '@xterm/headless';
const request = await Bun.stdin.json();
const write = (terminal, data) => new Promise(resolve => terminal.write(data, resolve));
const capture = terminal => {
  const buffer = terminal.buffer.active;
  const cells = [];
  for (let y = 0; y < buffer.length; y++) {
    const line = buffer.getLine(y);
    const row = [];
    for (let x = 0; x < terminal.cols; x++) {
      const cell = line?.getCell(x);
      row.push(cell ? [
        cell.getChars() || ' ', cell.getWidth(), cell.getFgColorMode(), cell.getFgColor(),
        cell.getBgColorMode(), cell.getBgColor(), cell.isBold(), cell.isDim(),
        cell.isItalic(), cell.isUnderline(), cell.isInverse(), cell.isInvisible(),
        cell.isStrikethrough()
      ] : null);
    }
    cells.push(row);
  }
  return { cursorX: buffer.cursorX, cursorY: buffer.cursorY, cells, modes: terminal.modes };
};
const baseline = new Terminal({ cols: 20, rows: 3, scrollback: 10000, allowProposedApi: true });
await write(baseline, request.input);
baseline.clear();
const restored = new Terminal({ cols: 20, rows: 3, scrollback: 10000, allowProposedApi: true });
await write(restored, request.snapshot);
const result = { baseline: capture(baseline), restored: capture(restored) };
await write(baseline, request.continuation);
await write(restored, request.continuation);
result.baselineAfter = capture(baseline);
result.restoredAfter = capture(restored);
console.log(JSON.stringify(result));
"#;
        let request = json!({
            "input": input,
            "snapshot": snapshot,
            "continuation": continuation,
        });
        run_xterm_script(script, &request)
    }

    fn xterm_unicode_differential(
        input: &str,
        snapshot: &str,
        continuation: &str,
    ) -> serde_json::Value {
        let script = r#"
import { Terminal } from '@xterm/headless';
const request = await Bun.stdin.json();
const write = (terminal, data) => new Promise(resolve => terminal.write(data, resolve));
const capture = terminal => {
  const buffer = terminal.buffer.active;
  const lines = [];
  for (let y = 0; y < buffer.length; y++) {
    const line = buffer.getLine(y);
    lines.push({
      wrapped: line?.isWrapped ?? false,
      cells: Array.from({ length: terminal.cols }, (_, x) => {
        const cell = line?.getCell(x);
        return cell ? [cell.getChars(), cell.getWidth()] : null;
      })
    });
  }
  return { cursorX: buffer.cursorX, cursorY: buffer.cursorY, baseY: buffer.baseY, lines };
};
const baseline = new Terminal({ cols: 12, rows: 6, scrollback: 10000, allowProposedApi: true });
await write(baseline, request.input);
const restored = new Terminal({ cols: 12, rows: 6, scrollback: 10000, allowProposedApi: true });
await write(restored, request.snapshot);
const result = { baseline: capture(baseline), restored: capture(restored) };
await write(baseline, request.continuation);
await write(restored, request.continuation);
result.baselineAfter = capture(baseline);
result.restoredAfter = capture(restored);
console.log(JSON.stringify(result));
"#;
        let request = json!({
            "input": input,
            "snapshot": snapshot,
            "continuation": continuation,
        });
        run_xterm_script(script, &request)
    }

    fn run_xterm_script(script: &str, request: &serde_json::Value) -> serde_json::Value {
        let mut child = Command::new("bun")
            .arg("-e")
            .arg(script)
            .current_dir(Path::new(env!("CARGO_MANIFEST_DIR")).join("../../apps/server-rust"))
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .expect("start Bun xterm oracle");
        child
            .stdin
            .take()
            .unwrap()
            .write_all(serde_json::to_string(request).unwrap().as_bytes())
            .unwrap();
        let output = child.wait_with_output().unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        serde_json::from_slice(&output.stdout).unwrap()
    }
}

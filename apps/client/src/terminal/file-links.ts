import type { ILink, Terminal } from '@xterm/xterm';
import { linkLineBounds, type TerminalLinkBounds } from '@adecore/terminal';
import { parseFileRef, resolveFileRef, type FileRef } from '@/shell/panels/file-links';

const SUFFIX = String.raw`(?::\d+(?::\d+)?(?:-\d+)?|#L\d+(?:C\d+)?(?:-L?\d+)?)`;
const CANDIDATES = new RegExp(
    String.raw`"[^"\r\n]+"${SUFFIX}?|'[^'\r\n]+'${SUFFIX}?|\x60[^\x60\r\n]+\x60${SUFFIX}?|<[^<>\r\n]+>${SUFFIX}?|(?:\.?\.?[/\\]|[\w.-]+[/\\])[^\r\n"'<>\x60]*?${SUFFIX}|[^\s"'<>\x60]+`,
    'g'
);

export interface TerminalFileLink {
    ref: FileRef;
    text: string;
}

/* The zero-based buffer line where the wrapped line holding the one-based `row` starts. */
function logicalLineStart(term: Terminal, row: number): number {
    let first = row - 1;
    while (first > 0 && term.buffer.active.getLine(first)?.isWrapped) {
        first--;
    }
    return first;
}

export function terminalFileLinks(term: Terminal, row: number, cwd: string | null, endpointId: string): Array<TerminalFileLink & Pick<ILink, 'range'>> {
    const buffer = term.buffer.active;
    const first = logicalLineStart(term, row);
    let last = row - 1;
    while (buffer.getLine(last + 1)?.isWrapped) {
        last++;
    }
    let text = '';
    const cells: Array<{ x: number; y: number }> = [];
    for (let y = first; y <= last; y++) {
        const line = buffer.getLine(y);
        if (!line) {
            continue;
        }
        for (let x = 0; x < term.cols; x++) {
            const cell = line.getCell(x);
            if (!cell || cell.getWidth() === 0) {
                continue;
            }
            // xterm leaves an empty final cell when a wide glyph wraps; a typed space has chars.
            const next = buffer.getLine(y + 1);
            if (x === term.cols - 1 && cell.getChars() === '' && next?.isWrapped && next.getCell(0)?.getWidth() === 2) {
                continue;
            }
            const chars = cell.getChars() || ' ';
            for (let i = 0; i < chars.length; i++) {
                cells.push({ x: x + 1, y: y + 1 });
            }
            text += chars;
        }
    }
    return Array.from(text.matchAll(CANDIDATES)).flatMap((match) => {
        const ref = parseFileRef(match[0], true);
        const path = ref === null ? null : resolveFileRef(cwd, ref);
        if (ref === null || ref.directory || path === null) {
            return [];
        }
        const start = cells[match.index];
        const end = cells[match.index + match[0].length - 1];
        if (!start || !end || row < start.y || row > end.y) {
            return [];
        }
        return [{ ref: { ...ref, path, endpointId }, text: match[0], range: { start, end } }];
    });
}

export function bindTerminalFileLinks(
    term: Terminal,
    cwdAt: (row: number) => string | null,
    endpointId: string,
    callbacks: {
        open(link: TerminalFileLink, event: MouseEvent): void;
        hover(link: TerminalFileLink | null, bounds: TerminalLinkBounds | null): void;
    }
): () => void {
    let press: MouseEvent | null = null;
    let hovered: (TerminalFileLink & Pick<ILink, 'range'>) | null = null;
    const move = (event: MouseEvent): void => {
        if (!hovered) {
            return;
        }
        const screen = term.element?.querySelector('.xterm-screen')?.getBoundingClientRect();
        const bounds = screen
            ? linkLineBounds(hovered.range, { cols: term.cols, rows: term.rows, viewportY: term.buffer.active.viewportY }, screen, event.clientY)
            : null;
        callbacks.hover(bounds ? hovered : null, bounds);
    };
    const leave = (): void => {
        hovered = null;
        callbacks.hover(null, null);
    };
    const remember = (event: MouseEvent): void => {
        press = event;
    };
    const cancel = (): void => {
        press = null;
        leave();
    };
    term.element?.addEventListener('mousedown', remember, true);
    term.element?.addEventListener('mousemove', move);
    term.element?.addEventListener('mouseleave', cancel);
    term.element?.addEventListener('pointercancel', cancel);
    term.element?.addEventListener('wheel', leave, { passive: true });
    const changes = [term.onScroll(leave), term.onResize(leave), term.onWriteParsed(leave)];
    const provider = term.registerLinkProvider({
        provideLinks(row, callback) {
            callback(
                terminalFileLinks(term, row, cwdAt(logicalLineStart(term, row) + 1), endpointId).map((link) => ({
                    ...link,
                    activate: (event) => {
                        // xterm activates on mouseup, even after a modifier-drag that makes no selection.
                        const clicked =
                            press !== null &&
                            press.button === 0 &&
                            event.button === 0 &&
                            Math.abs(press.clientX - event.clientX) <= 3 &&
                            Math.abs(press.clientY - event.clientY) <= 3;
                        press = null;
                        if (clicked && !event.defaultPrevented && !term.hasSelection()) {
                            callbacks.open(link, event);
                        }
                    },
                    hover: (event) => {
                        hovered = link;
                        move(event);
                    },
                    leave
                }))
            );
        }
    });
    return () => {
        provider.dispose();
        changes.forEach((change) => change.dispose());
        term.element?.removeEventListener('mousedown', remember, true);
        term.element?.removeEventListener('mousemove', move);
        term.element?.removeEventListener('mouseleave', cancel);
        term.element?.removeEventListener('pointercancel', cancel);
        term.element?.removeEventListener('wheel', leave);
        leave();
    };
}

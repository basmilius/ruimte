import { bow, cell, cloud, crossEye, outlined, snore, type DrawnSprite, type Parts } from '@/pets/pixel';
import { BUDDY_CLAUDE, BUDDY_CODEX, PROPS } from '@/pets/sprite-colors';

type BuddyColors = typeof BUDDY_CLAUDE | typeof BUDDY_CODEX;

type Face = 'chill' | 'happy' | 'shades' | 'sleep' | 'gone';

interface Body extends Parts {
    top: number;
}

/* A block of twelve by eleven cells with a nub on each side and four legs of one cell. */
function body(colors: BuddyColors, terminal: boolean, frame: number, pose: 'stand' | 'walk' | 'work' | 'wait' | 'sleep'): Body {
    const bob = pose === 'work' ? -(frame % 2) : 0;
    const squash = pose === 'sleep' ? 1 + (frame % 2) : 0;
    const top = 3 + bob + squash;
    const height = 11 - squash;
    const silhouette = [cell(4, top, 12, height, colors.body), cell(2, top + 5, 2, 2, colors.body), cell(16, top + 5, 2, 2, colors.body)];
    const details = [cell(4, top, 11, 1, colors.light), cell(15, top + 1, 1, height - 1, colors.shade), cell(4, top + height - 1, 11, 1, colors.shade)];
    [5, 8, 11, 14].forEach((x, i) => {
        // The last leg taps while it waits on you; walking, every other leg is up, in turn.
        const tap = pose === 'wait' && i === 3 ? frame % 2 : 0;
        const lift = pose === 'walk' && i % 2 === frame % 2 ? 1 : tap;
        details.push(cell(x, 14 + bob, 1, 3 - lift - bob, colors.outline), cell(x, 14 + bob, 1, 2 - lift, colors.body));
    });
    if (terminal) {
        // A recessed screen for a face, and a power lamp on the left nub.
        details.push(cell(5, top + 3, 10, 5, colors.outline), cell(2, top + 5, 1, 1, colors.ink));
    }
    return { silhouette, details, props: [], bow: bow(10, top), top };
}

function face(colors: BuddyColors, terminal: boolean, parts: Body, look: Face, frame: number): void {
    const y = parts.top + 4;
    const ink = colors.ink;
    const add = (...cells: ReturnType<typeof cell>[]): void => {
        parts.details.push(...cells);
    };
    if (look === 'shades') {
        const glint = terminal ? colors.ink : colors.light;
        add(
            cell(5, y, 10, 1, PROPS.shades),
            cell(5, y + 1, 4, 2, PROPS.shades),
            cell(11, y + 1, 4, 2, PROPS.shades),
            cell(6, y, 1, 1, glint),
            cell(7, y + 1, 1, 1, glint),
            cell(12, y, 1, 1, glint),
            cell(13, y + 1, 1, 1, glint)
        );
        return;
    }
    if (look === 'sleep') {
        add(cell(6, y + 2, 3, 1, ink), cell(11, y + 2, 3, 1, ink));
        return;
    }
    if (look === 'gone') {
        add(...crossEye(7, y + 1, ink), ...crossEye(12, y + 1, ink));
        return;
    }
    if (terminal) {
        // A prompt and a blinking cursor.
        add(cell(6, y, 1, 1, ink), cell(7, y + 1, 1, 1, ink), cell(6, y + 2, 1, 1, ink));
        if (frame % 4 < 2) {
            add(cell(11, y + 2, 3, 1, ink));
        }
        return;
    }
    if (look === 'happy') {
        add(
            cell(7, y, 1, 1, ink),
            cell(8, y + 1, 1, 1, ink),
            cell(7, y + 2, 1, 1, ink),
            cell(12, y, 1, 1, ink),
            cell(11, y + 1, 1, 1, ink),
            cell(12, y + 2, 1, 1, ink)
        );
        return;
    }
    add(cell(6, y + 1, 3, 1, ink), cell(6, y + 2, 1, 1, ink), cell(11, y + 1, 3, 1, ink), cell(13, y + 2, 1, 1, ink));
}

function buddy(id: string, colors: BuddyColors, terminal: boolean): DrawnSprite {
    return {
        id,
        outline: colors.outline,
        poses: {
            stand(frame) {
                const parts = body(colors, terminal, frame, 'stand');
                face(colors, terminal, parts, frame % 6 === 1 ? 'happy' : 'chill', frame);
                return parts;
            },
            walk(frame) {
                const parts = body(colors, terminal, frame, 'walk');
                face(colors, terminal, parts, 'chill', frame);
                return parts;
            },
            work(frame) {
                const parts = body(colors, terminal, frame, 'work');
                face(colors, terminal, parts, 'shades', frame);
                // A terminal and a keyboard to the side, so the face and the four feet stay in view.
                parts.props.push(
                    outlined(23, 7, 1, 7, PROPS.terminal),
                    cell(22, 8, 1, 4, PROPS.terminalText),
                    outlined(18, 14, 6, 1, PROPS.terminal),
                    cell(19 + (frame % 3), 14, 1, 1, PROPS.terminalKey)
                );
                parts.details.push(cell(17, 11 + (frame % 2), 3, 1, colors.outline), cell(19, 12 + (frame % 2), 2, 1, colors.body));
                return parts;
            },
            wait(frame) {
                const parts = body(colors, terminal, frame, 'wait');
                face(colors, terminal, parts, 'happy', frame);
                return parts;
            },
            sleep(frame) {
                const parts = body(colors, terminal, frame, 'sleep');
                face(colors, terminal, parts, 'sleep', frame);
                parts.props.push(...snore(19, frame));
                return parts;
            },
            stopped(frame) {
                const parts = body(colors, terminal, 0, 'stand');
                face(colors, terminal, parts, 'gone', frame);
                // A quarter turn onto its side, which keeps the square body and its face as they are.
                const turn = <T extends { x: number; y: number; w: number; h: number }>(cells: T[]): T[] =>
                    cells.map((part) => ({ ...part, x: 18 - part.y - part.h, y: part.x - 1, w: part.h, h: part.w }));
                return { silhouette: turn(parts.silhouette), details: turn(parts.details), props: cloud(frame), bow: parts.bow && turn(parts.bow) };
            }
        }
    };
}

export const CLAUDE_BUDDY = buddy('claude-buddy', BUDDY_CLAUDE, false);

export const CODEX_BUDDY = buddy('codex-buddy', BUDDY_CODEX, true);

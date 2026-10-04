import type { CSSProperties } from 'react';

export interface AnsiToken {
    content: string;
    style: CSSProperties;
}

interface AnsiState {
    foreground?: string;
    background?: string;
    bold?: boolean;
    dim?: boolean;
    italic?: boolean;
    underline?: boolean;
    strike?: boolean;
    inverse?: boolean;
}

const COLORS = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white'];
const COLOR_LEVELS = [0, 95, 135, 175, 215, 255];
// Consume non-color controls too, so cursor commands and OSC links never become visible text or HTML.
/* oxlint-disable no-control-regex */
const ESCAPES =
    /(?:\x1b\[|\x9b)([0-?]*[ -/]*)([@-~]|$)|(?:\x1b\]|\x9d)[^\x07\x1b\x9c]*(?:\x07|\x1b\\|\x9c|$)|\x1b[PX^_][^\x1b\x9c]*(?:\x1b\\|\x9c|$)|\x1b[ -/]*[@-~]|\x1b$|[\x00-\x08\x0b\x0c\x0e-\x1a\x1c-\x1f\x7f-\x9f]/g;
/* oxlint-enable no-control-regex */

export function stripAnsi(text: string): string {
    return text.replace(ESCAPES, '');
}

function rgb(channels: number[]): string | undefined {
    if (channels.length !== 3 || channels.some((channel) => !Number.isInteger(channel) || channel < 0 || channel > 255)) {
        return undefined;
    }
    return `rgb(${channels.join(' ')})`;
}

function paletteColor(index: number): string | undefined {
    if (!Number.isInteger(index) || index < 0 || index > 255) {
        return undefined;
    }
    if (index < 16) {
        return `var(--term-ansi-${index >= 8 ? 'bright-' : ''}${COLORS[index % 8]})`;
    }
    if (index < 232) {
        const cube = index - 16;
        return rgb([COLOR_LEVELS[Math.floor(cube / 36)]!, COLOR_LEVELS[Math.floor(cube / 6) % 6]!, COLOR_LEVELS[cube % 6]!]);
    }
    const gray = 8 + (index - 232) * 10;
    return rgb([gray, gray, gray]);
}

function extendedColor(parameters: string[]): string | undefined {
    const mode = parameters[0];
    if (mode === '5' && parameters.length === 2 && parameters[1] !== '') {
        return paletteColor(Number(parameters[1]));
    }
    if (mode === '2') {
        // Colon-form RGB may include an empty color-space parameter before its three channels.
        const channels = parameters.length === 5 ? parameters.slice(2) : parameters.slice(1);
        return rgb(channels.map((channel) => (channel === '' ? NaN : Number(channel))));
    }
    return undefined;
}

function applyRendition(state: AnsiState, parameters: string): AnsiState {
    if (!/^[\d;:]*$/.test(parameters)) {
        return state;
    }
    const values = parameters.split(';');
    for (let i = 0; i < values.length; i++) {
        const parts = values[i]!.split(':');
        const code = Number(parts[0]);
        if (code === 38 || code === 48) {
            let color: string | undefined;
            if (parts.length > 1) {
                color = extendedColor(parts.slice(1));
            } else {
                const count = values[i + 1] === '2' ? 4 : values[i + 1] === '5' ? 2 : 1;
                color = extendedColor(values.slice(i + 1, i + 1 + count));
                i += count;
            }
            if (color !== undefined) {
                state[code === 38 ? 'foreground' : 'background'] = color;
            }
        } else if (code >= 30 && code <= 37) {
            state.foreground = paletteColor(code - 30);
        } else if (code >= 40 && code <= 47) {
            state.background = paletteColor(code - 40);
        } else if (code >= 90 && code <= 97) {
            state.foreground = paletteColor(code - 90 + 8);
        } else if (code >= 100 && code <= 107) {
            state.background = paletteColor(code - 100 + 8);
        } else {
            switch (code) {
                case 0:
                    state = {};
                    break;
                case 1:
                    state.bold = true;
                    break;
                case 2:
                    state.dim = true;
                    break;
                case 3:
                    state.italic = true;
                    break;
                case 4:
                    state.underline = parts[1] !== '0';
                    break;
                case 7:
                    state.inverse = true;
                    break;
                case 9:
                    state.strike = true;
                    break;
                case 22:
                    state.bold = false;
                    state.dim = false;
                    break;
                case 23:
                    state.italic = false;
                    break;
                case 24:
                    state.underline = false;
                    break;
                case 27:
                    state.inverse = false;
                    break;
                case 29:
                    state.strike = false;
                    break;
                case 39:
                    state.foreground = undefined;
                    break;
                case 49:
                    state.background = undefined;
                    break;
            }
        }
    }
    return state;
}

function styleOf(state: AnsiState): CSSProperties {
    const style: CSSProperties = {};
    const color = state.inverse ? (state.background ?? 'var(--term-bg)') : state.foreground;
    const background = state.inverse ? (state.foreground ?? 'var(--term-fg)') : state.background;
    if (color !== undefined || state.dim) {
        style.color = state.dim ? `color-mix(in srgb, ${color ?? 'currentColor'} 65%, transparent)` : color;
    }
    if (background !== undefined) {
        style.backgroundColor = background;
    }
    if (state.bold) {
        style.fontWeight = 'bold';
    }
    if (state.italic) {
        style.fontStyle = 'italic';
    }
    if (state.underline || state.strike) {
        style.textDecorationLine = [state.underline && 'underline', state.strike && 'line-through'].filter(Boolean).join(' ');
    }
    return style;
}

export function parseAnsi(text: string, options: { limit?: number; tailLines?: number } = {}): { tokens: AnsiToken[]; omitted: number } {
    const tokens: AnsiToken[] = [];
    let state: AnsiState = {};
    let position = 0;
    for (const match of text.matchAll(ESCAPES)) {
        if (match.index > position) {
            tokens.push({ content: text.slice(position, match.index), style: styleOf(state) });
        }
        if (match[2] === 'm') {
            state = applyRendition(state, match[1]!);
        }
        position = match.index + match[0].length;
    }
    if (position < text.length) {
        tokens.push({ content: text.slice(position), style: styleOf(state) });
    }

    const plain = tokens.map((token) => token.content).join('');
    let start = 0;
    let end = plain.length;
    if (options.tailLines !== undefined) {
        if (plain.endsWith('\n')) {
            end--;
        }
        const tail = plain.slice(0, end).split('\n').slice(-options.tailLines).join('\n');
        start = end - tail.length;
    }
    const omitted = options.limit === undefined ? 0 : Math.max(0, end - start - options.limit);
    end -= omitted;
    let offset = 0;
    return {
        tokens: tokens.flatMap((token) => {
            const from = Math.max(0, start - offset);
            const to = Math.min(token.content.length, end - offset);
            offset += token.content.length;
            return to > from ? [{ ...token, content: token.content.slice(from, to) }] : [];
        }),
        omitted
    };
}

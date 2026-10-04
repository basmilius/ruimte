import type { ITheme } from '@xterm/xterm';

const ANSI = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white'] as const;

function token(style: CSSStyleDeclaration, name: string): string {
    return style.getPropertyValue(name).trim();
}

type AnsiName = (typeof ANSI)[number];
type BrightName = `bright${Capitalize<AnsiName>}`;

function brightKey(name: AnsiName): BrightName {
    return `bright${name[0]!.toUpperCase()}${name.slice(1)}` as BrightName;
}

/* xterm takes literal colors, so the tokens are resolved from the root once per theme change. */
export function readTerminalTheme(): ITheme {
    const style = getComputedStyle(document.documentElement);
    const theme: ITheme = {
        background: token(style, '--term-bg'),
        foreground: token(style, '--term-fg'),
        cursor: token(style, '--term-cursor'),
        cursorAccent: token(style, '--term-bg'),
        selectionBackground: token(style, '--selection')
    };
    for (const name of ANSI) {
        theme[name] = token(style, `--term-ansi-${name}`);
        theme[brightKey(name)] = token(style, `--term-ansi-bright-${name}`);
    }
    return theme;
}

export function readTerminalFont(): string {
    return token(getComputedStyle(document.documentElement), '--font-mono');
}

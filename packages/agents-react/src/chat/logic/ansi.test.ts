import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { parseHTML } from 'linkedom';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import type { ChatToolItem } from '@ruimte/agent-contracts';
import words from '../../locales/en/agent-chat.json';
import { AnsiOutput } from '../ui/AnsiOutput';
import { WorkLiveRow } from '../ui/rows/WorkRows';
import { ChatScopeContext, type ChatScope } from '../../scope';
import { parseAnsi, stripAnsi } from './ansi';

const i18n = createInstance();
await i18n.init({ lng: 'en', resources: { en: { 'agent-chat': words } } });

function render(props: Parameters<typeof AnsiOutput>[0]): string {
    return renderToStaticMarkup(createElement(I18nextProvider, { i18n }, createElement('pre', null, createElement(AnsiOutput, props))));
}

function plain(text: string, options?: Parameters<typeof parseAnsi>[1]): string {
    return parseAnsi(text, options)
        .tokens.map((token) => token.content)
        .join('');
}

describe('ANSI tool output', () => {
    test('renders the Pest pass badge and test lines with their colors and resets', () => {
        const output =
            '\x1b[30;42;1m PASS \x1b[39;49;22m\x1b[39m Tests\\Audit\\NotificationsTest\x1b[39m\n' +
            '\x1b[32;1m✓\x1b[39;22m \x1b[90mit uses ULID session identity\x1b[39m';
        const { tokens } = parseAnsi(output);
        expect(tokens).toEqual([
            { content: ' PASS ', style: { color: 'var(--term-ansi-black)', backgroundColor: 'var(--term-ansi-green)', fontWeight: 'bold' } },
            { content: ' Tests\\Audit\\NotificationsTest', style: {} },
            { content: '\n', style: {} },
            { content: '✓', style: { color: 'var(--term-ansi-green)', fontWeight: 'bold' } },
            { content: ' ', style: {} },
            { content: 'it uses ULID session identity', style: { color: 'var(--term-ansi-bright-black)' } }
        ]);
    });

    test('uses theme tokens for all standard and bright foregrounds and backgrounds', () => {
        const names = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white'];
        for (let i = 0; i < names.length; i++) {
            expect(parseAnsi(`\x1b[${30 + i};${40 + i}mtext`).tokens[0]!.style).toEqual({
                color: `var(--term-ansi-${names[i]})`,
                backgroundColor: `var(--term-ansi-${names[i]})`
            });
            expect(parseAnsi(`\x1b[${90 + i};${100 + i}mtext`).tokens[0]!.style).toEqual({
                color: `var(--term-ansi-bright-${names[i]})`,
                backgroundColor: `var(--term-ansi-bright-${names[i]})`
            });
        }
    });

    test('applies stacked parameters in order and resets color independently of other attributes', () => {
        expect(parseAnsi('\x1b[31;0mdefault\x1b[0;32;1mgreen\x1b[39mstrong\x1b[mplain').tokens).toEqual([
            { content: 'default', style: {} },
            { content: 'green', style: { color: 'var(--term-ansi-green)', fontWeight: 'bold' } },
            { content: 'strong', style: { fontWeight: 'bold' } },
            { content: 'plain', style: {} }
        ]);
    });

    test('supports dim, italic, underline, strikethrough, inverse and individual resets', () => {
        const { tokens } = parseAnsi('\x1b[31;44;1;2;3;4;9mstyled\x1b[22;23;24;29;7mreversed\x1b[27;39;49mplain');
        expect(tokens[0]!.style).toEqual({
            color: 'color-mix(in srgb, var(--term-ansi-red) 65%, transparent)',
            backgroundColor: 'var(--term-ansi-blue)',
            fontWeight: 'bold',
            fontStyle: 'italic',
            textDecorationLine: 'underline line-through'
        });
        expect(tokens[1]!.style).toEqual({ color: 'var(--term-ansi-blue)', backgroundColor: 'var(--term-ansi-red)' });
        expect(tokens[2]!.style).toEqual({});
        expect(parseAnsi('\x1b[7minverse').tokens[0]!.style).toEqual({ color: 'var(--term-bg)', backgroundColor: 'var(--term-fg)' });
    });

    test('supports indexed colors across the theme palette, RGB cube and grayscale ramp', () => {
        expect(parseAnsi('\x1b[38;5;1;48;5;9mtheme').tokens[0]!.style).toEqual({
            color: 'var(--term-ansi-red)',
            backgroundColor: 'var(--term-ansi-bright-red)'
        });
        expect(parseAnsi('\x1b[38;5;196;48;5;232mcube').tokens[0]!.style).toEqual({ color: 'rgb(255 0 0)', backgroundColor: 'rgb(8 8 8)' });
        expect(parseAnsi('\x1b[38;5;231;48;5;255mgray').tokens[0]!.style).toEqual({ color: 'rgb(255 255 255)', backgroundColor: 'rgb(238 238 238)' });
    });

    test('supports semicolon and colon forms of extended colors', () => {
        expect(parseAnsi('\x1b[38;2;12;34;56;48;2;78;90;123mRGB').tokens[0]!.style).toEqual({
            color: 'rgb(12 34 56)',
            backgroundColor: 'rgb(78 90 123)'
        });
        expect(parseAnsi('\x1b[38:2::12:34:56;48:5:196mRGB').tokens[0]!.style).toEqual({
            color: 'rgb(12 34 56)',
            backgroundColor: 'rgb(255 0 0)'
        });
        expect(parseAnsi('\x1b[38:2:12:34:56mRGB').tokens[0]!.style.color).toBe('rgb(12 34 56)');
    });

    test('leaves existing colors intact when extended colors are invalid or incomplete', () => {
        for (const code of ['38;5;256', '38;5', '38;5;', '38;2;300;2;3', '38;2;1;2', '38;2;;2;3']) {
            expect(parseAnsi(`\x1b[32mgreen\x1b[${code}mstill green`).tokens.at(-1)!.style.color).toBe('var(--term-ansi-green)');
        }
    });

    test('removes cursor, title, hyperlink and incomplete controls while keeping their visible text', () => {
        const text = '\x1b[?25l\x1b[2K\x1b]0;Window title\x07before ' + '\x1b]8;;https://example.com\x1b\\link\x1b]8;;\x1b\\ after\x1b[?25h\x1b[31;';
        expect(plain(text)).toBe('before link after');
        expect(stripAnsi(text)).toBe('before link after');
        expect(plain('\x9b32mgreen\x9b0m')).toBe('green');
        expect(parseAnsi('\x9b32mgreen').tokens[0]!.style.color).toBe('var(--term-ansi-green)');
        expect(plain('\x1b(Btext\x07\x1bPignored\x1b\\\x1b')).toBe('text');
    });

    test('preserves uncolored text, whitespace and ordinary bracketed text', () => {
        const text = 'hello\tworld\n  [32m is ordinary text\r\n';
        expect(parseAnsi(text)).toEqual({ tokens: [{ content: text, style: {} }], omitted: 0 });
        expect(parseAnsi('')).toEqual({ tokens: [], omitted: 0 });
    });

    test('clips visible characters without cutting a color sequence or counting control bytes', () => {
        expect(parseAnsi('\x1b[32mhello\x1b[0m world', { limit: 7 })).toEqual({
            tokens: [
                { content: 'hello', style: { color: 'var(--term-ansi-green)' } },
                { content: ' w', style: {} }
            ],
            omitted: 4
        });
        expect(parseAnsi('\x1b[32mhello\x1b[0m', { limit: 5 }).omitted).toBe(0);
        expect(parseAnsi('\x1b[32mhello', { limit: 0 })).toEqual({ tokens: [], omitted: 5 });
    });

    test('carries colors from omitted lines into the live output tail', () => {
        const lines = Array.from({ length: 20 }, (_, i) => `line ${i}`).join('\n');
        const text = `\x1b[32m${lines}\n`;
        const result = parseAnsi(text, { tailLines: 12 });
        expect(result.tokens).toEqual([
            {
                content: Array.from({ length: 12 }, (_, i) => `line ${i + 8}`).join('\n'),
                style: { color: 'var(--term-ansi-green)' }
            }
        ]);
        expect(result.omitted).toBe(0);
        expect(plain('first\n\nlast\n', { tailLines: 2 })).toBe('\nlast');
        expect(plain('\n', { tailLines: 12 })).toBe('');
    });

    test('the live tool row renders its last twelve lines with the buffered color state', () => {
        const scope: ChatScope = {
            id: 'ansi-live-test',
            keyOf: (chatId) => `ansi-live-test/${chatId}`,
            owns: (key) => key.startsWith('ansi-live-test/'),
            transport: {} as ChatScope['transport'],
            chats: {} as ChatScope['chats']
        };
        const lines = Array.from({ length: 20 }, (_, i) => `line ${i}`).join('\n');
        const tool: ChatToolItem = {
            id: 'colored-live',
            kind: 'tool',
            createdAt: 0,
            turnId: null,
            toolUseId: 'call',
            name: 'Bash',
            input: { command: 'bun test' },
            output: null,
            state: 'running',
            parentToolUseId: null,
            progress: { startedAt: null, description: null, output: `\x1b[32m${lines}\n` }
        };
        const markup = renderToStaticMarkup(
            createElement(
                I18nextProvider,
                { i18n },
                createElement(ChatScopeContext.Provider, { value: scope }, createElement(WorkLiveRow, { chatId: 'chat', tool }))
            )
        );
        const { document } = parseHTML(markup);
        const output = document.querySelector('pre')!;
        expect(output.textContent).toBe(Array.from({ length: 12 }, (_, i) => `line ${i + 8}`).join('\n'));
        expect(output.querySelector('span')!.getAttribute('style')).toBe('color:var(--term-ansi-green)');
    });

    test('renders safe selectable text with no ANSI controls or injected markup', () => {
        const text = '\x1b[32;1mPASS\x1b[0m <script>alert("x")</script>';
        const markup = render({ text });
        const { document } = parseHTML(markup);
        expect(document.querySelector('pre')!.textContent).toBe('PASS <script>alert("x")</script>');
        expect(document.querySelector('script')).toBeNull();
        expect(document.querySelector('span')!.getAttribute('style')).toBe('color:var(--term-ansi-green);font-weight:bold');
        expect(markup).not.toContain('\x1b');
    });

    test("renders the clipping notice without the last token's styling", () => {
        const markup = render({ text: '\x1b[32mhello world', limit: 5 });
        const { document } = parseHTML(markup);
        expect(document.querySelector('span')!.textContent).toBe('hello');
        expect(document.querySelector('pre')!.textContent).toBe('hello\n[6 more characters]');
    });
});

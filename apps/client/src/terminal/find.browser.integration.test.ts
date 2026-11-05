import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { clientDirectory, frame, waitInPage, withBrowserFixture } from '../../testing/browser-fixture';

const apple = process.platform === 'darwin';
const NEEDLES = 30;
// A needle on every tenth row of 300, far more than one screen holds, so a step has to scroll.
const OUTPUT = Array.from({ length: 300 }, (_, i) => `row ${i} ${i % 10 === 0 ? 'needle' : 'hay'}`).join('\r\n');

test('the find key opens the bar over a terminal, steps through the scrollback and hands the keyboard back', async () => {
    const css = await readFile(join(clientDirectory, 'node_modules/@xterm/xterm/css/xterm.css'), 'utf8');
    const terminalCss = await readFile(Bun.resolveSync('@adecore/terminal/terminal.css', clientDirectory), 'utf8');
    await withBrowserFixture(
        `
        import { TerminalView } from ${JSON.stringify(Bun.resolveSync('@adecore/terminal', clientDirectory))};
        import { FindBar } from ${JSON.stringify(join(import.meta.dir, '../find/FindBar.tsx'))};
        import { openFocusedFind } from ${JSON.stringify(join(import.meta.dir, '../find/hosts.ts'))};
        import { useFind } from ${JSON.stringify(join(import.meta.dir, '../find/use-find.ts'))};
        import { connectFormat } from ${JSON.stringify(join(import.meta.dir, '../format/source.ts'))};
        import { useTerminalFind } from ${JSON.stringify(join(import.meta.dir, 'use-terminal-find.ts'))};
        import { matchDaemonWidths } from ${JSON.stringify(join(import.meta.dir, 'unicode.ts'))};
        import { bindTerminalKeys } from ${JSON.stringify(join(import.meta.dir, 'xterm.ts'))};
        import commonWords from ${JSON.stringify(join(import.meta.dir, '../i18n/locales/en/common.json'))};
        i18next.addResourceBundle('en', 'common', commonWords, true, true);
        connectFormat();
        Object.defineProperty(navigator, 'userAgent', { value: ${JSON.stringify(apple ? 'Macintosh' : 'Linux')}, configurable: true });
        Object.defineProperty(navigator, 'userAgentData', { value: { platform: ${JSON.stringify(apple ? 'macOS' : 'Linux')} }, configurable: true });
        Object.defineProperty(navigator, 'platform', { value: ${JSON.stringify(apple ? 'MacIntel' : 'Linux x86_64')}, configurable: true });
        window.ready = new Promise((resolve) => (window.markReady = resolve));
        function Probe() {
            const surface = React.useRef(null);
            const view = React.useRef(null);
            const find = useFind(surface);
            const terminalFind = useTerminalFind(find, view, 0);
            React.useEffect(() => {
                const term = view.current.terminal;
                window.term = term;
                // MachineTerminal does this for every terminal of the client, and the search addon needs the proposed API it turns on.
                matchDaemonWidths(term);
                bindTerminalKeys(term, { write: () => {}, clear: () => {}, find: () => openFocusedFind(), leaves: false });
                term.write(${JSON.stringify(OUTPUT)}, () => window.markReady());
            }, []);
            return (
                <div ref={surface} className="surface">
                    <TerminalView ref={view} className="absolute inset-0" />
                    {find.open && (
                        <FindBar find={find} total={terminalFind.total} current={terminalFind.current} invalid={terminalFind.invalid} limited={terminalFind.limited} onStep={terminalFind.step} />
                    )}
                </div>
            );
        }
        window.press = (target, init) => target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
        window.type = (input, text) => {
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, text);
            input.dispatchEvent(new Event('input', { bubbles: true }));
        };
        window.current = () => {
            const match = /([0-9]+) [/] ${NEEDLES}/.exec(document.querySelector('[data-find-bar]')?.textContent ?? '');
            return match ? Number(match[1]) : null;
        };
        createRoot(document.getElementById('root')).render(<UIProvider i18n={i18next}><Probe /></UIProvider>);
        `,
        `${css}\n${terminalCss}\nhtml,body,#root{margin:0;width:100%;height:100%}.surface{position:absolute;inset:0}.absolute{position:absolute}.inset-0{inset:0}.relative{position:relative}svg{width:14px;height:14px}`,
        async (view) => {
            await view.evaluate('window.ready');
            await view.evaluate(frame);
            await view.evaluate('window.term.focus()');

            const find = apple ? '{ key: "f", code: "KeyF", metaKey: true }' : '{ key: "F", code: "KeyF", ctrlKey: true, shiftKey: true }';
            await view.evaluate(`window.press(window.term.textarea, ${find})`);
            await view.evaluate(frame);
            expect(await view.evaluate<boolean>(`document.activeElement === document.querySelector('[data-find-bar] input')`)).toBe(true);

            await view.evaluate(`window.type(document.querySelector('[data-find-bar] input'), 'needle')`);
            await view.evaluate(frame);
            await waitInPage(view, 'window.current() !== null', () => view.evaluate<string>('JSON.stringify(window.errors)'));
            const first = await view.evaluate<number>('window.current()');

            await view.evaluate(`window.press(document.querySelector('[data-find-bar] input'), { key: 'Enter', code: 'Enter' })`);
            await view.evaluate(frame);
            const second = await view.evaluate<number>('window.current()');
            expect(second).toBe((first % NEEDLES) + 1);
            // The search addon selects the match a while after it counts it.
            await waitInPage(view, 'window.term.getSelection() !== ""');
            expect(await view.evaluate<string>('window.term.getSelection()')).toBe('needle');

            await view.evaluate(`window.press(document.querySelector('[data-find-bar] input'), { key: 'Escape', code: 'Escape' })`);
            await view.evaluate(frame);
            expect(await view.evaluate<boolean>(`document.querySelector('[data-find-bar]') === null`)).toBe(true);
            expect(await view.evaluate<boolean>('document.activeElement === window.term.textarea')).toBe(true);
        }
    );
});

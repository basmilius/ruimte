import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { clientDirectory, withBrowserFixture } from '../../../testing/browser-fixture';

for (const tree of ['changes', 'commit'] as const) {
    test(`${tree} tree keeps git marks with recycled rows and refreshes unchanged paths`, async () => {
        await withBrowserFixture(
            `
            import { useState } from 'react';
            import { GitFileList } from ${JSON.stringify(join(import.meta.dir, 'GitFileList.tsx'))};
            import { CommitFileTree } from ${JSON.stringify(join(import.meta.dir, 'CommitFileTree.tsx'))};
            import { ConnectionContext } from ${JSON.stringify(join(clientDirectory, 'src/transport/context.ts'))};
            function Fixture() {
                const [extra, setExtra] = useState(0);
                window.updateCounts = () => setExtra(1000);
                const files = Array.from({length: 300}, (_, index) => ({
                    path: 'src/file-' + String(index + 1).padStart(3, '0') + '.ts',
                    added: index + 1 + extra, deleted: index + 1, status: 'M',
                    state: 'unstaged', binary: false, kind: 'update', diff: ''
                }));
                const noop = () => {};
                const tree = ${JSON.stringify(tree)} === 'commit'
                    ? React.createElement(CommitFileTree, {files, shown: null, onPick: noop})
                    : React.createElement(GitFileList, {
                        checkouts: [{path:'/repo', label:'repo', kind:'root', failure:null, revision:0, status:{repo:true, branch:'main', files}}],
                        collapsed: [], reading: null, reposTruncated: false, busy: false,
                        onOpen: noop, onOpenFile: noop, onDrag: noop, onStage: noop, onDiscard: noop, onDelete: noop
                    });
                return React.createElement(ConnectionContext.Provider, {value:{endpointId:'fixture', transport:{}}}, tree);
            }
            createRoot(document.getElementById('root')).render(React.createElement(UIProvider, {i18n:i18next}, React.createElement(Fixture)));
            `,
            ':root{--font-sans:Arial;--font-mono:monospace;--text-xs:14px;--text-2xs:13px}.adecore-file-tree{width:320px;height:250px;flex:none}.adecore-file-tree-host{display:block;height:100%}.adecore-tree-decoration{display:inline-flex;align-items:center;gap:6px}.font-mono{font-family:monospace}.font-sans{font-family:Arial}.text-xs{font-size:14px}.text-2xs{font-size:13px}',
            async (view) => {
                expect(
                    await view.evaluate<string>(`(() => {
                        const count = [...document.querySelectorAll('[data-tree-slot="decoration"] span')].find(span => span.textContent === '300');
                        return getComputedStyle(count).fontSize;
                    })()`)
                ).toBe('13px');
                const result = await view.evaluate<{ checked: number; failures: unknown[] }>(`new Promise(resolve => {
                    const host = document.querySelector('.adecore-file-tree-host');
                    const root = host.shadowRoot;
                    const scroller = [...root.querySelectorAll('*')].find(element => element.scrollHeight > element.clientHeight && getComputedStyle(element).overflowY === 'auto');
                    const failures = [];
                    let checked = 0;
                    let turns = 0;
                    function sample() {
                        const bounds = scroller.getBoundingClientRect();
                        for (const row of root.querySelectorAll('[data-type="item"]:not([data-item-parked="true"])')) {
                            const number = Number(row.dataset.itemPath.match(/file-(\\d+)/)?.[1]);
                            const rect = row.getBoundingClientRect();
                            if (!number || rect.bottom <= bounds.top || rect.top >= bounds.bottom) continue;
                            const expected = '+' + number + '-' + number + 'M';
                            const native = row.querySelector('[data-item-section="decoration"]');
                            const portal = [...host.querySelectorAll('[data-tree-slot="decoration"]')].find(label => label.dataset.itemPath === row.dataset.itemPath);
                            const label = native ?? portal;
                            checked++;
                            if (label?.textContent !== expected || (native && portal?.textContent)) failures.push({path:row.dataset.itemPath, expected, actual:label?.textContent ?? null, overlay:portal?.textContent});
                        }
                    }
                    const observer = new MutationObserver(() => requestAnimationFrame(sample));
                    observer.observe(root, {childList:true, subtree:true, attributes:true, attributeFilter:['data-item-path']});
                    function scroll() {
                        scroller.scrollTop = (++turns % 2 === 0) ? turns * 90 : 5000 - turns * 90;
                        if (turns < 25) requestAnimationFrame(scroll);
                        else requestAnimationFrame(() => requestAnimationFrame(() => {observer.disconnect(); resolve({checked, failures:failures.slice(0,10)});}));
                    }
                    scroll();
                })`);
                expect(result.checked).toBeGreaterThan(100);
                expect(result.failures).toEqual([]);
                await view.evaluate('window.updateCounts()');
                await view.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
                const refreshed = await view.evaluate<{ marks: string; expected: string; fontSize: string; backgrounds: string[]; padding: string[] }>(`(() => {
                    const row = document.querySelector('.adecore-file-tree-host').shadowRoot.querySelector('[data-type="item"][data-item-path$=".ts"]:not([data-item-parked="true"])');
                    const number = Number(row.dataset.itemPath.match(/file-(\\d+)/)[1]);
                    const marks = [...document.querySelector('.adecore-file-tree-host').querySelectorAll('[data-tree-slot="decoration"]')].find(label => label.dataset.itemPath === row.dataset.itemPath);
                    const styles = [...marks.querySelectorAll('span[style]')].map(span => getComputedStyle(span));
                    return {
                        marks:marks.textContent, expected:'+' + (number + 1000) + '-' + number + 'M',
                        fontSize:styles[0].fontSize,
                        backgrounds:styles.map(style => style.backgroundColor), padding:styles.map(style => style.padding)
                    };
                })()`);
                expect(refreshed.marks).toBe(refreshed.expected);
                expect(refreshed.fontSize).toBe('13px');
                expect(refreshed.backgrounds.every((background) => background === 'rgba(0, 0, 0, 0)')).toBe(true);
                expect(refreshed.padding.every((padding) => padding === '0px')).toBe(true);
            }
        );
    }, 15000);
}

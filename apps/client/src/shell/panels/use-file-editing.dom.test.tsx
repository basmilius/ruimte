import { afterEach, expect, test } from 'bun:test';
import { act } from 'react';
import { windowWorkspace } from '@/state/window';
import { ConnectionProvider } from '@/transport/ConnectionProvider';
import { FakeMachine } from '../../../testing/fake-machine';
import { openFakeWorkspace, type FakeWorkspace } from '../../../testing/fake-workspace';
import { mount, until, type Mounted } from '../../../testing/dom';
import { useFileEditing } from './use-file-editing';

const READ = { kind: 'text', text: 'file', encoding: 'utf-8', size: 4, mtime: 1 } as const;

function Reader() {
    const { indentation } = useFileEditing('/work/atlas/file.ts', READ, false, false);

    return <output>{indentation.tabSize}</output>;
}

let workspace: FakeWorkspace;
let page: Mounted;

afterEach(async () => {
    await page?.unmount();
    workspace?.close();
});

test('an editor re-reads indentation only when its configuration can have changed', async () => {
    const machine = new FakeMachine();
    let tabSize = 2;
    machine.answer('fs.read', () => ({ ...READ, text: `root = true\n[*]\nindent_size = ${tabSize}\n` }));
    workspace = await openFakeWorkspace(machine, { views: [] }, { activeViewId: null, views: {} });
    page = mount();
    await page.render(
        <ConnectionProvider connection={windowWorkspace()!.connection}>
            <Reader />
        </ConnectionProvider>
    );
    await until(() => page.host.querySelector('output')?.textContent === '2');
    const before = machine.requests('fs.read').length;
    await act(async () => machine.emit('fs.changed', { root: '/work/atlas', paths: ['/work/atlas'], changedPaths: ['/work/atlas/other.ts'] }));
    expect(machine.requests('fs.read')).toHaveLength(before);

    for (const changedPaths of [['/work/atlas/.editorconfig'], ['/work/atlas'], undefined]) {
        tabSize += 1;
        await act(async () =>
            machine.emit('fs.changed', { root: '/work/atlas', paths: ['/work/atlas'], ...(changedPaths === undefined ? {} : { changedPaths }) })
        );
        await until(() => page.host.querySelector('output')?.textContent === String(tabSize));
    }
});

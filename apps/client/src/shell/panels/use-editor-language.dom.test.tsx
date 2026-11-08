import { afterEach, describe, expect, test } from 'bun:test';
import { FakeEditorEngine, type FakeEditor } from '@adecore/editor/fake';
import { windowWorkspace } from '@/state/window';
import { ConnectionProvider } from '@/transport/ConnectionProvider';
import { mount, until, type Mounted } from '../../../testing/dom';
import { FakeMachine } from '../../../testing/fake-machine';
import { openFakeWorkspace, type FakeWorkspace } from '../../../testing/fake-workspace';
import { useEditorLanguage } from './use-editor-language';

let workspace: FakeWorkspace;
let page: Mounted;
let editor: FakeEditor;
let machine: FakeMachine;

function Probe({ path, language }: { path: string; language: string | undefined }) {
    const served = useEditorLanguage(editor, path, language)?.served ?? false;

    return <output>{served ? 'served' : 'unserved'}</output>;
}

/* What the machine is asked to open when a person opens a file: the language the machine read it as, and its path. */
async function openFile(path: string, language: string | undefined) {
    machine = new FakeMachine();
    workspace = await openFakeWorkspace(machine, { views: [] }, { activeViewId: null, views: {} });
    editor = new FakeEditorEngine().mount(document.createElement('div'), { text: 'x = 1\n', theme: 'light' });
    page = mount();
    await page.render(
        <ConnectionProvider connection={windowWorkspace()!.connection}>
            <Probe path={path} language={language} />
        </ConnectionProvider>
    );
    await until(() => document.querySelector('output')?.textContent !== undefined);

    return machine.requests('language.document.open');
}

afterEach(async () => {
    await page.unmount();
    editor.dispose();
    workspace.close();
});

describe('a file opened in the editor', () => {
    test.each([
        ['demo.ts', 'typescript', 'typescript'],
        ['README.md', 'markdown', 'markdown'],
        ['Cargo.toml', 'toml', 'toml'],
        ['init.lua', 'lua', 'lua'],
        ['main.go', 'go', 'go'],
        ['Package.swift', 'swift', 'swift'],
        ['main.zig', 'zig', 'zig'],
        ['go.mod', undefined, 'go.mod'],
        ['go.work', undefined, 'go.work'],
        ['build.zig.zon', undefined, 'zon']
    ])('%s opens on the machine as %s', async (name, language, languageId) => {
        const opened = await openFile(`/work/atlas/${name}`, language);

        expect(opened).toMatchObject([{ path: name, languageId }]);
    });

    test('a file no server knows opens nowhere', async () => {
        const opened = await openFile('/work/atlas/notes.txt', 'text');

        expect(opened).toEqual([]);
    });
});

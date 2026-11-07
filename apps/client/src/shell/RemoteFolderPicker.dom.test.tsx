import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { LOCAL_ENDPOINT_ID, useEndpoints } from '@/state/endpoints';
import { useServers } from '@/state/server';
import { clickOn, mount, until } from '../../testing/dom';
import { buttonWithText, everything } from '../../testing/dom-helpers';
import { connectFakeMachine, FakeMachine } from '../../testing/fake-machine';
import { RemoteFolderPicker } from './RemoteFolderPicker';

const HOME = 'C:\\Users\\bas';

const FOLDERS: Record<string, string[]> = {
    [HOME]: ['Projects'],
    [`${HOME}\\Projects`]: ['atlas'],
    'C:\\Users': ['bas', 'Public']
};

let disconnect: () => void;
let asked: string[];

function pathField(): HTMLInputElement {
    return document.querySelector<HTMLInputElement>('input')!;
}

beforeEach(() => {
    asked = [];
    const machine = new FakeMachine();
    machine.answer('fs.browse', ({ partialPath }) => {
        asked.push(partialPath);
        const parentPath = partialPath.startsWith('~') ? HOME : partialPath.replace(/\\$/, '');
        return {
            parentPath,
            exists: true,
            entries: (FOLDERS[parentPath] ?? []).map((name) => ({ name, fullPath: `${parentPath}\\${name}`, hasCanvas: false }))
        };
    });
    useEndpoints.getState().add({
        id: 'machine-w',
        label: 'Office PC',
        httpBaseUrl: 'http://127.0.0.1:2',
        wsBaseUrl: 'ws://127.0.0.1:2',
        reachability: 'lan',
        daemonId: null,
        daemonPublicKey: null
    });
    useServers.getState().setInfo('machine-w', { platform: 'win32', home: 'C:\\ProgramData\\Ruimte', version: '1.0.0', model: null });
    disconnect = connectFakeMachine(machine, 'machine-w');
});

afterEach(() => {
    disconnect();
    useEndpoints.getState().setActive(LOCAL_ENDPOINT_ID);
    useEndpoints.getState().remove('machine-w');
    useServers.getState().forget('machine-w');
});

describe('the folder picker of a Windows machine', () => {
    test('opens at the home folder written as the machine writes it, and goes into a folder and up with backslashes', async () => {
        const picked: string[] = [];
        await mount().render(
            <RemoteFolderPicker endpointId="machine-w" machine="Office PC" onPick={(folder) => picked.push(folder)} onBack={() => undefined} />
        );

        await until(() => pathField().value === `${HOME}\\` && everything().includes('Projects'));
        expect(asked[0]).toBe('~\\');

        await clickOn(buttonWithText('Projects'));
        await until(() => pathField().value === `${HOME}\\Projects\\` && everything().includes('atlas'));

        await clickOn(buttonWithText('Up one folder'));
        await until(() => pathField().value === `${HOME}\\`);
        await clickOn(buttonWithText('Up one folder'));
        await until(() => pathField().value === 'C:\\Users\\' && everything().includes('Public'));
        expect(asked.at(-1)).toBe('C:\\Users\\');

        await clickOn(buttonWithText('Use this folder'));
        expect(picked).toEqual(['C:\\Users']);
    });
});

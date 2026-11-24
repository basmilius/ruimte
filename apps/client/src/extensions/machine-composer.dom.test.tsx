import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act, useState } from 'react';
import { useExpandingCommands } from '@/extensions/chat-commands';
import { useExtensionReferables } from '@/extensions/chat-references';
import { useContributions } from '@/state/extension-registry';
import { clickOn, mount, until, type Mounted } from '../../testing/dom';
import { buttonWithText, everything } from '../../testing/dom-helpers';
import { FakeMachine } from '../../testing/fake-machine';
import { openFakeWorkspace, type FakeWorkspace } from '../../testing/fake-workspace';
import { emptyCanvas } from '../../testing/project-fixtures';

const MAIN = emptyCanvas();
const PROJECT_ID = 'project-atlas';
const ISSUE = { extension: 'dev.trackline', reference: 'issues', title: 'Trackline issues', id: 'TRK-101', name: 'TRK-101 Sign-in loops' };

let machine: FakeMachine;
let workspace: FakeWorkspace;
let page: Mounted;

/* What a chat box offers after `#` and `/` from extensions, as rows a person picks, with the text a pick puts in the prompt. */
function Offered() {
    const referables = useExtensionReferables();
    const commands = useExpandingCommands();
    const [prompt, setPrompt] = useState('');

    return (
        <div>
            {referables.map((item) => (
                <button key={item.id} onClick={() => void item.read?.().then(setPrompt)}>
                    # {item.name}
                </button>
            ))}
            {commands.map((command) => (
                <button key={command.name} onClick={() => void Promise.resolve(command.expand('TRK-101')).then(setPrompt)}>
                    /{command.name}
                </button>
            ))}
            <output>{prompt}</output>
        </div>
    );
}

beforeEach(async () => {
    machine = new FakeMachine();
    machine.answer('extension.composerItems', () => ({
        references: [ISSUE],
        commands: [
            { extension: 'dev.trackline', name: 'issue', description: 'Puts an issue in the prompt' },
            { extension: 'dev.trackline', name: 'triage', description: 'The machine also has one' }
        ]
    }));
    machine.answer('extension.referenceRead', ({ id }) => ({ text: `${id}: the page loops` }));
    machine.answer('extension.commandExpand', ({ name, args }) => ({ text: `${name} of ${args}` }));
    workspace = await openFakeWorkspace(machine, { views: [MAIN] }, { activeViewId: MAIN.id, views: {} });
    page = mount();
});

afterEach(async () => {
    await page.unmount();
    workspace.close();
    useContributions.setState({ slashCommands: [], references: [] });
});

describe('what the machine offers a chat box from an extension', () => {
    test('shows after # and /, and a pick asks the machine for the text of the prompt', async () => {
        await page.renderApp(<Offered />);
        await until(() => buttonWithText('# TRK-101 Sign-in loops') !== null);

        await clickOn(buttonWithText('# TRK-101 Sign-in loops'));
        await until(() => everything().includes('TRK-101: the page loops'));
        expect(machine.requests('extension.referenceRead')).toEqual([
            { projectId: PROJECT_ID, extension: 'dev.trackline', reference: 'issues', id: 'TRK-101', name: 'TRK-101 Sign-in loops' }
        ]);

        await clickOn(buttonWithText('/issue'));
        await until(() => everything().includes('issue of TRK-101'));
        expect(machine.requests('extension.commandExpand')).toEqual([{ projectId: PROJECT_ID, extension: 'dev.trackline', name: 'issue', args: 'TRK-101' }]);
    });

    test('shows a command and a reference once when the window has them too, as the window has them', async () => {
        await act(async () =>
            useContributions.setState({
                slashCommands: [{ id: 'dev.trackline/triage', name: 'triage', description: 'From the window', expand: async () => 'From the window' }],
                references: [
                    {
                        id: 'dev.trackline/issues',
                        title: 'Trackline issues',
                        list: async () => [{ id: 'TRK-101', name: 'TRK-101 in the window' }],
                        read: async () => 'Read in the window'
                    }
                ]
            })
        );
        await page.renderApp(<Offered />);
        await until(() => buttonWithText('/issue') !== null && buttonWithText('# TRK-101 in the window') !== null);

        expect([...document.querySelectorAll('button')].filter((button) => button.textContent === '/triage')).toHaveLength(1);
        expect(buttonWithText('# TRK-101 Sign-in loops')).toBeNull();

        await clickOn(buttonWithText('/triage'));
        await until(() => everything().includes('From the window'));
        expect(machine.requests('extension.commandExpand')).toEqual([]);
    });

    test('puts the reason in the prompt when the machine cannot read a pick', async () => {
        machine.answer('extension.referenceRead', () => {
            throw new Error('Trackline has no issue TRK-101');
        });
        await page.renderApp(<Offered />);
        await until(() => buttonWithText('# TRK-101 Sign-in loops') !== null);
        await clickOn(buttonWithText('# TRK-101 Sign-in loops'));

        await until(() => everything().includes('(TRK-101 Sign-in loops could not be read: Trackline has no issue TRK-101)'));
    });
});

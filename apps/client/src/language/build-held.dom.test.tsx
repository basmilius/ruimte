import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { LanguageServerStatus } from '@ruimte/contracts';
import { clickOn, mount, until, type Mounted } from '../../testing/dom';
import { installDesktop, removeDesktop } from '../../testing/dom-helpers';
import { FakeMachine } from '../../testing/fake-machine';
import { openFakeWorkspace, type FakeWorkspace } from '../../testing/fake-workspace';
import { emptyCanvas } from '../../testing/project-fixtures';
import { ServerActionButtons } from './ServerParts';
import { LanguageStatusTracker } from './status';

const HELD: LanguageServerStatus = { server: 'rust', state: 'ready', version: '1.85.0', documents: 1, buildHeld: true };
const MAIN = emptyCanvas();

let machine: FakeMachine;
let tracker: LanguageStatusTracker;
let workspace: FakeWorkspace;
let page: Mounted;

async function open(options: { thisMachine: boolean }): Promise<void> {
    workspace = await openFakeWorkspace(machine, { views: [MAIN] }, { activeViewId: MAIN.id, views: {} }, {}, options);
}

beforeEach(async () => {
    localStorage.clear();
    installDesktop();
    machine = new FakeMachine();
    machine.answer('language.status', () => ({ servers: [HELD] }));
    machine.answer('language.worktreeBuild', () => ({ servers: [{ ...HELD, buildHeld: undefined }] }));
    tracker = new LanguageStatusTracker(machine, 'project-atlas');
    await tracker.refresh();
    page = mount();
});

afterEach(async () => {
    tracker.dispose();
    await page.unmount();
    workspace.close();
    removeDesktop();
});

describe('a server kept from building code in a worktree', () => {
    test('offers to turn building on for the repository, and takes the statuses the machine answers with', async () => {
        await open({ thisMachine: true });
        await page.render(<ServerActionButtons status={HELD} tracker={tracker} size="xs" stepBack={false} onLog={() => undefined} />);

        await until(() => document.body.textContent?.includes('Turn on for this repository') === true);
        await clickOn([...document.querySelectorAll('button')].find((button) => button.textContent === 'Turn on for this repository') ?? null);

        expect(machine.requests('language.worktreeBuild')).toEqual([{ projectId: 'project-atlas', on: true }]);
        await until(() => tracker.getSnapshot()[0]?.buildHeld === undefined);
    });

    test('offers to turn building off again once it is on, and takes the held statuses the machine answers with', async () => {
        const allowed: LanguageServerStatus = { ...HELD, buildHeld: undefined, buildAllowed: true };
        machine.answer('language.worktreeBuild', ({ on }) => ({ servers: [on ? allowed : HELD] }));
        await open({ thisMachine: true });
        await page.render(<ServerActionButtons status={allowed} tracker={tracker} size="xs" stepBack={false} onLog={() => undefined} />);

        await until(() => document.body.textContent?.includes('Turn off for this repository') === true);
        expect(document.body.textContent).not.toContain('Turn on for this repository');
        await clickOn([...document.querySelectorAll('button')].find((button) => button.textContent === 'Turn off for this repository') ?? null);

        expect(machine.requests('language.worktreeBuild')).toEqual([{ projectId: 'project-atlas', on: false }]);
        await until(() => tracker.getSnapshot()[0]?.buildHeld === true);
    });

    test('offers nothing for a server that is not held', async () => {
        await open({ thisMachine: true });
        await page.render(
            <ServerActionButtons status={{ ...HELD, buildHeld: undefined }} tracker={tracker} size="xs" stepBack={false} onLog={() => undefined} />
        );

        await until(() => document.body.textContent?.includes('Restart') === true);

        expect(document.body.textContent).not.toContain('Turn on for this repository');
    });

    test('offers neither switch on another machine, which turns away every client but its own app', async () => {
        const allowed: LanguageServerStatus = { ...HELD, buildHeld: undefined, buildAllowed: true };
        await open({ thisMachine: false });
        await page.render(
            <>
                <ServerActionButtons status={HELD} tracker={tracker} size="xs" stepBack={false} onLog={() => undefined} />
                <ServerActionButtons status={allowed} tracker={tracker} size="xs" stepBack={false} onLog={() => undefined} />
            </>
        );

        await until(() => document.body.textContent?.includes('Restart') === true);

        expect(document.body.textContent).not.toContain('Turn on for this repository');
        expect(document.body.textContent).not.toContain('Turn off for this repository');
        expect(machine.requests('language.worktreeBuild')).toEqual([]);
    });
});

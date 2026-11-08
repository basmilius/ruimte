import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { LanguageServerStatus } from '@ruimte/contracts';
import { clickOn, mount, until, type Mounted } from '../../testing/dom';
import { FakeMachine } from '../../testing/fake-machine';
import { ServerActionButtons } from './ServerParts';
import { LanguageStatusTracker } from './status';

const HELD: LanguageServerStatus = { server: 'rust', state: 'ready', version: '1.85.0', documents: 1, buildHeld: true };

let machine: FakeMachine;
let tracker: LanguageStatusTracker;
let page: Mounted;

beforeEach(async () => {
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
});

describe('a server kept from building code in a worktree', () => {
    test('offers to turn building on for the repository, and takes the statuses the machine answers with', async () => {
        await page.render(<ServerActionButtons status={HELD} tracker={tracker} size="xs" stepBack={false} onLog={() => undefined} />);

        await until(() => document.body.textContent?.includes('Turn on for this repository') === true);
        await clickOn([...document.querySelectorAll('button')].find((button) => button.textContent === 'Turn on for this repository') ?? null);

        expect(machine.requests('language.worktreeBuild')).toEqual([{ projectId: 'project-atlas', on: true }]);
        await until(() => tracker.getSnapshot()[0]?.buildHeld === undefined);
    });

    test('offers nothing for a server that is not held', async () => {
        await page.render(
            <ServerActionButtons status={{ ...HELD, buildHeld: undefined }} tracker={tracker} size="xs" stepBack={false} onLog={() => undefined} />
        );

        await until(() => document.body.textContent?.includes('Restart') === true);

        expect(document.body.textContent).not.toContain('Turn on for this repository');
    });
});

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { LanguageServerStatus } from '@ruimte/contracts';
import { clickOn, mount, until, type Mounted } from '../../testing/dom';
import { FakeMachine } from '../../testing/fake-machine';
import { LogDialog } from './ServerParts';
import { LanguageStatusTracker } from './status';

const STATUS: LanguageServerStatus = { server: 'typescript', state: 'ready', version: '5.0.0', documents: 1 };

let machine: FakeMachine;
let tracker: LanguageStatusTracker;
let page: Mounted;

function option(name: string): HTMLElement | null {
    return [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((row) => row.textContent?.includes(name)) ?? null;
}

beforeEach(async () => {
    machine = new FakeMachine();
    machine.answer('language.status', () => ({ servers: [STATUS] }));
    machine.answer('language.log', () => ({ lines: [{ at: 1, stream: 'server' as const, text: 'starting', level: 'info', source: 'log' }] }));
    machine.answer('language.trace', ({ value }) => ({ status: { ...STATUS, trace: value } }));
    tracker = new LanguageStatusTracker(machine, 'project-atlas');
    await tracker.refresh();
    page = mount();
    await page.render(<LogDialog server="typescript" tracker={tracker} onClose={() => undefined} />);
});

afterEach(async () => {
    tracker.dispose();
    await page.unmount();
});

describe('the log of a language server', () => {
    test('prints a line with its level, and reads the log again on Refresh', async () => {
        await until(() => document.body.textContent?.includes('[info] starting') === true);

        const reads = machine.requests('language.log').length;
        await clickOn(document.querySelector('button[aria-label="Refresh"]'));
        await until(() => machine.requests('language.log').length > reads);
    });

    test('switches the trace of the server from the header', async () => {
        await until(() => document.querySelector('button[aria-label="Trace"]') !== null);
        await clickOn(document.querySelector('button[aria-label="Trace"]'));
        await until(() => option('Verbose') !== null);
        await clickOn(option('Verbose'));

        expect(machine.requests('language.trace')).toEqual([{ projectId: 'project-atlas', server: 'typescript', value: 'verbose' }]);
    });
});

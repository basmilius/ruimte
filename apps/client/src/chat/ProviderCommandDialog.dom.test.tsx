import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';
import { ProviderCommandDialog } from '@/chat/ProviderCommandDialog';
import { LOCAL_ENDPOINT_ID } from '@/state/endpoints';
import { useUi } from '@/state/ui';
import { FakeMachine, connectFakeMachine } from '../../testing/fake-machine';
import { mount, until, type Mounted } from '../../testing/dom';

let machine: FakeMachine;
let release: () => void;
let page: Mounted;

beforeEach(async () => {
    machine = new FakeMachine();
    release = connectFakeMachine(machine);
    page = mount();
    await page.render(<ProviderCommandDialog />);
});

afterEach(async () => {
    act(() => useUi.getState().setProviderCommand(null));
    await page.unmount();
    release();
});

describe('a provider command run from its install page', () => {
    test('opens a plain shell in a dialog, with the command left for the person to run, and ends it on close', async () => {
        act(() => useUi.getState().setProviderCommand({ endpointId: LOCAL_ENDPOINT_ID, kind: 'grok', command: 'grok login' }));
        await until(() => machine.requests('session.create').length > 0);
        const created = machine.requests('session.create')[0]!;
        expect(created.command).toBeUndefined();
        expect(created.agent).toBeUndefined();
        expect(created.cwd).toBeUndefined();
        expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Press Enter to run the command.');
        expect(document.querySelector('[role="dialog"] h2')?.textContent).toBe('grok');
        expect(machine.requests('session.write').filter((write) => /[\r\n]/.test(write.data))).toEqual([]);

        act(() => useUi.getState().setProviderCommand(null));
        await until(() => machine.requests('session.kill').length > 0);
        expect(machine.requests('session.kill')).toEqual([{ sessionId: created.sessionId }]);
    });
});

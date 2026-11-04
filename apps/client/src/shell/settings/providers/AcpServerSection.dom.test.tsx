import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { AgentServerStatus, ProviderInfo } from '@ruimte/contracts';
import { AcpServerSection, AcpServerStepBody } from '@/shell/settings/providers/AcpServerSection';
import { useAcpServer } from '@/shell/settings/providers/use-acp-server';
import { LOCAL_ENDPOINT_ID } from '@/state/endpoints';
import { clickOn, mount, until, type Mounted } from '../../../../testing/dom';
import { buttonWithText } from '../../../../testing/dom-helpers';
import { FakeMachine, connectFakeMachine } from '../../../../testing/fake-machine';

const ANTIGRAVITY = { kind: 'antigravity', name: 'Antigravity', installed: false, version: null } as unknown as ProviderInfo;
const MISSING: AgentServerStatus = { provider: 'antigravity', state: 'missing', version: '1.4.1', installed: null };

let machine: FakeMachine;
let release: () => void;
let page: Mounted;

function Section() {
    const acp = useAcpServer(LOCAL_ENDPOINT_ID, 'antigravity');
    return acp.server && <AcpServerSection provider={ANTIGRAVITY} acp={acp} server={acp.server} />;
}

function Step() {
    const acp = useAcpServer(LOCAL_ENDPOINT_ID, 'antigravity');
    return (
        acp.server && (
            <section data-done={acp.server.state === 'installed'}>
                <AcpServerStepBody acp={acp} server={acp.server} />
            </section>
        )
    );
}

beforeEach(async () => {
    machine = new FakeMachine();
    machine.answer('provider.server', () => ({ server: MISSING }));
    machine.answer('provider.installServer', () => ({ server: { ...MISSING, state: 'installed' as const, installed: '1.4.1' } }));
    machine.answer('provider.list', () => ({ providers: [{ ...ANTIGRAVITY, installed: true, version: '1.4.1' }] }));
    release = connectFakeMachine(machine);
    page = mount();
});

afterEach(async () => {
    await page.unmount();
    release();
});

describe('the Antigravity chat server in Settings, Providers', () => {
    test('says it is not installed and installs it on a press, then asks the machine for its providers again', async () => {
        await page.render(<Section />);
        await until(() => buttonWithText('Install') !== null);
        expect(document.body.textContent).toContain('Chat server 1.4.1');
        expect(document.body.textContent).toContain('Not installed.');

        const listsBefore = machine.requests('provider.list').length;
        await clickOn(buttonWithText('Install'));
        await until(() => document.body.textContent?.includes('Version 1.4.1 is installed.') === true);
        expect(machine.requests('provider.installServer')).toEqual([{ provider: 'antigravity' }]);
        await until(() => machine.requests('provider.list').length > listsBefore);
        expect(buttonWithText('Install')).toBeNull();
    });

    test('a failed install says why and offers Install again', async () => {
        machine.answer('provider.server', () => ({ server: { ...MISSING, state: 'failed' as const, error: 'The download does not match its checksum' } }));
        await page.render(<Section />);
        await until(() => buttonWithText('Install') !== null);
        expect(document.body.textContent).toContain('The download does not match its checksum');
    });

    test('as the step after the CLI, installs it and reads as done', async () => {
        await page.render(<Step />);
        await until(() => buttonWithText('Install') !== null);
        expect(document.querySelector('section')?.dataset.done).toBe('false');
        await clickOn(buttonWithText('Install'));
        await until(() => document.querySelector('section')?.dataset.done === 'true');
        expect(machine.requests('provider.installServer')).toEqual([{ provider: 'antigravity' }]);
    });
});

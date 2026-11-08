import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { Credential, TunnelState } from '@ruimte/contracts';
import { act } from 'react';
import { usePickedMachineState } from '@/shell/settings/picked-machine';
import { ConsentDialog } from '@/shell/tunnels/ConsentDialog';
import { useConsent } from '@/state/consent';
import { useEndpoints } from '@/state/endpoints';
import { clickOn, mount, until, type Mounted } from '../../../../testing/dom';
import { buttonWithText, everything, installDesktop, removeDesktop, typeInto } from '../../../../testing/dom-helpers';
import { connectFakeMachine, FakeMachine } from '../../../../testing/fake-machine';
import { machineBridge } from '../../../../testing/machine-bridge';
import { TunnelsPane } from '../panes/TunnelsPane';

let page: Mounted;
let machine: FakeMachine;
let release: () => void;
let state: TunnelState;
let credentials: Credential[];

function stateOf(change: Partial<TunnelState> = {}): TunnelState {
    return {
        stage: 'running',
        message: null,
        signInUrl: null,
        domain: 'example.com',
        rows: [],
        mcp: { enabled: false, port: null },
        clients: 0,
        suggestedMcpHostname: 'mcp-0123456789abcdef.example.com',
        ...change
    };
}

beforeEach(() => {
    state = stateOf();
    credentials = [];
    installDesktop({ machine: machineBridge('local') });
    machine = new FakeMachine();
    machine.answer('tunnel.state', () => state);
    machine.answer('tunnel.discover', () => ({ ports: [{ port: 3000, session: 'Vite' }] }));
    machine.answer('credential.list', () => ({ credentials }));
    release = connectFakeMachine(machine);
    page = mount();
});

afterEach(async () => {
    await page.unmount();
    release();
    removeDesktop();
    useConsent.setState({ requests: [] });
});

async function open(): Promise<void> {
    await page.render(<TunnelsPane />);
    await until(() => everything().includes('Tunnels'));
}

describe('the states of the screen', () => {
    test('offers to install cloudflared first, and installs on a click', async () => {
        state = stateOf({ stage: 'not-installed', domain: null });
        machine.answer('tunnel.install', () => (state = stateOf({ stage: 'installing', domain: null })));
        await open();
        await until(() => buttonWithText('Install') !== null);
        await clickOn(buttonWithText('Install'));
        await until(() => everything().includes('Installing cloudflared'));
        expect(machine.requests('tunnel.install')).toHaveLength(1);
    });

    test('says what to install where cloudflared has no build', async () => {
        state = stateOf({ stage: 'cannot-install', message: 'Install cloudflared yourself and put it on your path.', domain: null });
        await open();
        await until(() => everything().includes('Install cloudflared yourself and put it on your path.'));
        expect(buttonWithText('Install')).toBeNull();
    });

    test('asks to sign in with Cloudflare, then for a domain', async () => {
        state = stateOf({ stage: 'signed-out', domain: null });
        machine.answer('tunnel.signIn', () => (state = stateOf({ stage: 'signing-in', domain: null })));
        await open();
        await until(() => buttonWithText('Sign in') !== null);
        await clickOn(buttonWithText('Sign in'));
        await until(() => everything().includes('Finish signing in in your browser'));
        expect(machine.requests('tunnel.signIn')).toHaveLength(1);

        state = stateOf({ stage: 'no-tunnel', domain: null });
        await act(async () => machine.emit('tunnel.changed', {}));
        await until(() => buttonWithText('Create tunnel') !== null);
        expect(buttonWithText('Create tunnel')?.disabled).toBe(true);
    });

    test('opens the address cloudflared printed in the browser as soon as it is known', async () => {
        const opened: string[] = [];

        installDesktop({ machine: machineBridge('local'), openExternal: async (url: string) => void opened.push(url) });
        state = stateOf({ stage: 'signing-in', signInUrl: 'https://dash.cloudflare.com/argotunnel?aud=x', domain: null });
        await open();
        await until(() => opened.length > 0);
        expect(opened).toEqual(['https://dash.cloudflare.com/argotunnel?aud=x']);
    });

    test('shows the sentence cloudflared gave, with Try again', async () => {
        state = stateOf({ stage: 'failed', message: 'Cannot determine default origin certificate path' });
        machine.answer('tunnel.retry', () => (state = stateOf()));
        await open();
        await until(() => everything().includes('Cannot determine default origin certificate path'));
        await clickOn(buttonWithText('Try again'));
        await until(() => machine.requests('tunnel.retry').length === 1);
    });

    test('lists a row per hostname with what it reaches, and says a dev server has no gate', async () => {
        state = stateOf({
            mcp: { enabled: true, port: 4230 },
            rows: [
                { id: 'a', kind: 'mcp', hostname: 'mcp-0123.example.com', port: null, enabled: true, comeBack: true },
                { id: 'b', kind: 'dev', hostname: 'shop.example.com', port: 3000, enabled: true, comeBack: false }
            ]
        });
        await open();
        await until(() => everything().includes('shop.example.com'));
        expect(everything()).toContain('Dev server on port 3000, open to anyone with the address');
        expect(everything()).toContain("Ruimte's MCP, guarded by a credential on every request");
        expect(everything()).toContain('Cloudflare ends the encryption at its edge');
    });

    test('shows the state of the tunnels to a window that does not manage them', async () => {
        // Another machine of the account: its state is readable here, and nothing on it changes from this window.
        const other = new FakeMachine();

        other.answer('tunnel.state', () => stateOf({ stage: 'not-installed', domain: null, clients: 2 }));
        useEndpoints.getState().add({
            id: 'tunnels-other',
            label: 'Build Mac',
            httpBaseUrl: 'http://127.0.0.1:2',
            wsBaseUrl: 'ws://127.0.0.1:2',
            reachability: 'lan',
            daemonId: null,
            daemonPublicKey: null
        });

        const stop = connectFakeMachine(other, 'tunnels-other');

        usePickedMachineState.getState().pick('tunnels-other');
        await open();
        await until(() => everything().includes('Tunnels are set up in the desktop app'));
        await until(() => everything().includes('cloudflared is not installed'));
        expect(everything()).toContain('2 clients used a credential lately');
        expect(buttonWithText('Install')).toBeNull();
        stop();
        usePickedMachineState.setState({ id: null });
    });
});

describe('the external MCP', () => {
    test('shows no address while it is off', async () => {
        await open();
        await until(() => everything().includes('Turn the external MCP on to get an address.'));
        expect(everything()).not.toContain('127.0.0.1');
    });

    test('turns on without a tunnel, which is how it works on loopback with no Cloudflare account', async () => {
        state = stateOf({ stage: 'signed-out', domain: null });
        machine.answer(
            'tunnel.setMcp',
            ({ enabled }) => (state = stateOf({ stage: 'signed-out', domain: null, mcp: { enabled, port: enabled ? 4230 : null } }))
        );
        await open();
        await until(() => document.querySelector('[role="switch"][aria-label="External MCP"]') !== null);
        await clickOn(document.querySelector('[role="switch"][aria-label="External MCP"]'));
        await until(() => everything().includes('http://127.0.0.1:4230/mcp'));
        expect(machine.requests('tunnel.setMcp')).toEqual([{ enabled: true }]);
    });

    test('shows its address on loopback once it is on', async () => {
        state = stateOf({ mcp: { enabled: true, port: 4230 } });
        await open();
        await until(() => everything().includes('http://127.0.0.1:4230/mcp'));
    });
});

describe('a bearer', () => {
    test('shows its secret once, and never again', async () => {
        state = stateOf({ mcp: { enabled: true, port: 4230 } });
        machine.answer('credential.create', (payload) => {
            const made: Credential = {
                id: 'cred-1',
                label: payload.label,
                kind: 'bearer',
                grant: { tier: 'work', projects: null, ceiling: 'supervised', approvals: false },
                bearerOnHostname: false,
                expiresAt: null,
                createdAt: 1,
                lastUsedAt: null
            };

            credentials = [made];

            return { credential: made, secret: 'rmb_only-shown-once' };
        });
        await open();
        await until(() => buttonWithText('New bearer') !== null);
        await clickOn(buttonWithText('New bearer'));
        await until(() => document.querySelector('input[maxlength="120"]') !== null);
        await typeInto(document.querySelector<HTMLInputElement>('input[maxlength="120"]')!, 'Hosted bot');
        await clickOn(buttonWithText('Make bearer'));
        await until(() => everything().includes('rmb_only-shown-once'));
        expect(everything()).toContain('Ruimte keeps only a hash and cannot show it again.');
        expect(machine.requests('credential.create')[0]).toMatchObject({
            label: 'Hosted bot',
            grant: { tier: 'work', projects: null, ceiling: 'supervised', approvals: false },
            bearerOnHostname: false,
            expiresAt: null
        });

        await clickOn(buttonWithText('Close'));
        await until(() => !everything().includes('rmb_only-shown-once'));
        await until(() => everything().includes('Hosted bot'));
        expect(everything()).not.toContain('rmb_only-shown-once');
    });

    test('says what the approvals box costs before it is ticked', async () => {
        state = stateOf({ mcp: { enabled: true, port: 4230 } });
        await open();
        await until(() => buttonWithText('New bearer') !== null);
        await clickOn(buttonWithText('New bearer'));
        await until(() => everything().includes('Let it answer approvals'));
        expect(everything()).toContain('Supervised then limits nothing, and the credential reaches about as far as a shell.');
    });
});

describe('the consent of a client that waits', () => {
    test('shows the client and the same code its page shows, with the defaults filled in', async () => {
        useConsent.setState({
            requests: [
                {
                    id: 'c1',
                    clientName: 'Hosted Claude',
                    clientUrl: 'https://client.example/meta.json',
                    code: 'K7QM2X',
                    requestedAt: 1,
                    defaults: { tier: 'work', projects: null, ceiling: 'supervised', approvals: false }
                }
            ]
        });
        machine.answer('consent.answer', () => ({ credential: null }));
        await page.render(<ConsentDialog />);
        await until(() => everything().includes('client.example wants to use Ruimte'));
        expect(everything()).toContain('K7QM2X');
        expect(everything()).toContain('https://client.example/meta.json');
        // The name the document gives comes after the host and is marked as unchecked.
        expect(everything()).toContain('It calls itself "Hosted Claude". Ruimte has not verified that name.');
        expect(everything()).not.toContain('Hosted Claude wants');
        expect(everything()).toContain('A client can read every terminal in the projects it may use.');

        await clickOn(buttonWithText('Approve'));
        await until(() => machine.requests('consent.answer').length === 1);
        expect(machine.requests('consent.answer')[0]).toMatchObject({
            id: 'c1',
            approve: true,
            grant: { tier: 'work', projects: null, ceiling: 'supervised', approvals: false }
        });
    });

    test('leads with the host of a client that claims a famous name, and shows one request at a time', async () => {
        const defaults = { tier: 'work', projects: null, ceiling: 'supervised', approvals: false } as const;

        useConsent.setState({
            requests: [
                { id: 'c1', clientName: 'Claude by Anthropic', clientUrl: 'https://evil.example/meta.json', code: 'AAAAAA', requestedAt: 1, defaults },
                { id: 'c2', clientName: 'Second', clientUrl: 'https://second.example/meta.json', code: 'BBBBBB', requestedAt: 2, defaults },
                { id: 'c3', clientName: 'Third', clientUrl: 'https://third.example/meta.json', code: 'CCCCCC', requestedAt: 3, defaults }
            ]
        });
        machine.answer('consent.answer', () => ({ credential: null }));
        await page.render(<ConsentDialog />);
        await until(() => everything().includes('evil.example wants to use Ruimte'));
        expect(everything()).not.toContain('Claude by Anthropic wants');
        expect(everything()).toContain('"Claude by Anthropic"');
        expect(everything()).toContain('2 more clients wait after this one.');
        expect(everything()).not.toContain('second.example wants');
        expect(everything()).not.toContain('BBBBBB');

        // Answered, the next one takes the place of the first. They never stand beside each other.
        await clickOn(buttonWithText('Deny'));
        await until(() => machine.requests('consent.answer').length === 1);
        act(() => useConsent.getState().setRequests(useConsent.getState().requests.slice(1)));
        await until(() => everything().includes('second.example wants to use Ruimte'));
        expect(everything()).not.toContain('evil.example wants');
    });
});

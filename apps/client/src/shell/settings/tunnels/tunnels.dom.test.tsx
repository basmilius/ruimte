import { afterEach, beforeEach, describe, expect, setSystemTime, test } from 'bun:test';
import type { Credential, TunnelState } from '@ruimte/contracts';
import { act } from 'react';
import { usePickedMachineState } from '@/shell/settings/picked-machine';
import { SettingsDialog } from '@/shell/SettingsDialog';
import { ConsentDialog } from '@/shell/tunnels/ConsentDialog';
import { useConsent } from '@/state/consent';
import { useEndpoints } from '@/state/endpoints';
import { useUi } from '@/state/ui';
import { clickOn, mount, until, type Mounted } from '../../../../testing/dom';
import { buttonWithText, everything, installDesktop, menuItem, removeDesktop, typeInto } from '../../../../testing/dom-helpers';
import { connectFakeMachine, FakeMachine } from '../../../../testing/fake-machine';
import { machineBridge } from '../../../../testing/machine-bridge';
import { TunnelsPane } from '../panes/TunnelsPane';

let page: Mounted;
let machine: FakeMachine;
let release: () => void;
let state: TunnelState;
let credentials: Credential[];

const ZONES = [
    { id: 'zone-bmnw', name: 'bmnw.nl' },
    { id: 'zone-passly', name: 'passly.dev' }
];

/* The state of a machine that has no token and no tunnel yet. */
function bareState(change: Partial<TunnelState> = {}): TunnelState {
    return stateOf({ stage: 'no-token', hasToken: false, accounts: [], account: null, zones: [], tunnel: null, suggestedMcpLabel: null, ...change });
}

function stateOf(change: Partial<TunnelState> = {}): TunnelState {
    return {
        stage: 'running',
        message: null,
        hasToken: true,
        accounts: [{ id: 'acc-1', name: 'Bas' }],
        account: { id: 'acc-1', name: 'Bas' },
        zones: ZONES,
        tunnel: { name: 'ruimte-studio' },
        rows: [],
        mcp: { enabled: false, port: null },
        clients: 0,
        suggestedMcpLabel: 'mcp-0123456789abcdef',
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

function tokenField(): HTMLInputElement | null {
    return document.querySelector<HTMLInputElement>('input[aria-label="Cloudflare API token"]');
}

/* The Add buttons of the hostnames section: the MCP row first, the dev server row last. */
function addButton(row: 'mcp' | 'dev'): HTMLButtonElement | null {
    const buttons = [...document.querySelectorAll<HTMLButtonElement>('button')].filter((button) => button.textContent?.trim() === 'Add');

    return (row === 'mcp' ? buttons[0] : buttons.at(-1)) ?? null;
}

async function open(): Promise<void> {
    await page.render(<TunnelsPane />);
    await until(() => everything().includes('Tunnels'));
}

describe('the states of the screen', () => {
    test('offers to install cloudflared first, and installs on a click', async () => {
        state = bareState({ stage: 'not-installed' });
        machine.answer('tunnel.install', () => (state = bareState({ stage: 'installing' })));
        await open();
        await until(() => buttonWithText('Install') !== null);
        await clickOn(buttonWithText('Install'));
        await until(() => everything().includes('Installing cloudflared'));
        expect(machine.requests('tunnel.install')).toHaveLength(1);
    });

    test('says what to install where cloudflared has no build', async () => {
        state = bareState({ stage: 'cannot-install', message: 'Install cloudflared yourself and put it on your path.' });
        await open();
        await until(() => everything().includes('Install cloudflared yourself and put it on your path.'));
        expect(buttonWithText('Install')).toBeNull();
    });

    test('asks for the API token, with a link to make one, and checks it on a click', async () => {
        const opened: string[] = [];

        installDesktop({ machine: machineBridge('local'), openExternal: async (url: string) => void opened.push(url) });
        state = bareState();
        machine.answer(
            'tunnel.setToken',
            () =>
                (state = bareState({
                    stage: 'no-tunnel',
                    hasToken: true,
                    accounts: [{ id: 'acc-1', name: 'Bas' }],
                    account: { id: 'acc-1', name: 'Bas' },
                    zones: ZONES
                }))
        );
        await open();
        await until(() => tokenField() !== null);
        expect(everything()).toContain('Zone read, DNS edit and Cloudflare Tunnel edit');
        expect(buttonWithText('Check token')?.disabled).toBe(true);

        await clickOn(buttonWithText('Make a token'));
        expect(opened).toHaveLength(1);

        const link = new URL(opened[0]!);

        expect(link.origin + link.pathname).toBe('https://dash.cloudflare.com/profile/api-tokens');
        expect(JSON.parse(link.searchParams.get('permissionGroupKeys')!)).toEqual([
            { key: 'zone', type: 'read' },
            { key: 'dns', type: 'edit' },
            { key: 'argotunnel', type: 'edit' }
        ]);

        const field = tokenField()!;

        expect(field.type).toBe('password');
        await typeInto(field, 'cf-api-token-0123456789');
        await clickOn(buttonWithText('Check token'));
        await until(() => buttonWithText('Create tunnel') !== null);
        expect(machine.requests('tunnel.setToken')).toEqual([{ token: 'cf-api-token-0123456789' }]);
        // The token leaves the field once it is sent, and the state never brings it back.
        expect(everything()).toContain('Cloudflare accepts this token. It reaches 2 domains on Bas.');
        expect(everything()).not.toContain('cf-api-token-0123456789');
    });

    test('says why Cloudflare refused a token, in the words the machine gave', async () => {
        state = bareState();
        machine.answer('tunnel.setToken', () => {
            throw new Error('Checking the API token failed. Cloudflare does not accept this API token; make a new one and paste it here.');
        });
        await open();
        await until(() => tokenField() !== null);
        await typeInto(tokenField()!, 'typed-wrong-0123456789');
        await clickOn(buttonWithText('Check token'));
        await until(() => everything().includes('Cloudflare does not accept this API token'));
        expect(buttonWithText('Check token')).not.toBeNull();
    });

    test('removes the token on request', async () => {
        machine.answer('tunnel.clearToken', () => (state = bareState()));
        await open();
        await until(() => buttonWithText('Remove token') !== null);
        await clickOn(buttonWithText('Remove token'));
        await until(() => tokenField() !== null);
        expect(machine.requests('tunnel.clearToken')).toHaveLength(1);
    });

    test('makes the tunnel, and asks which account when the token reaches more than one', async () => {
        const accounts = [
            { id: 'acc-1', name: 'Bas' },
            { id: 'acc-2', name: 'Studio' }
        ];

        state = stateOf({ stage: 'no-tunnel', tunnel: null, accounts, account: null, zones: [] });
        machine.answer('tunnel.setup', () => (state = stateOf({ account: accounts[1]!, zones: ZONES })));
        await open();
        await until(() => buttonWithText('Create tunnel') !== null);
        expect(buttonWithText('Create tunnel')?.disabled).toBe(true);

        await clickOn(document.querySelector('button[aria-label="Cloudflare account"], [aria-label="Cloudflare account"]'));
        await until(() => menuItem('Studio', 'option') !== null);
        await clickOn(menuItem('Studio', 'option'));
        await until(() => buttonWithText('Create tunnel')?.disabled === false);
        await clickOn(buttonWithText('Create tunnel'));
        await until(() => machine.requests('tunnel.setup').length === 1);
        expect(machine.requests('tunnel.setup')).toEqual([{ account: 'acc-2' }]);
    });

    test('makes the tunnel at once when the token reaches one account', async () => {
        state = stateOf({ stage: 'no-tunnel', tunnel: null });
        machine.answer('tunnel.setup', () => (state = stateOf()));
        await open();
        await until(() => buttonWithText('Create tunnel') !== null);
        await clickOn(buttonWithText('Create tunnel'));
        await until(() => machine.requests('tunnel.setup').length === 1);
        expect(machine.requests('tunnel.setup')).toEqual([{ account: 'acc-1' }]);
    });

    test('shows the sentence the machine gave, with Try again', async () => {
        state = stateOf({ stage: 'failed', message: 'Looking up the tunnel failed. Cloudflare could not find it.' });
        machine.answer('tunnel.retry', () => (state = stateOf()));
        await open();
        await until(() => everything().includes('Looking up the tunnel failed. Cloudflare could not find it.'));
        await clickOn(buttonWithText('Try again'));
        await until(() => machine.requests('tunnel.retry').length === 1);
    });

    test('shows that Cloudflare is being asked', async () => {
        state = stateOf({ stage: 'checking' });
        await open();
        await until(() => everything().includes('Checking with Cloudflare'));
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
        expect(everything()).toContain("Ruimte's MCP, which asks for a credential on every request");
        expect(everything()).toContain('Cloudflare ends the encryption at its edge');
    });

    test('shows the state of the tunnels to a window that does not manage them', async () => {
        // Another machine of the account: its state is readable here, and nothing on it changes from this window.
        const other = new FakeMachine();

        other.answer('tunnel.state', () => bareState({ stage: 'not-installed', clients: 2 }));
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

describe('the hostnames', () => {
    function inputNamed(name: string): HTMLInputElement {
        return document.querySelector<HTMLInputElement>(`input[aria-label="${name}"]`)!;
    }

    test('shows the tunnel by its name in Cloudflare', async () => {
        await open();
        await until(() => everything().includes('Tunnel ruimte-studio'));
        expect(everything()).toContain('Ruimte only changes the records it made.');
    });

    test('adds a dev server on a zone from the list: a label first, then a full hostname on the other zone', async () => {
        machine.answer('tunnel.add', () => state);
        await open();
        await until(() => inputNamed('Port') !== null);
        await typeInto(inputNamed('Port'), '3000');
        // A label is proposed from the port, in front of the first zone.
        expect(inputNamed('Label or hostname').value).toBe('dev-3000');

        await typeInto(inputNamed('Label or hostname'), 'shop');
        await clickOn(document.querySelector('input[type="checkbox"], [role="checkbox"]'));
        await clickOn(addButton('dev'));
        await until(() => machine.requests('tunnel.add').length === 1);
        expect(machine.requests('tunnel.add')[0]).toEqual({ kind: 'dev', zone: 'zone-bmnw', label: 'shop', port: 3000 });

        await typeInto(inputNamed('Port'), '3001');
        await typeInto(inputNamed('Label or hostname'), 'api-tunnel.passly.dev');
        // The MCP row has a domain list too; the dev server row is the last.
        await clickOn([...document.querySelectorAll('[aria-label="Domain"]')].at(-1) ?? null);
        await until(() => menuItem('.passly.dev', 'option') !== null);
        await clickOn(menuItem('.passly.dev', 'option'));
        await clickOn(document.querySelector('input[type="checkbox"], [role="checkbox"]'));
        await clickOn(addButton('dev'));
        await until(() => machine.requests('tunnel.add').length === 2);
        expect(machine.requests('tunnel.add')[1]).toEqual({ kind: 'dev', zone: 'zone-passly', label: 'api-tunnel.passly.dev', port: 3001 });
    });

    test('proposes a long random label for the MCP and adds it on the first zone', async () => {
        machine.answer('tunnel.add', () => state);
        await open();
        await until(() => inputNamed('MCP label or hostname') !== null);
        expect(inputNamed('MCP label or hostname').value).toBe('mcp-0123456789abcdef');

        await clickOn(addButton('mcp'));
        await until(() => machine.requests('tunnel.add').length === 1);
        expect(machine.requests('tunnel.add')[0]).toEqual({ kind: 'mcp', zone: 'zone-bmnw', label: 'mcp-0123456789abcdef' });
    });

    test('shows the refusal for a name that has a record Ruimte did not make', async () => {
        machine.answer('tunnel.add', () => {
            throw new Error('app.bmnw.nl already has a A record pointing at 203.0.113.9 that Ruimte did not make, so Ruimte leaves it alone.');
        });
        await open();
        await until(() => inputNamed('MCP label or hostname') !== null);
        await clickOn(addButton('mcp'));
        await until(() => everything().includes('app.bmnw.nl already has a A record'));
        expect(everything()).toContain('Ruimte leaves it alone.');
    });

    test('removes a hostname, which takes the record Ruimte made with it', async () => {
        state = stateOf({ rows: [{ id: 'b', kind: 'dev', hostname: 'shop.bmnw.nl', port: 3000, enabled: true, comeBack: false }] });
        machine.answer('tunnel.remove', () => (state = stateOf()));
        await open();
        await until(() => document.querySelector('button[aria-label="Remove shop.bmnw.nl"]') !== null);
        await clickOn(document.querySelector('button[aria-label="Remove shop.bmnw.nl"]'));
        await until(() => machine.requests('tunnel.remove').length === 1);
        expect(machine.requests('tunnel.remove')).toEqual([{ id: 'b' }]);
    });

    test('offers no hostnames before there is a tunnel and a token', async () => {
        state = stateOf({ stage: 'no-tunnel', tunnel: null });
        await open();
        await until(() => buttonWithText('Create tunnel') !== null);
        expect(everything()).not.toContain('Add a dev server');
    });
});

describe('the external MCP', () => {
    test('shows no address while it is off', async () => {
        await open();
        await until(() => everything().includes('Turn the external MCP on to get an address.'));
        expect(everything()).not.toContain('127.0.0.1');
    });

    test('turns on without a tunnel, which is how it works on loopback with no Cloudflare account', async () => {
        state = bareState();
        machine.answer('tunnel.setMcp', ({ enabled }) => (state = bareState({ mcp: { enabled, port: enabled ? 4230 : null } })));
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
        expect(everything()).toContain('Ruimte cannot show it again.');
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
        await until(() => everything().includes('Approve on your behalf'));
        expect(everything()).toContain('The client can then run shell commands on this machine as you.');
    });
});

describe('the use of a credential', () => {
    const NOW = 1_800_000_000_000;

    beforeEach(() => setSystemTime(NOW));
    afterEach(() => setSystemTime());

    function bearer(lastUsedAt: number | null): Credential {
        return {
            id: 'cred-1',
            label: 'Hosted bot',
            kind: 'bearer',
            grant: { tier: 'work', projects: null, ceiling: 'supervised', approvals: false },
            bearerOnHostname: false,
            expiresAt: null,
            createdAt: 1,
            lastUsedAt
        };
    }

    test('shows a first use while the pane stays open', async () => {
        state = stateOf({ mcp: { enabled: true, port: 4230 }, clients: 0 });
        credentials = [bearer(null)];
        await open();
        await until(() => everything().includes('never used'));
        expect(everything()).toContain('0 clients used a credential lately');

        state = stateOf({ mcp: { enabled: true, port: 4230 }, clients: 1 });
        credentials = [bearer(NOW - 2 * 60_000)];
        await act(async () => machine.emit('tunnel.changed', {}));
        await until(() => everything().includes('1 client used a credential lately'));
        expect(everything()).toContain('last used');
        expect(everything()).not.toContain('never used');
    });

    test('shows the clients of another machine as they use it', async () => {
        const other = new FakeMachine();
        let clients = 0;

        other.answer('tunnel.state', () => stateOf({ clients }));
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
        await until(() => everything().includes('0 clients used a credential lately'));

        clients = 1;
        await act(async () => other.emit('tunnel.changed', {}));
        await until(() => everything().includes('1 client used a credential lately'));
        stop();
        usePickedMachineState.setState({ id: null });
    });
});

describe('the subtitle of the pane', () => {
    test('is said once, in the header and not again in the first section', async () => {
        await page.render(<SettingsDialog />);
        await act(async () => useUi.getState().setSettings({ open: true, section: 'tunnels' }));

        const subtitle = "Reach Ruimte's MCP and your dev servers from outside";

        await until(() => everything().includes(subtitle));
        await until(() => everything().includes('Cloudflare ends the encryption'));

        // The dialog also gives the subtitle to screen readers, which a person does not see.
        const seen = [...document.querySelectorAll<HTMLElement>('*')].filter(
            (element) => element.children.length === 0 && element.textContent?.includes(subtitle) && element.closest('.sr-only') === null
        );

        expect(seen).toHaveLength(1);
        expect(seen[0]!.textContent).toContain('through your own Cloudflare account');
        useUi.getState().setSettings({ open: false });
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

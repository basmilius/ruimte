import { afterEach, beforeEach, describe, expect, setSystemTime, test } from 'bun:test';
import type { Credential, ProjectSummary, TunnelState } from '@ruimte/contracts';
import { act } from 'react';
import { usePickedMachineState } from '@/shell/settings/picked-machine';
import { SettingsDialog } from '@/shell/SettingsDialog';
import { ConsentDialog } from '@/shell/tunnels/ConsentDialog';
import { useConsent } from '@/state/consent';
import { useEndpoints } from '@/state/endpoints';
import { useProjectList } from '@/state/project-list';
import { useUi } from '@/state/ui';
import { clickOn, mount, pressKey, until, type Mounted } from '../../../../testing/dom';
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
        tunnel: { name: 'ruimte-studio-4f2a', created: true, runner: 'ruimte', others: [] },
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
    machine.answer('tunnel.list', () => ({ tunnels: [] }));
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
    return document.querySelector<HTMLInputElement>('input[aria-label="API token"]');
}

function dialog(): HTMLElement | null {
    return document.querySelector<HTMLElement>('[role="dialog"]');
}

function inputNamed(name: string): HTMLInputElement {
    return document.querySelector<HTMLInputElement>(`input[aria-label="${name}"]`)!;
}

/* The text of every cell of the tables, so a word in a header or a description does not count. */
function cells(): string[] {
    return [...document.querySelectorAll<HTMLElement>('[role="cell"]')].map((cell) => cell.textContent ?? '');
}

async function pick(select: string, option: string): Promise<void> {
    await clickOn(document.querySelector(`[aria-label="${select}"]`));
    await until(() => menuItem(option, 'option') !== null);
    await clickOn(menuItem(option, 'option'));
}

async function open(): Promise<void> {
    await page.render(<TunnelsPane />);
    await until(() => everything().includes('Cloudflare'));
}

describe('the Cloudflare card', () => {
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
        expect(everything()).toContain('Needs Zone read, DNS edit and Cloudflare Tunnel edit.');
        expect(buttonWithText('Check')?.disabled).toBe(true);

        await clickOn(buttonWithText('Make token'));
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
        await clickOn(buttonWithText('Check'));
        await until(() => buttonWithText('Use') !== null);
        expect(machine.requests('tunnel.setToken')).toEqual([{ token: 'cf-api-token-0123456789' }]);
        // The token leaves the field once it is sent, and the state never brings it back.
        expect(everything()).toContain('Reaches 2 domains on Bas.');
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
        await clickOn(buttonWithText('Check'));
        await until(() => everything().includes('Cloudflare does not accept this API token'));
        expect(buttonWithText('Check')).not.toBeNull();
    });

    test('removes the token on request', async () => {
        machine.answer('tunnel.clearToken', () => (state = bareState()));
        await open();
        await until(() => buttonWithText('Remove') !== null);
        await clickOn(buttonWithText('Remove'));
        await until(() => tokenField() !== null);
        expect(machine.requests('tunnel.clearToken')).toHaveLength(1);
    });

    test('makes a new tunnel, and asks which account when the token reaches more than one', async () => {
        const accounts = [
            { id: 'acc-1', name: 'Bas' },
            { id: 'acc-2', name: 'Studio' }
        ];

        state = stateOf({ stage: 'no-tunnel', tunnel: null, accounts, account: null, zones: [], zoneCount: 3 });
        machine.answer('tunnel.setup', () => (state = stateOf({ account: accounts[1]!, zones: ZONES })));
        await open();
        await until(() => buttonWithText('Use') !== null);
        expect(buttonWithText('Use')?.disabled).toBe(true);
        expect(everything()).toContain('Reaches 3 domains on 2 accounts.');

        await pick('Account', 'Studio');
        await until(() => buttonWithText('Use')?.disabled === false);
        expect(everything()).toContain('New tunnel');
        await clickOn(buttonWithText('Use'));
        await until(() => machine.requests('tunnel.setup').length === 1);
        expect(machine.requests('tunnel.setup')).toEqual([{ account: 'acc-2' }]);
    });

    test('makes a new tunnel at once when the token reaches one account', async () => {
        state = stateOf({ stage: 'no-tunnel', tunnel: null });
        machine.answer('tunnel.setup', () => (state = stateOf()));
        await open();
        await until(() => buttonWithText('Use') !== null);
        await clickOn(buttonWithText('Use'));
        await until(() => machine.requests('tunnel.setup').length === 1);
        expect(machine.requests('tunnel.setup')).toEqual([{ account: 'acc-1' }]);
    });

    test('takes no second press of Use while the first one makes the tunnel', async () => {
        state = stateOf({ stage: 'no-tunnel', tunnel: null });
        machine.answer('tunnel.setup', () => (state = stateOf({ stage: 'starting', tunnel: null })));
        await open();
        await until(() => buttonWithText('Use') !== null);
        await clickOn(buttonWithText('Use'));
        await until(() => buttonWithText('Use')?.disabled === true);
        expect(document.querySelector<HTMLButtonElement>('[aria-label="Which tunnel"]')?.disabled).toBe(true);
    });

    test('offers the usable tunnels of the account, and uses the one picked', async () => {
        state = stateOf({ stage: 'no-tunnel', tunnel: null });
        machine.answer('tunnel.list', () => ({
            tunnels: [
                { id: 'tun-office', name: 'office', usable: true, running: true },
                { id: 'tun-home', name: 'home-lab', usable: true, running: false },
                { id: 'tun-legacy', name: 'legacy', usable: false, running: true }
            ]
        }));
        machine.answer('tunnel.link', () => (state = stateOf({ tunnel: { name: 'office', created: false, runner: 'other', others: [] } })));
        await open();
        await until(() => machine.requests('tunnel.list').length === 1);
        expect(machine.requests('tunnel.list')).toEqual([{ account: 'acc-1' }]);

        await clickOn(document.querySelector('[aria-label="Which tunnel"]'));
        await until(() => menuItem('home-lab', 'option') !== null);
        // A tunnel managed in a file cannot take Ruimte's hostnames, so it is not offered.
        expect(menuItem('legacy', 'option')).toBeNull();
        await clickOn(menuItem('office', 'option'));
        await clickOn(buttonWithText('Use'));
        await until(() => machine.requests('tunnel.link').length === 1);
        expect(machine.requests('tunnel.link')).toEqual([{ account: 'acc-1', tunnel: 'tun-office' }]);
        await until(() => everything().includes('Runs outside Ruimte'));
        expect(everything()).toContain('office');
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

    test('shows the tunnel by its name, and that it runs on this computer', async () => {
        await open();
        await until(() => everything().includes('ruimte-studio-4f2a'));
        expect(everything()).toContain('Runs on this computer');
        expect(everything()).not.toContain('Already on this tunnel');
    });

    test('stops using the tunnel after a confirmation that says it stays in Cloudflare', async () => {
        machine.answer('tunnel.unlink', () => (state = stateOf({ stage: 'no-tunnel', tunnel: null })));
        await open();
        await until(() => buttonWithText('Stop using') !== null);
        await clickOn(buttonWithText('Stop using'));
        await until(() => everything().includes('The tunnel stays in Cloudflare.'));
        expect(machine.requests('tunnel.unlink')).toHaveLength(0);

        await clickOn(buttonWithText('Stop using', dialog() ?? document));
        await until(() => machine.requests('tunnel.unlink').length === 1);
        await until(() => buttonWithText('Use') !== null);
    });

    test('still stops using the tunnel once the token is gone, and says its hostnames stay in Cloudflare', async () => {
        const forgot = 'Ruimte forgot ruimte-studio-4f2a, but its hostnames and DNS records stay in Cloudflare.';

        state = stateOf({ stage: 'no-token', hasToken: false, accounts: [], account: null, zones: [] });
        machine.answer('tunnel.unlink', () => (state = bareState({ stage: 'failed', message: forgot })));
        await open();
        await until(() => buttonWithText('Stop using') !== null);
        expect(everything()).toContain('ruimte-studio-4f2a');
        expect(tokenField()).not.toBeNull();

        await clickOn(buttonWithText('Stop using'));
        await until(() => dialog() !== null);
        await clickOn(buttonWithText('Stop using', dialog() ?? document));
        await until(() => machine.requests('tunnel.unlink').length === 1);
        await until(() => everything().includes(forgot));
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
        await until(() => everything().includes('Set up tunnels in the app on that machine.'));
        await until(() => everything().includes('cloudflared not installed'));
        expect(everything()).toContain('2 clients active lately');
        expect(buttonWithText('Install')).toBeNull();
        stop();
        usePickedMachineState.setState({ id: null });
    });
});

describe('the hostnames', () => {
    test('lists the hostnames of Ruimte with where they point, and says Cloudflare reads the traffic', async () => {
        state = stateOf({
            mcp: { enabled: true, port: 4230 },
            rows: [
                { id: 'a', kind: 'mcp', hostname: 'mcp-0123.example.com', port: null, enabled: true, comeBack: true },
                { id: 'b', kind: 'dev', hostname: 'shop.example.com', port: 3000, enabled: true, comeBack: false }
            ]
        });
        await open();
        await until(() => cells().includes('shop.example.com'));
        expect(cells()).toContain('Ruimte MCP');
        expect(cells()).toContain('localhost:3000');
        expect(everything()).toContain('Cloudflare can read all traffic through a tunnel.');
        // Named by the hostname alone, so a switch that is off never says it is on.
        expect(document.querySelector('[role="switch"][aria-label="shop.example.com"]')).not.toBeNull();
    });

    test('says when there are no hostnames yet', async () => {
        await open();
        await until(() => everything().includes('No hostnames yet'));
    });

    test('shows the hostnames someone else put on the tunnel, without controls', async () => {
        state = stateOf({
            tunnel: {
                name: 'office',
                created: false,
                runner: 'other',
                others: [
                    { hostname: 'nas.bmnw.nl', path: null, service: 'http://localhost:3000' },
                    { hostname: 'shop.bmnw.nl', path: '/admin', service: 'https://10.0.0.5:8443' }
                ]
            }
        });
        await open();
        await until(() => everything().includes('Already on this tunnel'));
        expect(everything()).toContain('Runs outside Ruimte');
        expect(cells()).toContain('localhost:3000');
        expect(cells()).toContain('shop.bmnw.nl/admin');
        expect(cells()).toContain('10.0.0.5:8443');
        expect(document.querySelector('[aria-label="More for nas.bmnw.nl"], [role="switch"][aria-label="nas.bmnw.nl"]')).toBeNull();
    });

    test('adds a dev server in the dialog: a port from the list first, then another port on the other domain', async () => {
        machine.answer('tunnel.add', () => state);
        await open();
        await until(() => buttonWithText('Add hostname') !== null);
        await clickOn(buttonWithText('Add hostname'));
        await until(() => dialog() !== null);
        // Nothing guards a dev server, so the dialog says so before Add.
        expect(everything()).toContain('Anyone with the address reaches this dev server.');

        await pick('Port', '3000 · Vite');
        // A label is proposed from the port, in front of the first domain.
        await until(() => inputNamed('Label').value === 'dev-3000');
        await typeInto(inputNamed('Label'), 'shop');
        await clickOn(buttonWithText('Add', dialog()!));
        await until(() => machine.requests('tunnel.add').length === 1);
        expect(machine.requests('tunnel.add')[0]).toEqual({ kind: 'dev', zone: 'zone-bmnw', label: 'shop', port: 3000 });
        await until(() => dialog() === null);

        await clickOn(buttonWithText('Add hostname'));
        await until(() => dialog() !== null);
        await pick('Port', 'Other port');
        await until(() => document.querySelector('input[aria-label="Port"]') !== null);
        await typeInto(inputNamed('Port'), '3001');
        await typeInto(inputNamed('Label'), 'api-tunnel.passly.dev');
        await pick('Domain', '.passly.dev');
        await clickOn(buttonWithText('Add', dialog()!));
        await until(() => machine.requests('tunnel.add').length === 2);
        expect(machine.requests('tunnel.add')[1]).toEqual({ kind: 'dev', zone: 'zone-passly', label: 'api-tunnel.passly.dev', port: 3001 });
    });

    test('asks for a port on the computer that runs the tunnel when that is another one, without offering the ports here', async () => {
        state = stateOf({ tunnel: { name: 'office', created: false, runner: 'other', others: [] } });
        await open();
        await until(() => buttonWithText('Add hostname') !== null);
        await clickOn(buttonWithText('Add hostname'));
        await until(() => dialog() !== null);
        expect(document.querySelector('input[aria-label="Port"]')).not.toBeNull();

        await typeInto(inputNamed('Port'), '8080');
        await until(() => everything().includes('Points to port 8080 on the computer that runs this tunnel.'));
        expect(machine.requests('tunnel.discover')).toEqual([]);
    });

    test('proposes a long random label for the MCP and adds it on the first domain, without a port', async () => {
        machine.answer('tunnel.add', () => state);
        await open();
        await until(() => buttonWithText('Add hostname') !== null);
        await clickOn(buttonWithText('Add hostname'));
        await until(() => dialog() !== null);
        await clickOn([...document.querySelectorAll('[role="radio"]')].find((radio) => radio.textContent === 'Ruimte MCP') ?? null);
        await until(() => inputNamed('Label').value === 'mcp-0123456789abcdef');
        expect(document.querySelector('[aria-label="Port"]')).toBeNull();
        expect(everything()).not.toContain('Anyone with the address');

        await clickOn(buttonWithText('Add', dialog()!));
        await until(() => machine.requests('tunnel.add').length === 1);
        expect(machine.requests('tunnel.add')[0]).toEqual({ kind: 'mcp', zone: 'zone-bmnw', label: 'mcp-0123456789abcdef' });
    });

    test('adds a dev server with a host header and https under Advanced', async () => {
        machine.answer('tunnel.add', () => state);
        await open();
        await until(() => buttonWithText('Add hostname') !== null);
        await clickOn(buttonWithText('Add hostname'));
        await until(() => dialog() !== null);
        expect(document.querySelector('input[aria-label="Host header"]')).toBeNull();

        await pick('Port', 'Other port');
        await until(() => document.querySelector('input[aria-label="Port"]') !== null);
        await typeInto(inputNamed('Port'), '443');
        await typeInto(inputNamed('Label'), 'passly');
        await clickOn(buttonWithText('Advanced', dialog()!));
        await until(() => document.querySelector('input[aria-label="Host header"]') !== null);
        await typeInto(inputNamed('Host header'), 'passly.test');
        // The certificate settings only mean something with https.
        expect(document.querySelector('[aria-label="Skip TLS check"]')).toBeNull();

        await clickOn([...document.querySelectorAll('[role="radio"]')].find((radio) => radio.textContent === 'HTTPS') ?? null);
        await until(() => document.querySelector('[aria-label="Skip TLS check"]') !== null);
        await clickOn(document.querySelector('[role="checkbox"][aria-label="Skip TLS check"]')?.closest('label') ?? null);
        await clickOn(buttonWithText('Add', dialog()!));
        await until(() => machine.requests('tunnel.add').length === 1);
        expect(machine.requests('tunnel.add')[0]).toEqual({
            kind: 'dev',
            zone: 'zone-bmnw',
            label: 'passly',
            port: 443,
            origin: { https: true, hostHeader: 'passly.test', noTlsVerify: true }
        });
    });

    test('edits the port and host header of a dev server from its menu, with the hostname fixed', async () => {
        state = stateOf({
            rows: [{ id: 'b', kind: 'dev', hostname: 'passly.bmnw.nl', port: 80, enabled: true, comeBack: false, origin: { hostHeader: 'passly.test' } }]
        });
        machine.answer('tunnel.update', () => state);
        await open();
        await until(() => cells().includes('localhost:80 · passly.test'));
        await clickOn(document.querySelector('button[aria-label="More for passly.bmnw.nl"]'));
        await until(() => menuItem('Edit') !== null);
        await clickOn(menuItem('Edit'));
        await until(() => dialog()?.textContent?.includes('Edit hostname') === true);
        expect(dialog()?.textContent).toContain('passly.bmnw.nl');
        expect(document.querySelector('input[aria-label="Label"]')).toBeNull();
        // Advanced is open, since the row has a setting there.
        expect(inputNamed('Host header').value).toBe('passly.test');
        expect(inputNamed('Port').value).toBe('80');

        await typeInto(inputNamed('Port'), '8080');
        await typeInto(inputNamed('Host header'), '');
        await clickOn(buttonWithText('Save', dialog()!));
        await until(() => machine.requests('tunnel.update').length === 1);
        expect(machine.requests('tunnel.update')[0]).toEqual({ id: 'b', port: 8080, origin: {} });
    });

    test('offers no Edit for the MCP, and shows the host header of a rule someone else made', async () => {
        state = stateOf({
            mcp: { enabled: true, port: 4230 },
            rows: [{ id: 'a', kind: 'mcp', hostname: 'mcp-0123.bmnw.nl', port: null, enabled: true, comeBack: true }],
            tunnel: {
                name: 'office',
                created: false,
                runner: 'other',
                others: [{ hostname: 'nas.bmnw.nl', path: null, service: 'http://localhost:80', hostHeader: 'nas.local' }]
            }
        });
        await open();
        await until(() => cells().includes('localhost:80 · nas.local'));
        await clickOn(document.querySelector('button[aria-label="More for mcp-0123.bmnw.nl"]'));
        await until(() => menuItem('Copy address') !== null);
        expect(menuItem('Edit')).toBeNull();
    });

    test('opens the dialog empty again after a cancel', async () => {
        await open();
        await until(() => buttonWithText('Add hostname') !== null);
        await clickOn(buttonWithText('Add hostname'));
        await until(() => dialog() !== null);
        await typeInto(inputNamed('Label'), 'shop');
        await clickOn(buttonWithText('Cancel', dialog()!));
        await until(() => dialog() === null);

        await clickOn(buttonWithText('Add hostname'));
        await until(() => dialog() !== null);
        expect(inputNamed('Label').value).toBe('');
    });

    test('shows the refusal for a name that has a record Ruimte did not make in the dialog', async () => {
        machine.answer('tunnel.add', () => {
            throw new Error('app.bmnw.nl already has a A record pointing at 203.0.113.9 that Ruimte did not make, so Ruimte leaves it alone.');
        });
        await open();
        await until(() => buttonWithText('Add hostname') !== null);
        await clickOn(buttonWithText('Add hostname'));
        await until(() => dialog() !== null);
        await pick('Port', '3000 · Vite');
        await clickOn(buttonWithText('Add', dialog()!));
        await until(() => dialog()?.textContent?.includes('app.bmnw.nl already has a A record') === true);
        expect(dialog()?.textContent).toContain('Ruimte leaves it alone.');
    });

    test('proposes a label that follows every digit of the port until the person types one of their own', async () => {
        await open();
        await until(() => buttonWithText('Add hostname') !== null);
        await clickOn(buttonWithText('Add hostname'));
        await until(() => dialog() !== null);
        await pick('Port', 'Other port');
        await until(() => document.querySelector('input[aria-label="Port"]') !== null);
        await typeInto(inputNamed('Port'), '4');
        expect(inputNamed('Label').value).toBe('dev-4');

        await typeInto(inputNamed('Port'), '4299');
        expect(inputNamed('Label').value).toBe('dev-4299');

        await typeInto(inputNamed('Label'), 'shop');
        await typeInto(inputNamed('Port'), '3000');
        expect(inputNamed('Label').value).toBe('shop');
    });

    test('adds with Enter in a field, and saves an edit with Enter', async () => {
        state = stateOf({ rows: [{ id: 'b', kind: 'dev', hostname: 'passly.bmnw.nl', port: 80, enabled: true, comeBack: false }] });
        machine.answer('tunnel.add', () => state);
        machine.answer('tunnel.update', () => state);
        await open();
        await until(() => buttonWithText('Add hostname') !== null);
        await clickOn(buttonWithText('Add hostname'));
        await until(() => dialog() !== null);
        await pick('Port', 'Other port');
        await until(() => document.querySelector('input[aria-label="Port"]') !== null);
        await typeInto(inputNamed('Port'), '5173');
        await pressKey(inputNamed('Label'), 'Enter');
        await until(() => machine.requests('tunnel.add').length === 1);
        expect(machine.requests('tunnel.add')[0]).toEqual({ kind: 'dev', zone: 'zone-bmnw', label: 'dev-5173', port: 5173 });
        await until(() => dialog() === null);

        await clickOn(document.querySelector('button[aria-label="More for passly.bmnw.nl"]'));
        await until(() => menuItem('Edit') !== null);
        await clickOn(menuItem('Edit'));
        await until(() => dialog()?.textContent?.includes('Edit hostname') === true);
        await typeInto(inputNamed('Port'), '8080');
        await pressKey(inputNamed('Port'), 'Enter');
        await until(() => machine.requests('tunnel.update').length === 1);
        expect(machine.requests('tunnel.update')[0]).toEqual({ id: 'b', port: 8080, origin: {} });
    });

    test('keeps the dialog open and busy while Cloudflare takes the new hostname, then closes it', async () => {
        let answer: (next: TunnelState) => void = () => undefined;

        machine.answer('tunnel.add', () => new Promise<TunnelState>((resolve) => (answer = resolve)));
        await open();
        await until(() => buttonWithText('Add hostname') !== null);
        await clickOn(buttonWithText('Add hostname'));
        await until(() => dialog() !== null);
        await pick('Port', '3000 · Vite');
        await clickOn(buttonWithText('Add', dialog()!));
        await until(() => machine.requests('tunnel.add').length === 1);
        expect(buttonWithText('Add', dialog()!)?.disabled).toBe(true);
        expect(buttonWithText('Cancel', dialog()!)?.disabled).toBe(true);
        expect(inputNamed('Label').disabled).toBe(true);

        // A second Enter while the first add is on its way sends nothing.
        await pressKey(inputNamed('Label'), 'Enter');
        expect(machine.requests('tunnel.add')).toHaveLength(1);

        await act(async () => answer(state));
        await until(() => dialog() === null);
    });

    test('shows a hostname busy while its removal is on its way, with its controls held', async () => {
        let answer: (next: TunnelState) => void = () => undefined;

        state = stateOf({ rows: [{ id: 'b', kind: 'dev', hostname: 'shop.bmnw.nl', port: 3000, enabled: false, comeBack: false }] });
        machine.answer('tunnel.remove', () => new Promise<TunnelState>((resolve) => (answer = resolve)));
        await open();
        await until(() => document.querySelector('button[aria-label="More for shop.bmnw.nl"]') !== null);
        await clickOn(document.querySelector('button[aria-label="More for shop.bmnw.nl"]'));
        await until(() => menuItem('Remove') !== null);
        await clickOn(menuItem('Remove'));
        await until(() => document.querySelector('[aria-label="Changing shop.bmnw.nl"]') !== null);
        expect(document.querySelector<HTMLButtonElement>('button[aria-label="More for shop.bmnw.nl"]')?.disabled).toBe(true);
        expect(document.querySelector('[role="switch"][aria-label="shop.bmnw.nl"]')?.hasAttribute('data-disabled')).toBe(true);

        await act(async () => answer((state = stateOf())));
        await until(() => everything().includes('No hostnames yet'));
        expect(document.querySelector('[aria-label="Changing shop.bmnw.nl"]')).toBeNull();
    });

    test('finds a domain by typing when the account has many', async () => {
        const zones = Array.from({ length: 12 }, (_, index) => ({ id: `zone-${index}`, name: `site-${index}.nl` }));

        state = stateOf({ zones: [...zones, { id: 'zone-passly', name: 'passly.dev' }] });
        machine.answer('tunnel.add', () => state);
        await open();
        await until(() => buttonWithText('Add hostname') !== null);
        await clickOn(buttonWithText('Add hostname'));
        await until(() => dialog() !== null);
        await clickOn(document.querySelector('[aria-label="Domain"]'));
        await until(() => document.querySelector('input[aria-label="Find domain"]') !== null);
        await typeInto(document.querySelector<HTMLInputElement>('input[aria-label="Find domain"]')!, 'passly');
        await until(() => document.querySelectorAll('[role="option"]').length === 1);
        await clickOn(menuItem('.passly.dev', 'option'));
        await until(() => document.querySelector('[aria-label="Domain"]')?.textContent?.includes('.passly.dev') === true);
    });

    test('shows the table loading while Cloudflare is asked, instead of saying there are no hostnames', async () => {
        state = stateOf({ stage: 'checking' });
        await open();
        await until(() => document.querySelector('[role="rowgroup"][aria-busy="true"][aria-label="Loading"]') !== null);
        expect(everything()).not.toContain('No hostnames yet');
    });

    test('removes a hostname from its menu', async () => {
        state = stateOf({ rows: [{ id: 'b', kind: 'dev', hostname: 'shop.bmnw.nl', port: 3000, enabled: true, comeBack: false }] });
        machine.answer('tunnel.remove', () => (state = stateOf()));
        await open();
        await until(() => document.querySelector('button[aria-label="More for shop.bmnw.nl"]') !== null);
        await clickOn(document.querySelector('button[aria-label="More for shop.bmnw.nl"]'));
        await until(() => menuItem('Remove') !== null);
        expect(menuItem('Copy address')).not.toBeNull();
        await clickOn(menuItem('Remove'));
        await until(() => machine.requests('tunnel.remove').length === 1);
        expect(machine.requests('tunnel.remove')).toEqual([{ id: 'b' }]);
    });

    test('keeps the hostnames when the tunnel failed, with the reason in its line', async () => {
        state = stateOf({
            stage: 'failed',
            message: 'cloudflared stopped with code 1',
            rows: [{ id: 'b', kind: 'dev', hostname: 'shop.example.com', port: 3000, enabled: true, comeBack: false }]
        });
        await open();
        await until(() => cells().includes('shop.example.com'));
        expect(everything()).toContain('cloudflared stopped with code 1');
        expect(buttonWithText('Add hostname')).not.toBeNull();
    });

    test('marks a hostname that is on but not reachable in its own row, and offers Try again', async () => {
        state = stateOf({
            rows: [
                { id: 'a', kind: 'dev', hostname: 'shop.example.com', port: 3000, enabled: true, comeBack: false },
                { id: 'b', kind: 'dev', hostname: 'blog.example.com', port: 4210, enabled: true, comeBack: false, reason: 'Port 4210 belongs to Ruimte itself' }
            ]
        });
        await open();
        await until(() => cells().includes('blog.example.comNot reachablePort 4210 belongs to Ruimte itself'));
        expect(cells()).toContain('shop.example.com');
        expect(buttonWithText('Try again')).not.toBeNull();
    });

    test('lets the keyboard reach the reason of a hostname that is not reachable', async () => {
        state = stateOf({
            rows: [
                { id: 'b', kind: 'dev', hostname: 'blog.example.com', port: 3000, enabled: true, comeBack: false, reason: 'Cloudflare refused its DNS record' }
            ]
        });
        await open();
        await until(() => cells().includes('blog.example.comNot reachableCloudflare refused its DNS record'));

        const reason = [...document.querySelectorAll<HTMLElement>('[role="cell"] span')].find(
            (span) => span.textContent === 'Cloudflare refused its DNS record'
        );

        expect(reason?.tabIndex).toBe(0);
    });

    test('offers no hostnames before there is a tunnel and a token', async () => {
        state = stateOf({ stage: 'no-tunnel', tunnel: null });
        await open();
        await until(() => buttonWithText('Use') !== null);
        expect(buttonWithText('Add hostname')).toBeNull();
    });
});

describe('the external MCP', () => {
    test('shows no address while it is off', async () => {
        await open();
        await until(() => document.querySelector('[role="switch"][aria-label="External MCP"]') !== null);
        expect(everything()).not.toContain('127.0.0.1');
        expect(buttonWithText('New bearer')?.disabled).toBe(true);
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

    test('says at its switch that it is not running while its port is taken, and still offers to make a tunnel', async () => {
        state = stateOf({
            stage: 'no-tunnel',
            tunnel: null,
            mcp: { enabled: true, port: null, failure: 'The MCP listener did not start. Failed to start server. Is port 4230 in use?' }
        });
        await open();
        await until(() => everything().includes('Not running. Another app may be using its port.'));
        expect(buttonWithText('Use')).not.toBeNull();
    });

    // Council rounds 16 and 17: no Cloudflare row offered Try again here, and the machine's Try again would install cloudflared.
    test.each([
        ['before cloudflared is installed', () => bareState({ stage: 'not-installed' })],
        [
            'where cloudflared cannot be installed',
            () => bareState({ stage: 'cannot-install', message: 'Install cloudflared yourself and put it on your path.' })
        ],
        ['without a token', bareState],
        ['without a tunnel', () => stateOf({ stage: 'no-tunnel', tunnel: null })]
    ])('starts only the listener again from its switch while it is not running, %s', async (_name, base) => {
        const failed = { enabled: true, port: null, failure: 'The MCP listener did not start. Failed to start server. Is port 4230 in use?' };

        state = { ...base(), mcp: failed };
        machine.answer('tunnel.setMcp', ({ enabled }) => (state = { ...base(), mcp: { enabled, port: 4230 } }));
        await open();
        await until(() => everything().includes('Not running. Another app may be using its port.'));
        await clickOn(buttonWithText('Try again'));
        await until(() => everything().includes('http://127.0.0.1:4230/mcp'));
        expect(machine.requests('tunnel.setMcp')).toEqual([{ enabled: true }]);
        expect(machine.requests('tunnel.retry')).toEqual([]);
        expect(machine.requests('tunnel.install')).toEqual([]);
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
        expect(everything()).toContain('No clients yet');
        await clickOn(buttonWithText('New bearer'));
        await until(() => document.querySelector('input[maxlength="120"]') !== null);
        await typeInto(document.querySelector<HTMLInputElement>('input[maxlength="120"]')!, 'Hosted bot');
        await clickOn(buttonWithText('Create'));
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
        await until(() => cells().some((cell) => cell.includes('Hosted bot')));
        expect(cells().some((cell) => cell.includes('Never expires'))).toBe(true);
        expect(cells()).toContain('Bearer');
        expect(cells()).toContain('Work · All projects');
        expect(everything()).not.toContain('rmb_only-shown-once');
    });

    test('says what the approvals box costs before it is ticked', async () => {
        state = stateOf({ mcp: { enabled: true, port: 4230 } });
        await open();
        await until(() => buttonWithText('New bearer') !== null);
        await clickOn(buttonWithText('New bearer'));
        await until(() => everything().includes('Approve on your behalf'));
        expect(everything()).toContain('The client can run shell commands on this machine as you.');
    });

    test('reaches only the projects ticked in the table, and the head ticks them all', async () => {
        const summary = (projectId: string, name: string, scratch = false): ProjectSummary => ({
            projectId,
            name,
            closedAt: null,
            color: '#000',
            folder: `/work/${projectId}`,
            lastOpenedAt: 1,
            available: true,
            icon: { kind: 'initial', value: name[0]! },
            nameSource: 'chosen',
            ...(scratch ? { scratch: true } : {})
        });

        useProjectList.setState({
            projects: [
                { endpointId: 'local', summary: summary('p-shop', 'Shop') },
                { endpointId: 'local', summary: summary('p-site', 'Site') },
                { endpointId: 'local', summary: summary('p-chats', 'Chats', true) }
            ]
        });
        state = stateOf({ mcp: { enabled: true, port: 4230 } });
        machine.answer('credential.create', () => {
            throw new Error('stop here');
        });
        await open();
        await until(() => buttonWithText('New bearer') !== null);
        await clickOn(buttonWithText('New bearer'));
        await until(() => dialog() !== null);
        await clickOn([...document.querySelectorAll('[role="radio"]')].find((radio) => radio.textContent === 'Selected') ?? null);
        await until(() => document.querySelector('[role="table"][aria-label="Projects"]') !== null);
        expect(cells()).toContain('/work/p-shop');
        expect(cells()).not.toContain('/work/p-chats');
        // The box is the one tab stop of a row.
        expect(document.querySelectorAll('[role="table"][aria-label="Projects"] [role="row"][tabindex]')).toHaveLength(0);

        // A click on the row ticks it, as the box does.
        await clickOn([...document.querySelectorAll('[role="row"]')].find((row) => row.textContent?.includes('Site')) ?? null);
        await typeInto(document.querySelector<HTMLInputElement>('input[maxlength="120"]')!, 'Hosted bot');
        await clickOn(buttonWithText('Create'));
        await until(() => machine.requests('credential.create').length === 1);
        expect(machine.requests('credential.create')[0]).toMatchObject({ grant: { projects: ['p-site'] } });

        await clickOn(document.querySelector('[role="checkbox"][aria-label="All projects"]'));
        await clickOn(buttonWithText('Create'));
        await until(() => machine.requests('credential.create').length === 2);
        expect(machine.requests('credential.create')[1]).toMatchObject({ grant: { projects: ['p-shop', 'p-site', 'p-chats'] } });
        useProjectList.setState({ projects: [] });
    });
});

describe('the use of a credential', () => {
    const NOW = 1_800_000_000_000;

    beforeEach(() => setSystemTime(NOW));
    afterEach(() => setSystemTime());

    function bearer(lastUsedAt: number | null, expiresAt: number | null = null): Credential {
        return {
            id: 'cred-1',
            label: 'Hosted bot',
            kind: 'bearer',
            grant: { tier: 'work', projects: ['p-1', 'p-2'], ceiling: 'supervised', approvals: true },
            bearerOnHostname: false,
            expiresAt,
            createdAt: 1,
            lastUsedAt
        };
    }

    test('shows a first use while the pane stays open', async () => {
        state = stateOf({ mcp: { enabled: true, port: 4230 } });
        credentials = [bearer(null, NOW + 28 * 24 * 3_600_000)];
        await open();
        await until(() => cells().includes('Never'));
        expect(cells().some((cell) => cell.includes('Expires in 28 days'))).toBe(true);
        expect(cells()).toContain('Work · 2 projects · Approves');

        credentials = [bearer(NOW - 2 * 60_000, NOW + 28 * 24 * 3_600_000)];
        await act(async () => machine.emit('tunnel.changed', {}));
        await until(() => !cells().includes('Never'));
    });

    test('says a credential expired', async () => {
        state = stateOf({ mcp: { enabled: true, port: 4230 } });
        credentials = [bearer(null, NOW - 1)];
        await open();
        await until(() => cells().some((cell) => cell.includes('Expired')));
    });

    test('revokes a client from its menu, after a confirmation', async () => {
        state = stateOf({ mcp: { enabled: true, port: 4230 } });
        credentials = [bearer(null)];
        machine.answer('credential.revoke', () => {
            credentials = [];

            return {};
        });
        await open();
        await until(() => document.querySelector('button[aria-label="More for Hosted bot"]') !== null);
        await clickOn(document.querySelector('button[aria-label="More for Hosted bot"]'));
        await until(() => menuItem('Revoke') !== null);
        await clickOn(menuItem('Revoke'));
        await until(() => everything().includes('It loses access on its next request.'));
        expect(machine.requests('credential.revoke')).toHaveLength(0);

        await clickOn(buttonWithText('Revoke', dialog() ?? document));
        await until(() => machine.requests('credential.revoke').length === 1);
        expect(machine.requests('credential.revoke')).toEqual([{ id: 'cred-1' }]);
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
        await until(() => everything().includes('0 clients active lately'));

        clients = 1;
        await act(async () => other.emit('tunnel.changed', {}));
        await until(() => everything().includes('1 client active lately'));
        stop();
        usePickedMachineState.setState({ id: null });
    });
});

describe('the subtitle of the pane', () => {
    test('is said once, in the header and not again in the first section', async () => {
        await page.render(<SettingsDialog />);
        await act(async () => useUi.getState().setSettings({ open: true, section: 'tunnels' }));

        const subtitle = "Reach Ruimte's MCP and your dev servers from outside.";

        await until(() => everything().includes(subtitle));
        await until(() => everything().includes('Cloudflare can read all traffic'));

        // The dialog also gives the subtitle to screen readers, which a person does not see.
        const seen = [...document.querySelectorAll<HTMLElement>('*')].filter(
            (element) => element.children.length === 0 && element.textContent?.includes(subtitle) && element.closest('.sr-only') === null
        );

        expect(seen).toHaveLength(1);
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
        await until(() => everything().includes('client.example wants access'));
        expect(everything()).toContain('K7QM2X');
        expect(everything()).toContain('https://client.example/meta.json');
        // The name the document gives comes after the host and is marked as unchecked.
        expect(everything()).toContain('Calls itself "Hosted Claude" (not verified).');
        expect(everything()).not.toContain('Hosted Claude wants');
        expect(everything()).toContain('It can read every terminal in the projects it reaches.');

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
        await until(() => everything().includes('evil.example wants access'));
        expect(everything()).not.toContain('Claude by Anthropic wants');
        expect(everything()).toContain('"Claude by Anthropic"');
        expect(everything()).toContain('2 more waiting');
        expect(everything()).not.toContain('second.example wants');
        expect(everything()).not.toContain('BBBBBB');

        // Answered, the next one takes the place of the first. They never stand beside each other.
        await clickOn(buttonWithText('Deny'));
        await until(() => machine.requests('consent.answer').length === 1);
        act(() => useConsent.getState().setRequests(useConsent.getState().requests.slice(1)));
        await until(() => everything().includes('second.example wants access'));
        expect(everything()).not.toContain('evil.example wants');
    });
});

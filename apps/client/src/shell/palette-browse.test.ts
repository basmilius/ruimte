import { describe, expect, test } from 'bun:test';
import type { Machine } from '@ruimte/pulsar';
import { mergeMachines } from '@/shell/settings/machine-list';
import type { Endpoint } from '@/state/endpoints';
import type { ConnectionState } from '@/transport/transport';
import {
    browseBack,
    browseMachines,
    browseStart,
    folderPresence,
    joinPath,
    linkDot,
    linkHint,
    machineLink,
    machinesStep,
    openBrowse,
    paletteStart,
    parentOf,
    pickMachine,
    retryLink,
    separatorFor,
    settleLink,
    type BrowseStep
} from './palette-browse';

describe('separatorFor', () => {
    test('a Windows daemon answers in backslashes, every other one in slashes', () => {
        expect(separatorFor('win32')).toBe('\\');
        expect(separatorFor('darwin')).toBe('/');
        expect(separatorFor(null)).toBe('/');
    });
});

describe('parentOf', () => {
    test('one level up a POSIX path, with the separator a browse needs', () => {
        expect(parentOf('/a/b/c/', '/')).toBe('/a/b/');
        expect(parentOf('/a/b/c', '/')).toBe('/a/b/');
        expect(parentOf('/a', '/')).toBe('/');
        expect(parentOf('~/projects', '/')).toBe('~/');
    });

    test('one level up a Windows path', () => {
        expect(parentOf('C:\\a\\b', '\\')).toBe('C:\\a\\');
        expect(parentOf('C:\\a', '\\')).toBe('C:\\');
    });

    test('a root has nowhere to go', () => {
        expect(parentOf('/', '/')).toBeNull();
        expect(parentOf('C:\\', '\\')).toBeNull();
        expect(parentOf('~/', '/')).toBeNull();
        expect(parentOf('', '/')).toBeNull();
    });
});

describe('joinPath', () => {
    test('a folder inside a directory, whatever the directory ends in', () => {
        expect(joinPath('/a/b/', 'c', '/')).toBe('/a/b/c');
        expect(joinPath('/a/b', 'c', '/')).toBe('/a/b/c');
        expect(joinPath('/', 'c', '/')).toBe('/c');
        expect(joinPath('C:\\a\\', 'b', '\\')).toBe('C:\\a\\b');
    });
});

describe('folderPresence', () => {
    const listing = { entries: [{ name: 'projects' }, { name: 'Pictures' }], exists: true };

    test('a path ending in a separator is answered by exists alone', () => {
        expect(folderPresence('~/projects/', listing, '/')).toBe('there');
        expect(folderPresence('~/nope/', { entries: [], exists: false }, '/')).toBe('missing');
    });

    test('without a separator the last segment has to be a name that came back, exactly', () => {
        expect(folderPresence('~/projects', listing, '/')).toBe('there');
        expect(folderPresence('~/pro', listing, '/')).toBe('missing');
        expect(folderPresence('~/pictures', listing, '/')).toBe('missing');
    });

    test('a daemon that does not know the field leaves the question open', () => {
        expect(folderPresence('~/projects/', { entries: [] }, '/')).toBe('unknown');
        expect(folderPresence('~/projects/', null, '/')).toBe('unknown');
    });
});

describe('browseStart', () => {
    test('nothing set is the home of the machine being browsed, whatever its separator', () => {
        expect(browseStart('', '/home/bas', '/')).toEqual({ start: '/home/bas/', home: '/home/bas/' });
        expect(browseStart('   ', 'C:\\Users\\bas', '\\')).toEqual({ start: 'C:\\Users\\bas\\', home: 'C:\\Users\\bas\\' });
    });

    test('a daemon that has not said where home is leaves the tilde for it to expand', () => {
        expect(browseStart('', null, '/')).toEqual({ start: '~/', home: '~/' });
    });

    test('the folder that was set is listed whole, with home behind it to fall back to', () => {
        expect(browseStart('~/projects', '/home/bas', '/')).toEqual({ start: '~/projects/', home: '/home/bas/' });
        expect(browseStart('~/projects/', '/home/bas', '/')).toEqual({ start: '~/projects/', home: '/home/bas/' });
    });
});

const KEY = 'A'.repeat(43);

const paired = (id: string, overrides: Partial<Endpoint> = {}): Endpoint => ({
    id,
    label: `Row ${id}`,
    httpBaseUrl: `http://${id}`,
    wsBaseUrl: `ws://${id}`,
    reachability: 'lan',
    token: null,
    daemonId: id,
    daemonPublicKey: KEY,
    ...overrides
});

const record = (id: string, overrides: Partial<Machine> = {}): Machine => ({
    id,
    name: `Account ${id}`,
    icon: null,
    publicKey: KEY,
    brokerUrl: 'wss://broker.example.com',
    lastSeenAt: null,
    ...overrides
});

const localRow = paired('local', { label: 'This machine', daemonId: 'home', daemonPublicKey: null, reachability: 'loopback' });

const OPEN: ConnectionState = { status: 'open', attempts: 0, retryAt: null, failure: null };
const NO_LINK: ConnectionState = { status: 'closed', attempts: 0, retryAt: null, failure: null };

describe('browseMachines', () => {
    test('every machine the client knows, deduplicated with the account, this machine first', () => {
        const entries = mergeMachines({
            endpoints: [paired('studio'), localRow],
            accountMachines: [record('studio'), record('home'), record('attic')],
            showLocal: true
        });
        const rows = browseMachines(entries, 'studio');
        expect(rows.map((row) => row.endpointId)).toEqual(['local', 'studio', 'attic']);
        expect(rows.map((row) => row.label)).toEqual(['This machine', 'Row studio', 'Account attic']);
        expect(rows.map((row) => row.active)).toEqual([false, true, false]);
    });

    test('where no daemon serves the page, the local row is not a machine to pick', () => {
        const entries = mergeMachines({ endpoints: [localRow], accountMachines: [record('attic')], showLocal: false });
        expect(browseMachines(entries, 'local').map((row) => row.endpointId)).toEqual(['attic']);
    });
});

describe('machineLink', () => {
    const entries = mergeMachines({
        endpoints: [paired('studio'), paired('opened', { pairedBy: 'statement', needsStatement: true })],
        accountMachines: [record('attic'), record('cellar', { brokerUrl: null })],
        showLocal: false
    });
    const byId = (id: string) => entries.find((entry) => entry.id === id)!;

    test('a machine that answers says nothing beside its dot', () => {
        const link = machineLink(byId('studio'), OPEN, null);
        expect(link).toEqual({ kind: 'open' });
        expect(linkHint(link)).toBeUndefined();
        expect(linkDot(link)).toBe('bg-status-idle');
    });

    test('a machine not dialed yet says how it is reached, or that nothing outside its network can', () => {
        expect(linkHint(machineLink(byId('attic'), NO_LINK, null))).toBe('Connects through your account');
        expect(linkHint(machineLink(byId('cellar'), NO_LINK, null))).toBe('On its own network only');
        expect(linkHint(machineLink(byId('opened'), NO_LINK, null))).toBe('Connects through your account');
        expect(linkHint(machineLink(byId('studio'), NO_LINK, null))).toBe('Not connected');
    });

    test('a link under way or one that failed says so, with the reason the attempt gave', () => {
        expect(linkHint(machineLink(byId('studio'), { status: 'connecting', attempts: 0, retryAt: null }, null))).toBe('Connecting...');
        const failed = machineLink(byId('studio'), { status: 'closed', attempts: 2, retryAt: 1, failure: 'ICE failed' }, null);
        expect(linkHint(failed)).toBe('Not reachable: ICE failed');
        expect(linkDot(failed)).toBe('bg-status-error');
        expect(linkHint(machineLink(byId('studio'), { status: 'closed', attempts: 1, retryAt: 1, failure: null }, null))).toBe(
            'Not reachable: That machine is not answering'
        );
    });

    test('the wait a person started speaks before what the pool knows', () => {
        expect(machineLink(byId('attic'), NO_LINK, { state: 'connecting' })).toEqual({ kind: 'connecting' });
        expect(machineLink(byId('attic'), NO_LINK, { state: 'failed', reason: 'Refused' })).toEqual({ kind: 'failed', reason: 'Refused' });
    });
});

describe('openBrowse', () => {
    test('one open machine goes straight to its folders, which have no path behind them yet', () => {
        expect(openBrowse('local', [{ endpointId: 'local', open: true }])).toEqual({ endpointId: 'local', machines: false, path: '' });
    });

    test('one machine that is not open waits for its link on its folders step', () => {
        expect(openBrowse('local', [{ endpointId: 'attic', open: false }])).toEqual({
            endpointId: 'attic',
            machines: false,
            path: '',
            link: { state: 'connecting' }
        });
    });

    test('more than one machine asks which, and so does none', () => {
        const two = [
            { endpointId: 'local', open: true },
            { endpointId: 'attic', open: false }
        ];
        expect(openBrowse('local', two)).toEqual({ endpointId: 'local', machines: true, path: '' });
        expect(openBrowse('local', [])).toEqual({ endpointId: 'local', machines: true, path: '' });
    });
});

describe('the wait for a machine picked in the palette', () => {
    const machinesUp: BrowseStep = { endpointId: 'local', machines: true, path: '~/work/' };

    test('a pick on a machine that is not open connects, then lists its folders', () => {
        const connecting = pickMachine('attic', false);
        expect(connecting.link).toEqual({ state: 'connecting' });
        expect(settleLink(connecting, 'attic', null)).toEqual({ endpointId: 'attic', machines: false, path: '' });
    });

    test('a failure stays on the machine with its reason, and trying again waits again', () => {
        const failed = settleLink(pickMachine('attic', false), 'attic', 'No network path to the machine');
        expect(failed?.link).toEqual({ state: 'failed', reason: 'No network path to the machine' });
        expect(retryLink(failed)?.link).toEqual({ state: 'connecting' });
        expect(retryLink(machinesUp)).toBe(machinesUp);
    });

    test('going back cancels the wait: the machines step ignores a link that settles later', () => {
        const back = machinesStep(pickMachine('attic', false), '');
        expect(back).toEqual({ endpointId: 'attic', machines: true, path: '' });
        expect(settleLink(back, 'attic', null)).toBe(back);
        expect(browseBack(pickMachine('attic', false), 2)).toEqual({ to: 'machines' });
    });

    test('a link that settles for another machine, or after the palette closed, changes nothing', () => {
        const other = pickMachine('studio', false);
        expect(settleLink(other, 'attic', null)).toBe(other);
        expect(settleLink(null, 'attic', 'Gone')).toBeNull();
    });

    test('the folders step keeps its path to come back to, a waiting step has none', () => {
        expect(machinesStep({ endpointId: 'local', machines: false, path: '' }, '~/work/')).toEqual(machinesUp);
    });
});

describe('paletteStart', () => {
    const shut = { open: false, mode: 'default', browseAt: 0 };
    const up = { open: true, mode: 'default', browseAt: 0 };

    test('a store that did not move leaves the palette alone', () => {
        expect(paletteStart(up, up)).toEqual({ changed: false, restart: false, browse: false });
    });

    test('opening plainly starts over without browsing', () => {
        expect(paletteStart(up, shut)).toEqual({ changed: true, restart: true, browse: false });
    });

    test('opening through the browse command starts over and browses', () => {
        expect(paletteStart({ ...up, browseAt: 1 }, shut)).toEqual({ changed: true, restart: true, browse: true });
    });

    test('the command chosen while the palette is already open still browses', () => {
        expect(paletteStart({ ...up, browseAt: 1 }, up)).toEqual({ changed: true, restart: true, browse: true });
    });

    test('the command chosen again, while browsing, starts browsing over', () => {
        const browsing = { ...up, browseAt: 1 };
        expect(paletteStart({ ...up, browseAt: 2 }, browsing)).toEqual({ changed: true, restart: true, browse: true });
    });

    test('a mode that changes under an open palette starts over, but does not browse', () => {
        expect(paletteStart({ ...up, mode: 'grep' }, up)).toEqual({ changed: true, restart: true, browse: false });
    });

    test('closing changes what was seen and starts nothing', () => {
        expect(paletteStart(shut, up)).toEqual({ changed: true, restart: false, browse: false });
    });
});

describe('browseBack', () => {
    test('the machines return to the folders they were opened from', () => {
        expect(browseBack({ endpointId: 'local', machines: true, path: '/work/' }, 2)).toEqual({ to: 'folders', path: '/work/' });
    });

    test('the machines leave browsing when there are no folders behind them', () => {
        expect(browseBack({ endpointId: 'local', machines: true, path: '' }, 2)).toEqual({ to: 'palette' });
    });

    test('folders go to the machines, but only when there is more than one', () => {
        expect(browseBack({ endpointId: 'local', machines: false, path: '/work/' }, 2)).toEqual({ to: 'machines' });
        expect(browseBack({ endpointId: 'local', machines: false, path: '/work/' }, 1)).toEqual({ to: 'palette' });
    });
});

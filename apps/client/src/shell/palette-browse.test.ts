import { describe, expect, test } from 'bun:test';
import type { Endpoint } from '@/state/endpoints';
import {
    browseBack,
    browseMachines,
    browseStart,
    folderPresence,
    joinPath,
    machineDot,
    machineHint,
    openBrowse,
    paletteStart,
    parentOf,
    separatorFor
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

const endpoint = (id: string, label: string): Endpoint => ({
    id,
    label,
    httpBaseUrl: `http://${id}`,
    wsBaseUrl: `ws://${id}`,
    reachability: 'lan',
    token: null,
    daemonId: id,
    daemonPublicKey: null
});

describe('browseMachines', () => {
    const endpoints = [endpoint('daemon-b', 'Studio'), endpoint('local', 'This machine'), endpoint('daemon-c', 'Attic')];

    test('this machine comes first whichever machine is active, the rest keep the list order', () => {
        const rows = browseMachines(endpoints, 'daemon-b', ['local', 'daemon-b']);
        expect(rows.map((row) => row.endpointId)).toEqual(['local', 'daemon-b', 'daemon-c']);
    });

    test('the machine being worked on is marked rather than moved, so the step can highlight it', () => {
        expect(browseMachines(endpoints, 'daemon-b', []).map((row) => row.active)).toEqual([false, true, false]);
        expect(browseMachines(endpoints, 'local', []).map((row) => row.active)).toEqual([true, false, false]);
    });

    test('a machine without a socket is still a row, marked as one that has to be dialed', () => {
        const rows = browseMachines(endpoints, 'local', ['local']);
        expect(rows.map((row) => row.connected)).toEqual([true, false, false]);
    });
});

describe('openBrowse', () => {
    test('one machine goes straight to its folders, which have no path behind them yet', () => {
        expect(openBrowse('local', 1)).toEqual({ endpointId: 'local', machines: false, path: '' });
    });

    test('more than one machine asks which', () => {
        expect(openBrowse('local', 3)).toEqual({ endpointId: 'local', machines: true, path: '' });
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

describe('a machine row', () => {
    test('says nothing beside the dot while the machine answers, and says what it is doing otherwise', () => {
        expect(machineHint(true, false)).toBeUndefined();
        expect(machineHint(false, true)).toBe('Connecting');
        expect(machineHint(false, false)).toBe('Not connected');
        // Dialing wins: a socket that is closing and reopening is on its way, not gone.
        expect(machineHint(true, true)).toBe('Connecting');
    });

    test('the dot carries the three states in the colors the settings page uses', () => {
        expect(machineDot(true, false)).toBe('bg-status-idle');
        expect(machineDot(false, true)).toBe('bg-status-needs-you');
        expect(machineDot(true, true)).toBe('bg-status-needs-you');
        expect(machineDot(false, false)).toBe('bg-text-faint');
    });
});

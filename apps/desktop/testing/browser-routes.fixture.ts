import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { installBrowserRoutes } from '../src/browser-routes';
import { answerAppRequest, createDesktopAppScheme } from '../src/app-scheme';
import { BROWSER_PARTITION, PREVIEW_PARTITION } from '../src/web-guards';

const { app, BrowserWindow, protocol, webContents, session } = require('electron') as typeof import('electron');
const directory = process.env.RUIMTE_ROUTE_FIXTURE!;
app.setName('Ruimte browser route integration');
app.setPath('userData', join(directory, 'profile'));
app.commandLine.appendSwitch('host-resolver-rules', 'MAP public.route.test 127.0.0.1');
app.commandLine.appendSwitch('no-proxy-server');
app.commandLine.appendSwitch('disable-background-networking');
app.dock?.hide();
const scheme = createDesktopAppScheme(directory);
protocol.registerSchemesAsPrivileged([{ scheme: scheme.scheme, privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
const requests: Record<string, number> = {};
const results: Record<string, number> = {};
let publicRequests = 0;
let localRequests = 0;
let port = 0;
const server = createServer((req, res) => {
    const url = new URL(req.url!, `http://${req.headers.host}`);
    if (url.hostname === 'public.route.test') {
        publicRequests++;
    } else {
        localRequests++;
        requests[url.pathname] = (requests[url.pathname] ?? 0) + 1;
    }
    res.setHeader('Cache-Control', url.pathname === '/cached' ? 'public, max-age=3600' : 'no-store');
    res.setHeader('Content-Type', 'text/html');
    if (url.pathname === '/history-redirect') {
        res.writeHead(302, { Location: '/history-redirected' });
        res.end();
        return;
    }
    if (url.pathname === '/history-failed') {
        req.socket.destroy();
        return;
    }
    if (url.pathname.startsWith('/redirect/')) {
        res.writeHead(302, { Location: `http://127.0.0.1:${port}/${url.pathname.slice('/redirect/'.length)}` });
        res.end();
        return;
    }
    res.end('<title>Route fixture</title><body>Route fixture<a id="link">Navigate</a><form id="form" method="POST"><button>Send</button></form></body>');
});
const windows: Electron.BrowserWindow[] = [];
const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
async function until<T>(read: () => Promise<T>, accepts: (value: T) => boolean): Promise<T> {
    const end = Date.now() + 8_000;
    while (Date.now() < end) {
        const value = await read();
        if (accepts(value)) {
            return value;
        }
        await delay(20);
    }
    throw new Error('Fixture condition timed out');
}
interface Row {
    registered: boolean;
    id?: number;
    row?: { url: string; loading: boolean; title: string; canGoBack: boolean; canGoForward: boolean; error: { ownerRoute?: boolean; url: string } | null };
}
async function run(): Promise<void> {
    await app.whenReady();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as { port: number }).port;
    protocol.handle(scheme.scheme, (request) => answerAppRequest(scheme, request));
    const guard = installBrowserRoutes(
        (event) =>
            scheme.isAppSender(
                windows.some((window) => window.webContents === event.sender),
                event.senderFrame
            ),
        join(directory, 'guest.cjs')
    );
    let lastPreferences: Electron.WebPreferences = {};
    async function window(): Promise<Electron.BrowserWindow> {
        const created = new BrowserWindow({
            show: false,
            webPreferences: { preload: join(directory, 'preload.cjs'), webviewTag: true, contextIsolation: true, nodeIntegration: false, sandbox: true }
        });
        windows.push(created);
        guard.attachApp(created.webContents);
        created.webContents.on('will-attach-webview', (_event, preferences) => {
            lastPreferences = preferences;
        });
        await created.loadURL(scheme.url);
        return created;
    }
    const host = await window();
    async function call<T>(method: string, ...args: unknown[]): Promise<T> {
        try {
            return await host.webContents.executeJavaScript(`window.routeTest[${JSON.stringify(method)}](...${JSON.stringify(args)})`);
        } catch (cause) {
            throw new Error(`Fixture call failed: ${method}(${JSON.stringify(args)})`, { cause });
        }
    }
    const publicUrl = `http://public.route.test:${port}`;
    const localUrl = `http://127.0.0.1:${port}`;
    async function ready(key: string): Promise<Row> {
        return until(
            () => call<Row>('state', key),
            (state) => !!state.row && !state.row.loading && state.row.title === 'Route fixture'
        );
    }
    async function remote(): Promise<string> {
        const key = await call<string>('create', 'remote', publicUrl + '/public');
        await ready(key);
        return key;
    }
    async function denied(name: string, act: (key: string, url: string) => Promise<unknown>): Promise<void> {
        const key = await remote();
        const destination = localUrl + '/forbidden/' + name;
        await act(key, destination);
        const state = await until(
            () => call<Row>('state', key),
            (state) => state.row?.error?.ownerRoute === true
        );
        assert.equal(state.row!.error!.url, destination);
        assert.equal(requests['/forbidden/' + name] ?? 0, 0, name);
        results[name] = 0;
        await call('destroy', key);
    }
    let savedHistory: Electron.NavigationEntry[] = [];
    const firstPages: { key: string; url: string; owner?: string; state: Row; entries: string[] }[] = [];
    for (const [endpoint, base, owner] of [
        ['remote', publicUrl, undefined],
        ['local', localUrl, 'fixture-owner']
    ] as const) {
        const url = base + '/history-first';
        const key = await call<string>('create', endpoint, url, owner);
        const state = await ready(key);
        firstPages.push({
            key,
            url,
            owner,
            state,
            entries: webContents
                .fromId(state.id!)!
                .navigationHistory.getAllEntries()
                .map((entry) => entry.url)
        });
    }
    console.log('BROWSER_INITIAL_HISTORY ' + JSON.stringify(firstPages.map(({ url, state, entries }) => ({ url, canGoBack: state.row!.canGoBack, entries }))));
    for (const { key, url, state, entries } of firstPages) {
        assert.deepEqual(entries, [url]);
        assert.equal(state.row!.canGoBack, false);
        assert.equal(state.row!.canGoForward, false);
        const guest = webContents.fromId(state.id!)!;
        const second = url.replace('/history-first', '/history-second');
        async function loaded(target: string): Promise<Row> {
            return until(
                () => call<Row>('state', key),
                (row) => row.row?.url === target && !row.row.loading && guest.getURL() === target && !guest.isLoading()
            );
        }
        await call('back', key);
        await loaded(url);
        assert.deepEqual(
            guest.navigationHistory.getAllEntries().map((entry) => entry.url),
            [url]
        );
        await call('navigate', key, second);
        const secondState = await loaded(second);
        assert.equal(secondState.row!.canGoBack, true);
        assert.deepEqual(
            guest.navigationHistory.getAllEntries().map((entry) => entry.url),
            [url, second]
        );
        await call('back', key);
        const back = await loaded(url);
        assert.equal(back.row!.canGoBack, false);
        assert.equal(back.row!.canGoForward, true);
        await call('forward', key);
        const forward = await loaded(second);
        assert.equal(forward.row!.canGoBack, true);
        assert.equal(forward.row!.canGoForward, false);
        assert.deepEqual(
            guest.navigationHistory.getAllEntries().map((entry) => entry.url),
            [url, second]
        );
        console.log(
            'BROWSER_USER_HISTORY ' +
                JSON.stringify({ url, entries: guest.navigationHistory.getAllEntries().map((entry) => entry.url), back: back.row, forward: forward.row })
        );
        if (url.startsWith(localUrl)) {
            await call('navigate', key, 'about:blank');
            await loaded('about:blank');
            savedHistory = guest.navigationHistory.getAllEntries();
            assert.deepEqual(
                savedHistory.map((entry) => entry.url),
                [url, second, 'about:blank']
            );
        }
        await call('destroy', key);
    }
    writeFileSync(join(directory, 'guest-page.html'), '<title>Route fixture</title>');
    for (const url of ['data:text/html,<title>Route fixture</title>', pathToFileURL(join(directory, 'guest-page.html')).href]) {
        const key = await call<string>('create', 'local', url);
        const state = await ready(key);
        console.log(
            'BROWSER_NON_HTTP_HISTORY',
            url,
            webContents
                .fromId(state.id!)!
                .navigationHistory.getAllEntries()
                .map((entry) => entry.url)
        );
        assert.equal(state.row!.canGoBack, false);
        await call('destroy', key);
    }
    async function settled(key: string, url: string): Promise<Row> {
        return until(
            () => call<Row>('state', key),
            (state) => !!state.id && state.row?.url === url && !state.row.loading && !webContents.fromId(state.id)!.isLoading()
        );
    }
    async function onlyPage(key: string, url: string): Promise<void> {
        const state = await settled(key, url);
        const entries = webContents
            .fromId(state.id!)!
            .navigationHistory.getAllEntries()
            .map((entry) => entry.url);
        assert.deepEqual(entries, [url]);
        assert.equal(state.row!.canGoBack, false);
        console.log('BROWSER_BOOTSTRAP_CASE ' + JSON.stringify({ url, entries, canGoBack: state.row!.canGoBack }));
    }
    const blank = await call<string>('create', 'remote', 'about:blank');
    await settled(blank, 'about:blank');
    await call('navigate', blank, publicUrl + '/after-wait');
    await onlyPage(blank, publicUrl + '/after-wait');
    await call('destroy', blank);

    const queued = await call<string>('create', 'local', localUrl + '/forbidden/superseded', 'fixture-owner', { queuedUrl: localUrl + '/queued' });
    await onlyPage(queued, localUrl + '/queued');
    assert.equal(requests['/forbidden/superseded'] ?? 0, 0);
    await call('destroy', queued);

    for (const [endpoint, base, owner] of [
        ['remote', publicUrl, undefined],
        ['local', localUrl, 'fixture-owner']
    ] as const) {
        const redirected = await call<string>('create', endpoint, base + '/history-redirect', owner);
        await onlyPage(redirected, base + '/history-redirected');
        await call('destroy', redirected);
    }
    const failed = await call<string>('create', 'remote', publicUrl + '/history-failed');
    await until(
        () => call<Row>('state', failed),
        (state) => !!state.row?.error && !state.row.loading
    );
    await onlyPage(failed, publicUrl + '/history-failed');
    await call('navigate', failed, publicUrl + '/recovered');
    const recovered = await settled(failed, publicUrl + '/recovered');
    assert.equal(
        webContents
            .fromId(recovered.id!)!
            .navigationHistory.getAllEntries()
            .some((entry) => entry.url === 'about:blank'),
        false
    );
    await call('destroy', failed);

    const canceled = await call<string>('create', 'local', localUrl + '/forbidden/canceled', 'fixture-owner', { cancelOnReady: true });
    await until(
        () => call<Row>('state', canceled),
        (state) => !state.registered
    );
    assert.equal(requests['/forbidden/canceled'] ?? 0, 0);

    let savedRestoration: Promise<void> | undefined;
    app.once('web-contents-created', (_event, guest) => {
        savedRestoration = guest.navigationHistory.restore({ entries: savedHistory }).catch((error: Error & { code?: string }) => {
            if (error.code !== 'ERR_ABORTED') {
                throw error;
            }
        });
    });
    const restored = await call<string>('create', 'local', 'about:blank', 'fixture-owner');
    const restoredState = await settled(restored, 'about:blank');
    await savedRestoration;
    const restoredGuest = webContents.fromId(restoredState.id!)!;
    const beforeRestored = restoredGuest.navigationHistory.getAllEntries().map((entry) => entry.url);
    assert.deepEqual(
        beforeRestored.slice(0, savedHistory.length),
        savedHistory.map((entry) => entry.url)
    );
    await call('navigate', restored, localUrl + '/after-restore');
    await settled(restored, localUrl + '/after-restore');
    assert.deepEqual(
        restoredGuest.navigationHistory.getAllEntries().map((entry) => entry.url),
        [...beforeRestored, localUrl + '/after-restore']
    );
    console.log('BROWSER_RESTORED_HISTORY ' + JSON.stringify(restoredGuest.navigationHistory.getAllEntries().map((entry) => entry.url)));
    await call('destroy', restored);
    // A local page remains usable while every remote path is being denied in the same partition.
    const local = await call<string>('create', 'local', localUrl + '/allowed', 'fixture-owner');
    const localState = await ready(local);
    assert.ok((requests['/allowed'] ?? 0) > 0);
    const localGuest = webContents.fromId(localState.id!)!;
    assert.equal(localGuest.session, session.fromPartition(BROWSER_PARTITION));
    assert.equal(await call('run', local, 'typeof window.ruimteDesktop + ":" + typeof require'), 'undefined:undefined');
    const prefs = lastPreferences;
    assert.equal(prefs.sandbox, true);
    assert.equal(prefs.contextIsolation, true);
    assert.equal(prefs.nodeIntegration, false);
    await denied('link', (key, url) =>
        call('run', key, `document.getElementById('link').href=${JSON.stringify(url)}; document.getElementById('link').click()`)
    );
    await denied('location', (key, url) => call('run', key, `location.href=${JSON.stringify(url)}`));
    await denied('form', (key, url) =>
        call('run', key, `document.getElementById('form').action=${JSON.stringify(url)}; document.getElementById('form').submit()`)
    );
    await denied('redirect', (key) => call('navigate', key, publicUrl + '/redirect/forbidden/redirect'));
    await denied('loadURL', (key, url) => call('rawLoad', key, url));
    for (const direction of ['back', 'forward']) {
        const destination = localUrl + '/forbidden/' + direction;
        const entries = [
            { url: 'about:blank', title: 'Blank' },
            { url: destination, title: 'Forbidden' },
            { url: 'about:blank', title: 'Blank' }
        ];
        let restoration: Promise<void> | undefined;
        app.once('web-contents-created', (_event, guest) => {
            restoration = guest.navigationHistory.restore({ index: 2, entries }).catch((error: Error & { code?: string }) => {
                if (error.code !== 'ERR_ABORTED') {
                    throw error;
                }
            });
        });
        const key = await call<string>('create', 'remote', 'about:blank');
        await until(
            () => call<Row>('state', key),
            (state) => !!state.row && !state.row.loading
        );
        await restoration;
        const state = await call<Row>('state', key);
        const guest = webContents.fromId(state.id!)!;
        assert.equal(
            guest.navigationHistory.getAllEntries().some((entry) => entry.url === destination),
            true
        );
        if (direction === 'back') {
            assert.equal(guest.navigationHistory.removeEntryAtIndex(2), true);
        } else {
            guest.navigationHistory.goToIndex(0);
            await until(
                async () => guest.navigationHistory.getActiveIndex() === 0 && !guest.isLoading(),
                (ready) => ready
            );
        }
        const nextIndex = guest.navigationHistory.getActiveIndex() + (direction === 'back' ? -1 : 1);
        assert.equal(guest.navigationHistory.getEntryAtIndex(nextIndex).url, destination);
        await call(direction, key);
        await until(
            () => call<Row>('state', key),
            (state) => state.row?.error?.ownerRoute === true
        );
        assert.equal(requests['/forbidden/' + direction] ?? 0, 0);
        results[direction] = 0;
        await call('destroy', key);
    }
    const initialRedirect = await call<string>('create', 'remote', publicUrl + '/redirect/forbidden/initial-redirect');
    await until(
        () => call<Row>('state', initialRedirect),
        (state) => state.row?.error?.ownerRoute === true
    );
    assert.equal(requests['/forbidden/initial-redirect'] ?? 0, 0);
    results['initial-redirect'] = 0;
    await call('navigate', initialRedirect, publicUrl + '/after-denied-redirect');
    await onlyPage(initialRedirect, publicUrl + '/after-denied-redirect');
    await call('destroy', initialRedirect);

    await call('navigate', local, localUrl + '/cached');
    await until(
        async () => requests['/cached'] ?? 0,
        (hits) => hits === 1
    );
    await ready(local);
    const cachedLocal = await call<string>('create', 'local', localUrl + '/cached');
    await ready(cachedLocal);
    assert.equal(requests['/cached'], 1);
    const cachedRemote = await remote();
    await call('rawLoad', cachedRemote, localUrl + '/cached');
    await until(
        () => call<Row>('state', cachedRemote),
        (state) => state.row?.error?.ownerRoute === true
    );
    assert.equal(requests['/cached'], 1);
    await call('machine', 'fixture-owner', 'local');
    assert.equal((await call<Row>('state', cachedRemote)).registered, true);
    assert.equal((await call<Row>('state', cachedRemote)).row?.error?.ownerRoute, true);
    results.cached = 0;
    await call('destroy', cachedRemote);

    await call('navigate', local, localUrl + '/allowed-history');
    await until(
        async () => requests['/allowed-history'] ?? 0,
        (hits) => hits === 1
    );
    await ready(local);
    await call('back', local);
    await until(
        async () => localGuest.getURL() === localUrl + '/cached' && !localGuest.isLoading(),
        (ready) => ready
    );
    await call('forward', local);
    await until(
        async () => localGuest.getURL() === localUrl + '/allowed-history' && !localGuest.isLoading(),
        (ready) => ready
    );

    const blockedInitial = await call<string>('create', 'remote', localUrl + '/forbidden/initial');
    assert.equal((await call<Row>('state', blockedInitial)).registered, false);
    results.initial = requests['/forbidden/initial'] ?? 0;
    const reopened = await call<string>('create', 'remote', publicUrl + '/public', 'fixture-owner');
    assert.equal((await call<Row>('state', reopened)).registered, false);
    const peer = await remote();
    const peerState = await call<Row>('state', peer);
    assert.equal(webContents.fromId(peerState.id!)!.session, localGuest.session);
    const stranger = await window();
    const binding = { webContentsId: peerState.id, endpointId: 'local', localMachineId: 'fixture-owner' };
    assert.equal(await stranger.webContents.executeJavaScript(`window.routeTest.bind(${JSON.stringify(binding)})`), false);
    assert.equal(await call('bind', binding), false);
    assert.equal(await call('bind', { ...binding, webContentsId: host.webContents.id }), false);
    assert.equal(await call('bind', { ...binding, webContentsId: 'bad' }), false);
    const known = new Set(webContents.getAllWebContents().map((guest) => guest.id));
    await call('rawGuest', PREVIEW_PARTITION, 'about:blank');
    const preview = await until(
        async () => webContents.getAllWebContents().find((guest) => !known.has(guest.id) && guest.getType() === 'webview'),
        (guest) => !!guest
    );
    assert.equal(await call('bind', { ...binding, webContentsId: preview!.id }), false);
    assert.equal(lastPreferences.nodeIntegration, false);
    assert.equal(lastPreferences.sandbox, true);
    // No guest bridge, popup or fetch may turn a denied navigation into a local request.
    await call('run', peer, `window.open(${JSON.stringify(localUrl + '/forbidden/popup')})`);
    await call('run', peer, `fetch(${JSON.stringify(localUrl + '/forbidden/fetch')}).catch(() => null)`);
    await call(
        'run',
        peer,
        `new Promise(resolve => { const image = new Image(); image.onload=image.onerror=resolve; image.src=${JSON.stringify(localUrl + '/forbidden/image')}; })`
    );
    for (const name of ['popup', 'fetch', 'image']) {
        assert.equal(requests['/forbidden/' + name] ?? 0, 0);
        results[name] = 0;
    }
    // Focus changes do not transfer policy; local and public controls must still send requests.
    await call('machine', 'fixture-owner', 'remote');
    await call('navigate', local, localUrl + '/allowed-after');
    await until(
        async () => requests['/allowed-after'] ?? 0,
        (hits) => hits === 1
    );
    await ready(local);
    await call('navigate', peer, publicUrl + '/public-after');
    await ready(peer);
    assert.equal(requests['/allowed-after'], 1);
    await call('machine', 'other-desktop', 'local');
    assert.equal((await call<Row>('state', local)).registered, false);
    assert.equal((await call<Row>('state', peer)).registered, true);
    await denied('after-focus', (key, url) => call('rawLoad', key, url));
    const ownerless = await call<string>('create', 'local', localUrl + '/allowed-ownerless');
    await until(
        async () => requests['/allowed-ownerless'] ?? 0,
        (hits) => hits === 1
    );
    await ready(ownerless);
    assert.equal(requests['/allowed-ownerless'], 1);
    const unknownBefore = new Set(webContents.getAllWebContents().map((guest) => guest.id));
    await call('rawGuest', BROWSER_PARTITION, localUrl + '/forbidden/unbound');
    const unbound = await until(
        async () => webContents.getAllWebContents().find((guest) => !unknownBefore.has(guest.id) && guest.getType() === 'webview'),
        (guest) => !!guest
    );
    await until(
        async () => unbound!.isLoading(),
        (loading) => !loading
    );
    assert.equal(requests['/forbidden/unbound'] ?? 0, 0);
    results.unbound = 0;
    assert.equal(Object.entries(requests).filter(([path]) => path.startsWith('/forbidden')).length, 0);
    console.log(
        'BROWSER_ROUTE_RESULT ' +
            JSON.stringify({
                forbidden: results,
                publicRequests,
                localRequests,
                assertions: 'production registry, preload, guards, sandbox, binding isolation, owner lifecycle'
            })
    );
}
const timeout = setTimeout(() => {
    console.error('Browser route fixture deadline');
    app.exit(2);
}, 50_000);
void run()
    .then(() => {
        clearTimeout(timeout);
        for (const window of windows) {
            window.destroy();
        }
        server.close();
        app.exit(0);
    })
    .catch((error) => {
        console.error(error);
        server.close();
        app.exit(1);
    });

export interface BrowserRouteEvidence {
    forbidden: Record<string, number>;
    publicRequests: number;
    localRequests: number;
}

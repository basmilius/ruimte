import type { Area } from '../area.ts';
import { probeDevServers } from '../browser/dev-servers.ts';
import type { BrowserManager } from '../browser/manager.ts';
import type { BrowserPages } from '../browser/pages.ts';
import type { Dispatcher } from '../dispatcher.ts';
import { streamingGate } from '../streams/streaming-gate.ts';

export interface BrowserDeps {
    browsers: BrowserManager;
    pages: BrowserPages;
    streamingAllowed(): boolean;
}

export function browserArea(deps: BrowserDeps): Area {
    const { browsers, pages } = deps;

    return {
        name: 'browser',
        sources: [browsers, pages],
        holders: [browsers, pages],
        handlers: (dispatcher) => registerRequests(dispatcher, deps),
        stop: [{ phase: 'end', label: 'Closing browsers', run: () => browsers.closeAll() }]
    };
}

function registerRequests(dispatcher: Dispatcher, { browsers, pages, streamingAllowed }: BrowserDeps): void {
    const requireStreaming = streamingGate(streamingAllowed);

    dispatcher.register('browser.open', (payload, client) => {
        requireStreaming();
        return browsers.open(
            payload.browserId,
            client.id,
            payload.url,
            payload.width,
            payload.height,
            payload.stream,
            payload.deviceScaleFactor,
            payload.binary
        );
    });
    // Detach and kill let a client clean up after the policy changed, so they stay open.
    dispatcher.register('browser.detach', (payload, client) => {
        browsers.detach(payload.browserId, client.id);
        return {};
    });
    dispatcher.register('browser.kill', (payload, client) => {
        browsers.kill(payload.browserId, client.id);
        return {};
    });
    dispatcher.register(
        'browser.navigate',
        (payload, client) => {
            requireStreaming();
            return browsers.navigate(payload.browserId, client.id, payload.url);
        },
        { count: ['actions.browser'] }
    );
    dispatcher.register(
        'browser.command',
        (payload, client) => {
            requireStreaming();
            return browsers.command(payload.browserId, client.id, payload.command, payload.ignoreCache);
        },
        { count: ['actions.browser'] }
    );
    dispatcher.register('browser.resize', async (payload, client) => {
        requireStreaming();
        await browsers.resize(payload.browserId, client.id, payload.width, payload.height, payload.deviceScaleFactor);
        return {};
    });
    dispatcher.register('browser.input', async (payload, client) => {
        requireStreaming();
        await browsers.input(payload.browserId, client.id, payload.input);
        return {};
    });
    /*
     * Holding a page and answering for it. Outside the streaming gate: these open no browser here.
     * The page is the client's own, and all this machine does is remember who has it and pass an
     * agent's word along to them.
     */
    dispatcher.register('browser.hold', (payload, client) => {
        pages.hold(client.id, payload.state);
        return {};
    });
    dispatcher.register('browser.release', (payload, client) => {
        pages.release(client.id, payload.browserId);
        return {};
    });
    dispatcher.register('browser.driveResult', (payload) => {
        pages.settle(payload);
        return {};
    });
    // Outside the gate: it opens no browser and only reports which local ports answer.
    dispatcher.register('browser.devServers', async (payload) => ({ servers: await probeDevServers(payload.ports, fetch, payload.host) }));
}

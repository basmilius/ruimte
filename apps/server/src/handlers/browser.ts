import type { BrowserManager } from '../browser/manager.ts';
import { probeDevServers } from '../browser/dev-servers.ts';
import { translate, type Dispatcher } from '../dispatcher.ts';
import { streamingGate } from './streaming.ts';

export const registerBrowserHandlers = (dispatcher: Dispatcher, browsers: BrowserManager, streamingAllowed: () => boolean): void => {
    const requireStreaming = streamingGate(streamingAllowed);

    dispatcher.register('browser.open', (payload, client) => {
        requireStreaming();
        return translate(() =>
            browsers.open(payload.browserId, client.id, payload.url, payload.width, payload.height, payload.stream, payload.deviceScaleFactor)
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
    dispatcher.register('browser.navigate', (payload, client) => {
        requireStreaming();
        return translate(() => browsers.navigate(payload.browserId, client.id, payload.url));
    });
    dispatcher.register('browser.command', (payload, client) => {
        requireStreaming();
        return translate(() => browsers.command(payload.browserId, client.id, payload.command, payload.ignoreCache));
    });
    dispatcher.register('browser.resize', (payload, client) => {
        requireStreaming();
        return translate(async () => {
            await browsers.resize(payload.browserId, client.id, payload.width, payload.height, payload.deviceScaleFactor);
            return {};
        });
    });
    dispatcher.register('browser.input', (payload, client) => {
        requireStreaming();
        return translate(async () => {
            await browsers.input(payload.browserId, client.id, payload.input);
            return {};
        });
    });
    // Outside the gate: it opens no browser and only reports which local ports answer.
    dispatcher.register('browser.devServers', async (payload) => ({ servers: await probeDevServers(payload.ports) }));
};

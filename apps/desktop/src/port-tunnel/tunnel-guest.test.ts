import { expect, test } from 'bun:test';
import { guardTunnelGuest, type TunnelGuestContents } from './tunnel-guest';

type Listener = (event: { url: string; isMainFrame: boolean; preventDefault(): void }) => void;

function fakeGuest() {
    const listeners = new Map<string, Listener>();
    const calls = { webRtc: [] as string[], windowOpen: 0 };
    const guest: TunnelGuestContents = {
        id: 7,
        on: (event, listener) => void listeners.set(event, listener),
        setWindowOpenHandler: () => void (calls.windowOpen += 1),
        setWebRTCIPHandlingPolicy: (policy) => void calls.webRtc.push(policy)
    };

    return { guest, calls, listeners };
}

test('keeps WebRTC off the network of the client, so STUN, TURN and UDP cannot go around the proxy', () => {
    const { guest, calls } = fakeGuest();

    guardTunnelGuest(guest, { owned: () => true, port: 3000, blocked: () => undefined });

    expect(calls.webRtc).toEqual(['disable_non_proxied_udp']);
    expect(calls.windowOpen).toBe(1);
});

test('stops a navigation outside the shared port and says so for the main frame only', () => {
    const { guest, listeners } = fakeGuest();
    const blocked: Array<{ webContentsId: number; url: string }> = [];

    guardTunnelGuest(guest, { owned: () => true, port: 3000, blocked: (message) => blocked.push(message) });

    let prevented = 0;
    const ask = (url: string, isMainFrame: boolean): void =>
        listeners.get('will-frame-navigate')!({ url, isMainFrame, preventDefault: () => void (prevented += 1) });

    ask('http://localhost:3000/ok', true);
    ask('https://example.com/', true);
    ask('http://localhost:3001/', false);

    expect(prevented).toBe(2);
    expect(blocked).toEqual([{ webContentsId: 7, url: 'https://example.com/' }]);
});

import { describe, expect, test } from 'bun:test';
import { LiveSession } from '@/voice/live-session';

class FakeChannel extends EventTarget {
    readyState: RTCDataChannelState = 'open';

    send(): void {}

    close(): void {
        this.readyState = 'closed';
        this.dispatchEvent(new Event('close'));
    }
}

class FakePeer extends EventTarget {
    connectionState: RTCPeerConnectionState = 'connected';
    readonly channel = new FakeChannel();

    createDataChannel(): FakeChannel {
        return this.channel;
    }

    close(): void {
        this.connectionState = 'closed';
    }

    become(state: RTCPeerConnectionState): void {
        this.connectionState = state;
        this.dispatchEvent(new Event('connectionstatechange'));
    }
}

function setup() {
    const peer = new FakePeer();
    let lost = 0;
    const session = new LiveSession(
        () => undefined,
        () => undefined,
        () => {
            lost += 1;
        },
        { peer: peer as unknown as RTCPeerConnection, audio: { autoplay: false, srcObject: null } as unknown as HTMLAudioElement }
    );
    return { peer, session, lost: () => lost };
}

describe('a GPT-Live session', () => {
    test('says once that its connection is gone when it fails', () => {
        const { peer, lost } = setup();
        peer.become('disconnected');
        expect(lost()).toBe(0);
        peer.become('failed');
        peer.channel.close();
        expect(lost()).toBe(1);
    });

    test('says so when its event channel closes under it', () => {
        const { peer, lost } = setup();
        peer.channel.close();
        expect(lost()).toBe(1);
    });

    test('closing it on purpose is not a lost connection', () => {
        const { session, lost } = setup();
        session.close();
        expect(lost()).toBe(0);
    });
});

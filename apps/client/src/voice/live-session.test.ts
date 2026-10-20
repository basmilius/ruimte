import { afterEach, describe, expect, test } from 'bun:test';
import type { ProjectSummary } from '@ruimte/contracts';
import type { LiveEvent } from '@ruimte/voice';
import { useDocument } from '@/state/document';
import { useProject } from '@/state/project';
import { LiveSession, machineRoute } from '@/voice/live-session';

class FakeChannel extends EventTarget {
    readyState: RTCDataChannelState = 'open';
    readonly sent: string[] = [];

    send(data: string): void {
        this.sent.push(data);
    }

    receive(event: LiveEvent): void {
        this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(event) }));
    }

    close(): void {
        this.readyState = 'closed';
        this.dispatchEvent(new Event('close'));
    }
}

class FakePeer extends EventTarget {
    connectionState: RTCPeerConnectionState = 'connected';
    iceGatheringState: RTCIceGatheringState = 'complete';
    localDescription: { sdp: string } | null = null;
    remote: string | null = null;
    readonly channel = new FakeChannel();

    addTrack(): void {}

    async createOffer(): Promise<{ type: 'offer'; sdp: string }> {
        return { type: 'offer', sdp: 'v=0 offer' };
    }

    async setLocalDescription(description: { sdp: string }): Promise<void> {
        this.localDescription = description;
    }

    async setRemoteDescription(description: { sdp: string }): Promise<void> {
        this.remote = description.sdp;
    }

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

describe('the machine route of the development harness', () => {
    afterEach(() => {
        useProject.setState({ current: null });
    });

    function harness() {
        const peer = new FakePeer();
        const asked: { type: string; payload: Record<string, unknown> }[] = [];
        const heard: LiveEvent[] = [];
        let answer: ((value: unknown) => void) | null = null;
        const route = machineRoute(((type: string, payload: Record<string, unknown>) => {
            asked.push({ type, payload });
            return type === 'voice.start' ? new Promise((resolve) => (answer = resolve)) : Promise.resolve({ stopped: true });
        }) as never);
        const session = new LiveSession(
            (event) => heard.push(event),
            () => undefined,
            () => undefined,
            { peer: peer as unknown as RTCPeerConnection, audio: { autoplay: false, srcObject: null } as unknown as HTMLAudioElement },
            route
        );
        return { peer, session, asked, heard, answer: (value: unknown) => answer?.(value) };
    }

    const stream = { getTracks: () => [] } as unknown as MediaStream;

    test('asks the machine to start with the offer and connects with its answer', async () => {
        useProject.setState({ current: { projectId: 'project-1' } as ProjectSummary });
        useDocument.setState({ activeViewId: 'main' });
        const { peer, session, asked, answer } = harness();
        const starting = session.start(stream, { language: 'en', voice: 'marin' });
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
        expect(asked[0]).toMatchObject({
            type: 'voice.start',
            payload: { projectId: 'project-1', sdp: 'v=0 offer', language: 'en', voice: 'marin', viewId: 'main' }
        });
        answer({ sessionId: 'session-1', sdp: 'v=0 answer', status: { phase: 'active' } });
        await starting;
        expect(peer.remote).toBe('v=0 answer');
        session.close();
        expect(asked[1]).toEqual({ type: 'voice.stop', payload: { sceneId: asked[0]!.payload.sceneId, sessionId: 'session-1' } });
    });

    test('leaves the tools and every append to the machine', () => {
        const { peer, session, heard } = harness();
        peer.channel.receive({ type: 'response.event', delegation_id: 'd', event: { type: 'response.output_item.done' } });
        peer.channel.receive({ type: 'session.output_transcript.delta', delta: 'Hello' });
        expect(heard.map((event) => event.type)).toEqual(['session.output_transcript.delta']);
        expect(session.send({ type: 'session.thinking.append' })).toBe(false);
        session.close();
        expect(peer.channel.sent).toEqual([]);
    });

    test('a stop before the machine answered names the start', async () => {
        useProject.setState({ current: { projectId: 'project-1' } as ProjectSummary });
        const { session, asked } = harness();
        void session.start(stream, { language: 'en', voice: 'marin' }).catch(() => undefined);
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
        session.close();
        expect(asked[1]).toMatchObject({ type: 'voice.stop', payload: { startId: asked[0]!.payload.startId } });
    });
});

import { afterEach, describe, expect, test } from 'bun:test';
import { useEndpoints, type Endpoint } from '@/state/endpoints';
import { httpUrlFor, type MachineResource } from './machine-url';

const studio: Endpoint = {
    id: 'studio',
    label: 'Studio',
    httpBaseUrl: 'http://studio.local:4210',
    wsBaseUrl: 'ws://studio.local:4210',
    reachability: 'lan',
    daemonId: 'studio',
    daemonPublicKey: null
};

const attachment: MachineResource = { kind: 'attachment', chatId: 'chat-1', attachmentId: 'shot.png' };

afterEach(() => {
    useEndpoints.getState().remove(studio.id);
});

describe('the HTTP route to bytes on a machine', () => {
    test('is on the machine the bytes belong to', () => {
        useEndpoints.getState().add(studio);
        expect(httpUrlFor(studio.id, attachment)).toBe('http://studio.local:4210/attachments/chat-1/shot.png');
    });

    test('is not there for a machine this client no longer knows, rather than asked of the active one', () => {
        expect(httpUrlFor('forgotten', attachment)).toBeNull();
    });
});

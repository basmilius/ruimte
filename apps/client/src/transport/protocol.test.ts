import { describe, expect, test } from 'bun:test';
import { protocolGate, protocolRefusal, withProtocol } from './protocol';

const OLDER = 'This machine runs an older Ruimte. Update Ruimte there, or restart it to pick up the update.';
const NEWER = 'This machine runs a newer Ruimte than this app. Update this app.';

const gateWith = (client = 2) => {
    const log: string[] = [];
    const gate = protocolGate(
        {
            send: (data) => log.push(`send ${data}`),
            open: () => log.push('open'),
            message: (data) => log.push(`message ${data}`),
            refuse: (failure) => log.push(`refuse ${failure}`)
        },
        client
    );
    return { gate, log };
};

const answer = (result: Record<string, unknown>, ok = true): string => JSON.stringify({ id: 'protocol', ok, result });

describe('protocolRefusal', () => {
    test('says which side has to update', () => {
        expect(protocolRefusal('daemon-older')).toBe(OLDER);
        expect(protocolRefusal('daemon-newer')).toBe(NEWER);
    });
});

describe('protocolGate', () => {
    test('asks endpoint.info first and opens on the same version', () => {
        const { gate, log } = gateWith();
        gate.opened();
        expect(log).toEqual(['send {"id":"protocol","type":"endpoint.info","payload":{}}']);
        gate.received(answer({ protocol: 2 }));
        expect(log.at(-1)).toBe('open');
    });

    test('refuses an older daemon and a newer one with their own message', () => {
        const older = gateWith();
        older.gate.received(answer({ protocol: 1 }));
        expect(older.log).toEqual([`refuse ${OLDER}`]);
        const newer = gateWith();
        newer.gate.received(answer({ protocol: 3 }));
        expect(newer.log).toEqual([`refuse ${NEWER}`]);
    });

    test('a daemon from before versions answers without one and is the older case', () => {
        const { gate, log } = gateWith(1);
        gate.received(answer({ id: 'daemon', label: 'Mac', version: '0.1.0' }));
        expect(log).toEqual([`refuse ${OLDER}`]);
    });

    test('holds frames that arrive before the answer and delivers them after opening', () => {
        const { gate, log } = gateWith();
        gate.received('{"type":"event","event":"processes.alerts","payload":[]}');
        gate.received(answer({ protocol: 2 }));
        gate.received('{"id":"1","ok":true,"result":{}}');
        expect(log).toEqual(['open', 'message {"type":"event","event":"processes.alerts","payload":[]}', 'message {"id":"1","ok":true,"result":{}}']);
    });

    test('a refused endpoint.info is not judged', () => {
        const { gate, log } = gateWith();
        gate.received(JSON.stringify({ id: 'protocol', ok: false, error: { code: 'x', message: 'no' } }));
        expect(log).toEqual(['open']);
    });
});

test('withProtocol adds the version to a URL with or without a query', () => {
    expect(withProtocol('ws://127.0.0.1:4210/ws', 3)).toBe('ws://127.0.0.1:4210/ws?protocol=3');
    expect(withProtocol('ws://127.0.0.1:4210/ws?token=t', 3)).toBe('ws://127.0.0.1:4210/ws?token=t&protocol=3');
});

import { describe, expect, test } from 'bun:test';
import { protocolGate, protocolRefusal, withProtocol } from './protocol';

const OLDER = 'This machine runs an older Ruimte. Update Ruimte there, or restart it to pick up the update.';
const NEWER = 'This machine runs a newer Ruimte than this app. Update this app.';

function gateWith(client = 2) {
    const log: string[] = [];
    const gate = protocolGate(
        {
            send: (data) => log.push(`send ${data}`),
            open: (features) => log.push(`open ${features.join(',')}`),
            message: (data) => log.push(`message ${data}`),
            refuse: (failure) => log.push(`refuse ${failure}`)
        },
        client
    );
    return { gate, log };
}

function answer(result: Record<string, unknown>, ok = true): string {
    return JSON.stringify({ id: 'protocol', ok, result });
}

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
        gate.received(answer({ protocol: 2, features: ['session.attach', 'chat.list'] }));
        expect(log.at(-1)).toBe('open session.attach,chat.list');
    });

    test('names the app that asks, for the machine to count', () => {
        const log: string[] = [];
        const gate = protocolGate({ send: (data) => log.push(data), open: () => undefined, message: () => undefined, refuse: () => undefined }, 2, 'station');
        gate.opened();
        expect(log).toEqual(['{"id":"protocol","type":"endpoint.info","payload":{"client":"station"}}']);
    });

    test('refuses a machine on this version that names no features as older', () => {
        const { gate, log } = gateWith();
        gate.received(answer({ protocol: 2 }));
        expect(log).toEqual([`refuse ${OLDER}`]);
    });

    test('refuses an older daemon and a newer one with their own message', () => {
        const older = gateWith();
        older.gate.received(answer({ protocol: 1, features: [] }));
        expect(older.log).toEqual([`refuse ${OLDER}`]);
        const newer = gateWith();
        newer.gate.received(answer({ protocol: 3, features: [] }));
        expect(newer.log).toEqual([`refuse ${NEWER}`]);
    });

    test('says which way the versions differ beside the message', () => {
        const mismatches: string[] = [];
        const gate = protocolGate(
            { send: () => undefined, open: () => undefined, message: () => undefined, refuse: (_failure, mismatch) => mismatches.push(mismatch) },
            2
        );
        gate.received(answer({ protocol: 3, features: [] }));
        expect(mismatches).toEqual(['daemon-newer']);
    });

    test('a daemon from before versions answers without one and is the older case', () => {
        const { gate, log } = gateWith(1);
        gate.received(answer({ id: 'daemon', label: 'Mac', version: '0.1.0' }));
        expect(log).toEqual([`refuse ${OLDER}`]);
    });

    test('holds frames that arrive before the answer and delivers them after opening', () => {
        const { gate, log } = gateWith();
        gate.received('{"type":"event","event":"processes.alerts","payload":[]}');
        gate.received(answer({ protocol: 2, features: [] }));
        gate.received('{"id":"1","ok":true,"result":{}}');
        expect(log).toEqual(['open ', 'message {"type":"event","event":"processes.alerts","payload":[]}', 'message {"id":"1","ok":true,"result":{}}']);
    });

    test('refuses a machine that refuses endpoint.info as older and delivers nothing it held', () => {
        const { gate, log } = gateWith();
        gate.received('{"type":"event","event":"processes.alerts","payload":[]}');
        gate.received(JSON.stringify({ id: 'protocol', ok: false, error: { code: 'x', message: 'no' } }));
        expect(log).toEqual([`refuse ${OLDER}`]);
    });
});

test('withProtocol adds the version to a URL with or without a query', () => {
    expect(withProtocol('ws://127.0.0.1:4210/ws', 3)).toBe('ws://127.0.0.1:4210/ws?protocol=3');
    expect(withProtocol('ws://127.0.0.1:4210/ws?token=t', 3)).toBe('ws://127.0.0.1:4210/ws?token=t&protocol=3');
});

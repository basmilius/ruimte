#!/usr/bin/env bun

import { appendFileSync, existsSync } from 'node:fs';

const MAGIC = new Uint8Array([0x52, 0x44, 0x45, 0x56, 0x01, 0, 0, 0]);
const deviceId = process.argv[2] ?? '';
const log = process.env.RUIMTE_DEVICE_TEST_LOG;
const protocolFd = Number(process.env.RUIMTE_DEVICE_HELPER_PROTOCOL_FD);
if (!Number.isInteger(protocolFd) || protocolFd < 3) {
    process.exit(2);
}

const record = (line: string): void => {
    if (log) {
        appendFileSync(log, `${line}\n`);
    }
};

const concat = (...chunks: Uint8Array[]): Uint8Array => {
    const result = new Uint8Array(chunks.reduce((length, chunk) => length + chunk.byteLength, 0));
    let offset = 0;
    for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return result;
};

const message = (kind: number, payload: Uint8Array): Uint8Array => {
    const result = new Uint8Array(5 + payload.byteLength);
    result[0] = kind;
    new DataView(result.buffer).setUint32(1, payload.byteLength);
    result.set(payload, 5);
    return result;
};

const jsonMessage = (kind: number, value: unknown): Uint8Array => message(kind, new TextEncoder().encode(JSON.stringify(value)));
const frame = (sequence: number): Uint8Array => {
    const data = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    const payload = new Uint8Array(12 + data.byteLength);
    const view = new DataView(payload.buffer);
    view.setUint32(0, data.byteLength);
    view.setUint32(4, sequence);
    view.setUint16(8, 320);
    view.setUint16(10, 640);
    payload.set(data, 12);
    return message(2, payload);
};

record(`start ${deviceId}`);
const writer = Bun.file(protocolFd).writer();
writer.write(MAGIC);
writer.flush();
if (process.env.RUIMTE_DEVICE_TEST_FAIL_START === '1') {
    writer.write(jsonMessage(3, { code: 'device-helper-fixture', message: 'The fake device helper refused to start' }));
    writer.flush();
    writer.end();
    process.exit(1);
}
const inputTask = readInput();
const delay = Number(process.env.RUIMTE_DEVICE_TEST_READY_DELAY_MS ?? 0);
if (Number.isFinite(delay) && delay > 0) {
    await Bun.sleep(delay);
}
const blockStart = process.env.RUIMTE_DEVICE_TEST_BLOCK_START_FILE;
while (blockStart && existsSync(blockStart)) {
    await Bun.sleep(10);
}
writer.write(jsonMessage(1, { width: 320, height: 640 }));
writer.write(frame(7));
writer.flush();
await inputTask;

async function readInput(): Promise<void> {
    let bytes = new Uint8Array();
    let sawMagic = false;
    for await (const chunk of Bun.stdin.stream()) {
        bytes = concat(bytes, chunk);
        if (!sawMagic) {
            if (bytes.byteLength < MAGIC.byteLength) {
                continue;
            }
            if (!bytes.slice(0, MAGIC.byteLength).every((byte, index) => byte === MAGIC[index])) {
                process.exit(3);
            }
            bytes = bytes.slice(MAGIC.byteLength);
            sawMagic = true;
        }
        while (bytes.byteLength >= 5) {
            const length = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(1);
            if (bytes.byteLength < 5 + length) {
                break;
            }
            const kind = bytes[0];
            const payload = bytes.slice(5, 5 + length);
            bytes = bytes.slice(5 + length);
            if (kind === 17) {
                record(`input ${new TextDecoder().decode(payload)}`);
            } else if (kind === 18) {
                record('stop');
                writer.end();
                process.exit(0);
            }
        }
    }
    record('eof');
    writer.end();
}

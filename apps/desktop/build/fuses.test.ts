import { expect, test } from 'bun:test';
import { FUSES, fuseProblems, readFuseWire } from './fuses.cjs';

function binaryWith(states: string): Buffer {
    return Buffer.concat([
        Buffer.from('some code before'),
        Buffer.from('dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX'),
        Buffer.from([1, states.length]),
        Buffer.from(states),
        Buffer.from('after')
    ]);
}

test('reads each fuse of the wire, a removed one included', () => {
    expect(readFuseWire(binaryWith('1001r'))).toEqual({
        runAsNode: true,
        enableCookieEncryption: false,
        enableNodeOptionsEnvironmentVariable: false,
        enableNodeCliInspectArguments: true,
        enableEmbeddedAsarIntegrityValidation: 'removed'
    });
});

test("Electron's defaults are refused, and the packaged app's fuses are not", () => {
    expect(fuseProblems(readFuseWire(binaryWith('10110010')))).toEqual([
        'runAsNode is true, not false',
        'enableCookieEncryption is false, not true',
        'enableNodeOptionsEnvironmentVariable is true, not false',
        'enableNodeCliInspectArguments is true, not false',
        'enableEmbeddedAsarIntegrityValidation is false, not true',
        'onlyLoadAppFromAsar is false, not true'
    ]);
    expect(fuseProblems(readFuseWire(binaryWith('01001110')))).toEqual([]);
});

test('RunAsNode, NODE_OPTIONS and the inspector stay off, asar integrity and cookie encryption on', () => {
    expect(FUSES).toEqual({
        runAsNode: false,
        enableCookieEncryption: true,
        enableNodeOptionsEnvironmentVariable: false,
        enableNodeCliInspectArguments: false,
        enableEmbeddedAsarIntegrityValidation: true,
        onlyLoadAppFromAsar: true
    });
});

test('a binary without a fuse wire is refused', () => {
    expect(() => readFuseWire(Buffer.from('no wire here'))).toThrow('No fuse wire in this binary');
});

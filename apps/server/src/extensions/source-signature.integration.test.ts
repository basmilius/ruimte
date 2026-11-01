import { afterAll, expect, test } from 'bun:test';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sourceSignature } from './source-signature.ts';

const folder = mkdtempSync(join(tmpdir(), 'ruimte-source-signature-'));

afterAll(() => rmSync(folder, { recursive: true, force: true }));

test('stays the same through a build, and moves with a save', () => {
    mkdirSync(join(folder, 'themes'));
    writeFileSync(join(folder, 'themes', 'paper.json'), '{}');

    const before = sourceSignature(folder);

    // What a build does: its output and a copy of the sources, neither of which is a save.
    cpSync(join(folder, 'themes'), join(folder, 'dist', 'themes'), { recursive: true });
    writeFileSync(join(folder, 'dist', 'manifest.json'), '{}');

    expect(sourceSignature(folder)).toBe(before);

    writeFileSync(join(folder, 'themes', 'paper.json'), '{"name":"Paper"}');

    expect(sourceSignature(folder)).not.toBe(before);
});

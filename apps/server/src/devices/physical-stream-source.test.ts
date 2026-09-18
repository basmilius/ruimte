import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPhysicalStreamSourceFactory, physicalStreamHelperPath } from './physical-stream-source.ts';

const directories: string[] = [];

afterEach(async () => {
    await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

test('the production helper lives beside the compiled daemon', () => {
    expect(physicalStreamHelperPath(true, '/Applications/Ruimte/server', '/source/server')).toBe('/Applications/Ruimte/native/ios-device-bridge');
});

test('the development helper is loaded from the Rust release build', () => {
    expect(physicalStreamHelperPath(false, '/usr/local/bin/bun', '/source/apps')).toBe('/source/apps/ios-device-bridge/target/release/ios-device-bridge');
});

test('the HEVC source is only offered when the Rust helper exists', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ruimte-physical-stream-'));
    directories.push(directory);
    const helper = join(directory, 'ios-device-bridge');
    expect(createPhysicalStreamSourceFactory(helper)).toBeNull();

    await writeFile(helper, '');
    expect(createPhysicalStreamSourceFactory(helper)?.('device-1', 'hardware-1').format).toBe('hevc');
});

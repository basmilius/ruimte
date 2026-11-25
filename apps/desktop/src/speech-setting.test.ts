import { afterEach, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SpeechState } from '@ruimte/desktop-bridge';
import { SpeechSetting } from './speech-setting';

const temporary: string[] = [];

afterEach(async () => {
    await Promise.all(temporary.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function fixture() {
    const directory = await mkdtemp(join(tmpdir(), 'ruimte-speech-'));
    const helper = join(directory, 'helper');

    temporary.push(directory);
    await writeFile(helper, 'test');

    return { directory, helper };
}

test('turning it on is remembered for the next start', async () => {
    const { directory, helper } = await fixture();
    const changes: SpeechState[] = [];
    const setting = new SpeechSetting(directory, helper, (state) => changes.push(state));

    expect(await setting.setEnabled(true)).toEqual({ enabled: true, phase: 'ready', error: null });
    expect(changes.at(-1)?.enabled).toBe(true);
    expect(JSON.parse(await readFile(join(directory, 'speech.json'), 'utf8'))).toEqual({ enabled: true });

    const next = new SpeechSetting(directory, helper, () => undefined);
    await next.initialized;

    expect(next.state.enabled).toBe(true);
});

test('a build without the helper is unavailable and stays off', async () => {
    const { directory } = await fixture();
    const setting = new SpeechSetting(directory, join(directory, 'missing'), () => undefined);

    expect(await setting.setEnabled(true)).toMatchObject({ enabled: false, phase: 'unavailable' });
    expect(await Bun.file(join(directory, 'speech.json')).exists()).toBe(false);
});

test('a start removes the retired Nemotron model and keeps it on', async () => {
    const { directory, helper } = await fixture();
    const models = join(directory, 'models');

    for (const folder of ['streaming', 'streaming-coreml-cache', 'coreml-cache']) {
        await mkdir(join(models, folder), { recursive: true });
        await writeFile(join(models, folder, 'weights.bin'), 'old');
    }

    await writeFile(join(directory, 'speech.json'), JSON.stringify({ enabled: true }));
    const setting = new SpeechSetting(directory, helper, () => undefined);
    await setting.initialized;

    expect(setting.state).toEqual({ enabled: true, phase: 'ready', error: null });
    expect(await stat(models).catch(() => null)).toBeNull();
});

test('a models folder that holds something else keeps it', async () => {
    const { directory, helper } = await fixture();
    const models = join(directory, 'models');

    await mkdir(join(models, 'streaming'), { recursive: true });
    await writeFile(join(models, 'other.bin'), 'kept');
    const setting = new SpeechSetting(directory, helper, () => undefined);
    await setting.initialized;

    expect(await Bun.file(join(models, 'other.bin')).exists()).toBe(true);
    expect(await stat(join(models, 'streaming')).catch(() => null)).toBeNull();
});

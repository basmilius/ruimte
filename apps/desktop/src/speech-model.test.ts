import { afterEach, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, open, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SPEECH_FILES, SpeechModel, validModelFile } from './speech-model';

const temporary: string[] = [];
afterEach(async () => {
    await Promise.all(temporary.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});
async function fixture() {
    const directory = await mkdtemp(join(tmpdir(), 'ruimte-speech-'));
    temporary.push(directory);
    const helper = join(directory, 'helper');
    await writeFile(helper, 'test');
    return { directory, helper };
}
test('model files must match both size and SHA-256', async () => {
    const { directory } = await fixture();
    const path = join(directory, 'model');
    const bytes = Buffer.from('model');
    const file = { size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
    expect(await validModelFile(path, file)).toBe(false);
    await writeFile(path, bytes);
    expect(await validModelFile(path, file)).toBe(true);
    await writeFile(path, 'wrong');
    expect(await validModelFile(path, file)).toBe(false);
    await writeFile(path, '');
    expect(await validModelFile(path, file)).toBe(false);
});
test('a truncated download never enables dictation', async () => {
    const { directory, helper } = await fixture();
    const model = new SpeechModel(directory, helper, () => undefined, (async () => new Response('truncated')) as unknown as typeof fetch);
    await model.initialized;
    expect(model.state.enabled).toBe(false);
    const result = await model.setEnabled(true);
    expect(result.phase).toBe('error');
    expect(result.enabled).toBe(false);
    expect(await Bun.file(join(model.directory, 'encoder.onnx')).exists()).toBe(false);
    expect(await Bun.file(join(model.directory, 'encoder.onnx.part')).exists()).toBe(false);
});
test('a missing helper is unavailable and never starts a download', async () => {
    const { directory } = await fixture();
    let calls = 0;
    const model = new SpeechModel(directory, join(directory, 'missing'), () => undefined, (async () => {
        calls++;
        return new Response();
    }) as unknown as typeof fetch);
    await model.setEnabled(true);
    expect(model.state.phase).toBe('unavailable');
    expect(calls).toBe(0);
});

test('a start reads only the model files that changed since their last full check', async () => {
    const { directory, helper } = await fixture();
    const models = join(directory, 'models', 'streaming');
    await mkdir(models, { recursive: true });
    // Sparse files of the sizes the model has, so nothing is written; the check itself is faked.
    for (const file of SPEECH_FILES) {
        const handle = await open(join(models, file.name), 'w');
        await handle.truncate(file.size);
        await handle.close();
    }
    await writeFile(join(directory, 'speech.json'), JSON.stringify({ enabled: true }));
    const checked: string[] = [];
    const verify = async (path: string): Promise<boolean> => {
        checked.push(path.slice(models.length + 1));
        return true;
    };
    const start = async (): Promise<SpeechModel> => {
        const model = new SpeechModel(directory, helper, () => undefined, fetch, verify);
        await model.initialized;
        return model;
    };

    expect((await start()).state).toMatchObject({ enabled: true, phase: 'ready' });
    expect(checked).toEqual(SPEECH_FILES.map((file) => file.name));

    checked.length = 0;
    expect((await start()).state).toMatchObject({ enabled: true, phase: 'ready' });
    expect(checked).toEqual([]);

    const later = new Date(Date.now() + 60_000);
    await utimes(join(models, 'tokenizer.model'), later, later);
    expect((await start()).state).toMatchObject({ enabled: true, phase: 'ready' });
    expect(checked).toEqual(['tokenizer.model']);
});

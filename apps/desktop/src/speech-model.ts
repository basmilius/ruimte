import { createHash } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { mkdir, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { SpeechState } from '@ruimte/desktop-bridge';

export const SPEECH_REVISION = 'a61d2818df4659c956b9661a9447f46e98c15126';
export const SPEECH_FILES = [
    { name: 'encoder.onnx', size: 42164972, sha256: 'd569fbe78b48fbb04e169d324f5d25463838ceed7b5fc3bfe209872441979bd9' },
    { name: 'encoder.onnx.data', size: 2454405120, sha256: '7584f85df76bc9ae6fbdfa53aa8d97b07a842525d1c501d536d77fd9e4f57ac7' },
    { name: 'decoder_joint.onnx', size: 97590054, sha256: '634dfadf24cb4f73c2fae170b36611d68db48186426882cbc8f7e02ed9f2bb29' },
    { name: 'tokenizer.model', size: 406554, sha256: 'ce3895e40806f02a26c3a225161b96ef682d6c0054bae32a245dec4258d7d291' }
] as const;
export const SPEECH_BYTES = SPEECH_FILES.reduce((total, file) => total + file.size, 0);

export const validModelFile = async (path: string, file: { size: number; sha256: string }, signal?: AbortSignal): Promise<boolean> => {
    try {
        if ((await stat(path)).size !== file.size) {
            return false;
        }
        const hash = createHash('sha256');
        for await (const bytes of createReadStream(path)) {
            signal?.throwIfAborted();
            hash.update(bytes);
        }
        return hash.digest('hex') === file.sha256;
    } catch (error) {
        signal?.throwIfAborted();
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return false;
        }
        throw error;
    }
};

export class SpeechModel {
    readonly directory: string;
    readonly cacheDirectory: string;
    readonly #settings: string;
    readonly #helper: string;
    readonly #fetch: typeof fetch;
    readonly #changed: (state: SpeechState) => void;
    readonly initialized: Promise<void>;
    #abort: AbortController | null = null;
    #operation: Promise<SpeechState> | null = null;
    #state: SpeechState = { enabled: false, phase: 'missing', downloadedBytes: 0, totalBytes: SPEECH_BYTES, error: null };

    constructor(home: string, helper: string, changed: (state: SpeechState) => void, fetcher: typeof fetch = fetch) {
        this.directory = join(home, 'models', 'streaming');
        this.cacheDirectory = join(home, 'models', 'streaming-coreml-cache');
        this.#settings = join(home, 'speech.json');
        this.#helper = helper;
        this.#fetch = fetcher;
        this.#changed = changed;
        this.initialized = this.#initialize();
    }

    get state(): SpeechState {
        return { ...this.#state };
    }

    #update(patch: Partial<SpeechState>): SpeechState {
        this.#state = { ...this.#state, ...patch };
        this.#changed(this.state);
        return this.state;
    }

    async #save(enabled: boolean): Promise<void> {
        await mkdir(this.directory, { recursive: true });
        await writeFile(`${this.#settings}.tmp`, JSON.stringify({ enabled }));
        await rename(`${this.#settings}.tmp`, this.#settings);
    }

    async #initialize(): Promise<void> {
        try {
            if (!existsSync(this.#helper)) {
                this.#update({ phase: 'unavailable' });
                return;
            }
            const enabled = JSON.parse(await readFile(this.#settings, 'utf8')).enabled === true;
            let complete = true;
            for (const file of SPEECH_FILES) {
                if (!(await validModelFile(join(this.directory, file.name), file))) {
                    complete = false;
                    break;
                }
            }
            this.#update({ enabled: enabled && complete, phase: complete ? 'ready' : 'missing', downloadedBytes: complete ? SPEECH_BYTES : 0 });
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
                this.#update({ phase: 'error', error: error instanceof Error ? error.message : String(error) });
            }
        }
    }

    async setEnabled(enabled: boolean): Promise<SpeechState> {
        await this.initialized;
        if (!enabled) {
            this.#update({ enabled: false });
            this.#abort?.abort();
            await this.#operation?.catch(() => undefined);
            await this.#save(false);
            return this.#update({ enabled: false, phase: this.#state.phase === 'ready' ? 'ready' : 'missing', error: null });
        }
        if (this.#operation) {
            return this.#operation;
        }
        if (!existsSync(this.#helper)) {
            return this.#update({ enabled: false, phase: 'unavailable' });
        }
        const abort = new AbortController();
        this.#abort = abort;
        this.#operation = this.#install(abort.signal).finally(() => {
            this.#operation = null;
            this.#abort = null;
        });
        return this.#operation;
    }

    async #install(signal: AbortSignal): Promise<SpeechState> {
        this.#update({ enabled: false, phase: 'verifying', error: null, downloadedBytes: 0 });
        try {
            await mkdir(this.directory, { recursive: true });
            let completed = 0;
            for (const file of SPEECH_FILES) {
                signal.throwIfAborted();
                const destination = join(this.directory, file.name);
                if (await validModelFile(destination, file, signal)) {
                    completed += file.size;
                    this.#update({ downloadedBytes: completed });
                    continue;
                }
                const temporary = `${destination}.part`;
                this.#update({ phase: 'downloading' });
                try {
                    const response = await this.#fetch(
                        `https://huggingface.co/altunenes/parakeet-rs/resolve/${SPEECH_REVISION}/nemotron-3.5-asr-streaming-0.6b-onnx/${file.name}`,
                        { signal }
                    );
                    if (!response.ok || !response.body) {
                        throw new Error(`Model download failed (${response.status})`);
                    }
                    const handle = await open(temporary, 'w');
                    const reader = response.body.getReader();
                    const hash = createHash('sha256');
                    let received = 0;
                    let lastUpdate = 0;
                    try {
                        while (true) {
                            const { done, value } = await reader.read();
                            if (done) {
                                break;
                            }
                            signal.throwIfAborted();
                            received += value.byteLength;
                            if (received > file.size) {
                                throw new Error('Model download is larger than expected');
                            }
                            hash.update(value);
                            await handle.writeFile(value);
                            if (Date.now() - lastUpdate > 100) {
                                this.#update({ downloadedBytes: completed + received });
                                lastUpdate = Date.now();
                            }
                        }
                    } finally {
                        await reader.cancel().catch(() => undefined);
                        await handle.close();
                    }
                    this.#update({ phase: 'verifying' });
                    if (received !== file.size || hash.digest('hex') !== file.sha256) {
                        throw new Error('Model download failed its integrity check');
                    }
                    signal.throwIfAborted();
                    await rename(temporary, destination);
                    completed += received;
                    this.#update({ downloadedBytes: completed });
                } finally {
                    await rm(temporary, { force: true });
                }
            }
            signal.throwIfAborted();
            await this.#save(true);
            return this.#update({ enabled: true, phase: 'ready', downloadedBytes: SPEECH_BYTES });
        } catch (error) {
            return this.#update({
                enabled: false,
                phase: signal.aborted ? 'missing' : 'error',
                error: signal.aborted ? null : error instanceof Error ? error.message : String(error)
            });
        }
    }

    async remove(): Promise<SpeechState> {
        await this.setEnabled(false);
        await rm(this.directory, { recursive: true, force: true });
        await rm(this.cacheDirectory, { recursive: true, force: true });
        return this.#update({ phase: 'missing', downloadedBytes: 0 });
    }

    dispose(): void {
        this.#abort?.abort();
    }
}

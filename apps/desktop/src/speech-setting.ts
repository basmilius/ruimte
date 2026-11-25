import { existsSync } from 'node:fs';
import { readFile, rm, rmdir } from 'node:fs/promises';
import { join } from 'node:path';
import { writeAtomic } from '@adecore/utils/fs';
import type { SpeechState } from '@ruimte/desktop-bridge';

// Where releases before Apple Speech kept the Nemotron model and its caches, 2.6 GB nothing reads any more.
const RETIRED_MODEL_FOLDERS = ['streaming', 'streaming-coreml-cache', 'coreml-cache'];

/* Whether Speech to Text is on. Apple Speech keeps the language models in macOS, so the shell holds none. */
export class SpeechSetting {
    readonly #settings: string;
    readonly #models: string;
    readonly #helper: string;
    readonly #changed: (state: SpeechState) => void;
    readonly initialized: Promise<void>;
    #state: SpeechState = { enabled: false, phase: 'ready', error: null };

    constructor(home: string, helper: string, changed: (state: SpeechState) => void) {
        this.#settings = join(home, 'speech.json');
        this.#models = join(home, 'models');
        this.#helper = helper;
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

    async #initialize(): Promise<void> {
        await this.#dropRetiredModel();

        if (!existsSync(this.#helper)) {
            this.#update({ phase: 'unavailable' });

            return;
        }

        try {
            this.#update({ enabled: JSON.parse(await readFile(this.#settings, 'utf8')).enabled === true });
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
                this.#update({ phase: 'error', error: error instanceof Error ? error.message : String(error) });
            }
        }
    }

    async setEnabled(enabled: boolean): Promise<SpeechState> {
        await this.initialized;

        if (this.#state.phase === 'unavailable') {
            return this.state;
        }

        await writeAtomic(this.#settings, JSON.stringify({ enabled }));

        return this.#update({ enabled, phase: 'ready', error: null });
    }

    async #dropRetiredModel(): Promise<void> {
        try {
            await Promise.all(RETIRED_MODEL_FOLDERS.map((folder) => rm(join(this.#models, folder), { recursive: true, force: true })));
            await rmdir(this.#models);
        } catch (error) {
            // A models folder that holds something else, or never existed, stays as it is.
            if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes((error as NodeJS.ErrnoException).code ?? '')) {
                console.warn('The retired speech model could not be removed:', error);
            }
        }
    }
}

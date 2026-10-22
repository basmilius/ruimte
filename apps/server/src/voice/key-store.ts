import { mkdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { VOICE_KEY_MAX_BYTES } from '@ruimte/contracts';
import { isNotFound, writeAtomic, Serializer } from '@adecore/agents';

export const VOICE_DIR = 'voice';

const KEY_FILE = 'openai.json';
const KEY_VERSION = 1;

interface KeyFile {
    version: number;
    key: string;
}

/* What a person may hand in as a key: no line breaks or spaces inside, which a paste of something else carries. */
export function voiceKeyProblem(key: string): string | null {
    if (key === '') {
        return 'The key is empty';
    }
    if (new TextEncoder().encode(key).length > VOICE_KEY_MAX_BYTES) {
        return `The key is longer than ${VOICE_KEY_MAX_BYTES} bytes`;
    }
    if (/\s/.test(key)) {
        return 'The key holds a space or a line break';
    }
    return null;
}

/*
 * The OpenAI key Voice run by the daemon mints its sessions with, one file under `$RUIMTE_HOME/voice`,
 * 0600 in a 0700 folder and replaced whole. A person puts it there: in the desktop app's settings, which
 * the shell hands over on the local secret, with `ruimte voice key set`, or with `voice.setKey`. Nothing
 * reads it from a CLI's own credentials. `MachineHome` refuses the folder to every client file request, and the only
 * reader is the start of a Voice session, which hands it to OpenAI and nowhere else.
 */
export class VoiceKeyStore {
    private readonly dir: string;
    private readonly writes = new Serializer();

    constructor(home: string) {
        this.dir = join(home, VOICE_DIR);
    }

    get path(): string {
        return join(this.dir, KEY_FILE);
    }

    has(): Promise<boolean> {
        return this.writes.run(async () => (await this.load()) !== null);
    }

    /* Read on every start, so a key set or cleared from the CLI holds for the next session without a restart. */
    read(): Promise<string | null> {
        return this.writes.run(() => this.load());
    }

    write(key: string): Promise<void> {
        const trimmed = key.trim();
        const problem = voiceKeyProblem(trimmed);
        if (problem !== null) {
            return Promise.reject(new Error(problem));
        }
        return this.writes.run(async () => {
            await mkdir(this.dir, { recursive: true, mode: 0o700 });
            const file: KeyFile = { version: KEY_VERSION, key: trimmed };
            await writeAtomic(this.path, `${JSON.stringify(file, null, 2)}\n`, 0o600, { durable: true });
        });
    }

    /* True when there was a key to remove. */
    clear(): Promise<boolean> {
        return this.writes.run(async () => {
            const had = (await this.load()) !== null;
            await rm(this.path, { force: true });
            return had;
        });
    }

    private async load(): Promise<string | null> {
        let text: string;
        try {
            text = await readFile(this.path, 'utf8');
        } catch (e) {
            if (isNotFound(e)) {
                return null;
            }
            throw e;
        }
        try {
            const file = JSON.parse(text) as Partial<KeyFile>;
            return typeof file.key === 'string' && voiceKeyProblem(file.key) === null ? file.key : null;
        } catch {
            // Neither the text nor the parser's message, which quotes it: both hold the key.
            console.warn(`The Voice key file ${this.path} is not JSON and counts as no key`);
            return null;
        }
    }
}

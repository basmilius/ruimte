import { VoiceKeyStore } from '../voice/key-store.ts';

export interface VoiceCliOptions {
    args: string[];
    home: string;
    /* Whether a person types at this end, so the key is asked for without echo; otherwise it is read from stdin. */
    interactive: boolean;
    /* The key a person typed without echo, or what stdin held; never an argument, which a shell keeps in its history. */
    readKey(interactive: boolean): Promise<string>;
    out?: (line: string) => void;
    err?: (line: string) => void;
}

const USAGE = 'Usage: ruimte voice key set|clear|status (set reads the key from stdin or asks for it, never from an argument)';

/*
 * `ruimte voice key`: the OpenAI key Voice run by the daemon mints with, in the home of the daemon it names.
 * The file is read at every start of a session, so the running daemon needs no restart.
 */
export async function runVoice(options: VoiceCliOptions): Promise<number> {
    const out = options.out ?? ((line: string) => console.log(line));
    const err = options.err ?? ((line: string) => console.error(line));
    const [noun, action, ...rest] = options.args;
    if (noun !== 'key' || (action !== 'set' && action !== 'clear' && action !== 'status') || rest.length > 0) {
        err(USAGE);
        return 2;
    }
    const store = new VoiceKeyStore(options.home);
    if (action === 'status') {
        out((await store.has()) ? `A Voice key is set in ${options.home}.` : `No Voice key is set in ${options.home}.`);
        return 0;
    }
    if (action === 'clear') {
        out((await store.clear()) ? `The Voice key is removed from ${options.home}.` : `No Voice key was set in ${options.home}.`);
        return 0;
    }
    const key = (await options.readKey(options.interactive)).trim();
    try {
        await store.write(key);
    } catch (e) {
        // The store's message names the problem, never the key.
        err(`The key was not saved: ${e instanceof Error ? e.message : 'it could not be written'}.`);
        return 1;
    }
    out(`The Voice key is saved in ${options.home}. The daemon uses it from its next Voice session.`);
    return 0;
}

/* One line from the terminal with nothing echoed, ended by Enter; Ctrl+C or Ctrl+D gives up. */
function readHidden(stdin: NodeJS.ReadStream, prompt: (text: string) => void): Promise<string> {
    prompt('OpenAI API key for Voice (not shown): ');
    return new Promise((resolve) => {
        let typed = '';
        const done = (value: string): void => {
            stdin.off('data', onData);
            stdin.setRawMode(false);
            stdin.pause();
            prompt('\n');
            resolve(value);
        };
        const onData = (chunk: Buffer): void => {
            for (const char of chunk.toString('utf8')) {
                if (char === '\r' || char === '\n') {
                    done(typed);
                    return;
                }
                if (char === '\u0003' || char === '\u0004') {
                    done('');
                    return;
                }
                if (char === '\u007f' || char === '\b') {
                    typed = typed.slice(0, -1);
                    continue;
                }
                typed += char;
            }
        };
        stdin.setRawMode(true);
        stdin.resume();
        stdin.on('data', onData);
    });
}

async function readAll(stdin: NodeJS.ReadStream): Promise<string> {
    const chunks: Buffer[] = [];
    for await (const chunk of stdin) {
        chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : (chunk as Buffer));
    }
    return Buffer.concat(chunks).toString('utf8');
}

/* The reader `main.ts` hands in: the terminal when a person sits at one, stdin otherwise (`pbpaste | ruimte voice key set`). */
export function processKeyReader(stdin: NodeJS.ReadStream, prompt: (text: string) => void): (interactive: boolean) => Promise<string> {
    return (interactive) => (interactive ? readHidden(stdin, prompt) : readAll(stdin));
}

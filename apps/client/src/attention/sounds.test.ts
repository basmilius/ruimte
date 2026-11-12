import { afterEach, expect, spyOn, test } from 'bun:test';
import { setCustomSoundFiles } from './custom-sounds';
import { playSound, setSoundPorts } from './sounds';

let restore = (): void => {};

afterEach(() => {
    restore();
    setCustomSoundFiles(null);
});

/* Lets a sound that was asked for reach the player: its file's address loads with the first one, then a few promises settle. */
async function settled(): Promise<void> {
    await import('./sound-urls');

    for (let i = 0; i < 10; i++) {
        await Promise.resolve();
    }
}

test('a built-in sound plays the file of its pack and motif', async () => {
    const played: string[] = [];

    restore = setSoundPorts({ play: async (url) => void played.push(url), now: () => 0 });
    playSound({ pack: 'grand', event: 'question' });
    await settled();

    expect(played).toHaveLength(1);
    expect(played[0]).toEndWith('/attention/sounds/grand/rise.wav');
});

test('the same sound plays once a second, another sound right away', async () => {
    const played: string[] = [];
    let now = 0;

    restore = setSoundPorts({ play: async (url) => void played.push(url.slice(-9)), now: () => now });
    playSound({ pack: 'bar', event: 'finished' });
    now = 999;
    playSound({ pack: 'bar', event: 'finished' });
    playSound({ pack: 'bar', event: 'error' });
    now = 1_000;
    playSound({ pack: 'bar', event: 'finished' });
    await settled();

    expect(played).toEqual(['/trio.wav', 'knock.wav', '/trio.wav']);
});

test('a play the page refuses is dropped', async () => {
    const warned = spyOn(console, 'warn').mockImplementation(() => {});

    try {
        restore = setSoundPorts({ play: () => Promise.reject(new Error('NotAllowedError')), now: () => 0 });
        playSound({ pack: 'bar', event: 'alert' });
        await settled();

        expect(warned).toHaveBeenCalledTimes(1);
    } finally {
        warned.mockRestore();
    }
});

test('an alert every window hears plays only in the window that claims it', async () => {
    const played: string[] = [];
    const claims = [true, false];

    restore = setSoundPorts({ play: async (url) => void played.push(url), now: () => 0, claim: async () => claims.shift() ?? false });
    playSound({ pack: 'bar', event: 'alert' }, 'ruimte-requested-local-node');
    await settled();
    playSound({ pack: 'glass', event: 'alert' }, 'ruimte-requested-local-node');
    await settled();

    expect(played).toHaveLength(1);
    expect(played[0]).toEndWith('/bar/chime.wav');
});

test('a sound of a person’s own plays from its stored file, and a file that went missing plays nothing', async () => {
    const played: string[] = [];
    const file = new Blob([new Uint8Array(4)], { type: 'audio/wav' });

    setCustomSoundFiles({ read: async (_pack, event) => (event === 'question' ? file : null), write: async () => {}, remove: async () => {} });
    restore = setSoundPorts({ play: async (url) => void played.push(url), now: () => 0 });
    playSound({ pack: 'custom-1', event: 'question' });
    playSound({ pack: 'custom-1', event: 'alert' });
    await settled();

    expect(played).toHaveLength(1);
    expect(played[0]).toStartWith('blob:');
});

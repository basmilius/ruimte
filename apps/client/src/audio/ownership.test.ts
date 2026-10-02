import { afterEach, expect, test } from 'bun:test';
import { claimMicrophone } from './ownership';

const scope = globalThis as { window?: unknown };

afterEach(() => {
    delete scope.window;
});

test('a new listener releases the old one and old cleanup cannot release the new owner', () => {
    const stopped: string[] = [];
    const first = claimMicrophone(() => stopped.push('voice'));
    const second = claimMicrophone(() => stopped.push('dictation'));
    expect(stopped).toEqual(['voice']);
    first();
    const third = claimMicrophone(() => stopped.push('next'));
    expect(stopped).toEqual(['voice', 'dictation']);
    second();
    third();
});

test('a claim in another window ends the listener in this one, and a claim here tells the others', () => {
    let claims = 0;
    let claimedElsewhere: (() => void) | null = null;
    scope.window = {
        ruimteDesktop: {
            microphone: {
                claim: () => {
                    claims += 1;
                },
                onClaimed: (listener: () => void) => {
                    claimedElsewhere = listener;
                    return () => undefined;
                }
            }
        }
    };
    const stopped: string[] = [];
    const release = claimMicrophone(() => stopped.push('voice'));
    expect(claims).toBe(1);

    // Dictation started in the other window.
    claimedElsewhere!();
    expect(stopped).toEqual(['voice']);
    claimedElsewhere!();
    expect(stopped).toEqual(['voice']);
    release();
});

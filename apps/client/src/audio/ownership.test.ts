import { expect, test } from 'bun:test';
import { claimMicrophone } from './ownership';

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

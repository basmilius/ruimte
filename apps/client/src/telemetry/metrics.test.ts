import { describe, expect, test } from 'bun:test';
import { REQUEST_SCHEMAS } from '@ruimte/contracts';
import { linkPathOf, REQUEST_AREAS, requestAreaOf } from './metrics';

describe('the area of a request', () => {
    test('is the part before the dot, for every request the wire has', () => {
        const areas = [...new Set(Object.keys(REQUEST_SCHEMAS).map((type) => type.split('.')[0]!))].sort();
        expect<string[]>([...REQUEST_AREAS].sort()).toEqual(areas);
        expect(requestAreaOf('chat.attach')).toBe('chat');
    });

    test('is other for a type no request has', () => {
        expect(requestAreaOf('newarea.thing')).toBe('other');
        expect(requestAreaOf('')).toBe('other');
    });
});

describe('the path of a link', () => {
    test('is local for the socket of this machine, turn once relayed, and else how its signals went', () => {
        expect(linkPathOf({ socket: true, relayed: false, signaled: null })).toBe('local');
        expect(linkPathOf({ socket: false, relayed: true, signaled: 'lan' })).toBe('turn');
        expect(linkPathOf({ socket: false, relayed: false, signaled: 'lan' })).toBe('lan');
        expect(linkPathOf({ socket: false, relayed: false, signaled: 'broker' })).toBe('direct');
        expect(linkPathOf({ socket: false, relayed: false, signaled: null })).toBe('direct');
    });
});

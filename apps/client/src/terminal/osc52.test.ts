import { describe, expect, test } from 'bun:test';
import { osc52Text } from './osc52';

const encode = (text: string): string => btoa(String.fromCharCode(...new TextEncoder().encode(text)));

describe('osc52Text', () => {
    test('decodes what a program copies, whatever selection it names', () => {
        expect(osc52Text(`c;${encode('hello')}`)).toBe('hello');
        expect(osc52Text(`;${encode('héllo wörld')}`)).toBe('héllo wörld');
        expect(osc52Text(`pc;${encode('two')}`)).toBe('two');
    });

    test('never answers a query, and ignores a clear or a payload that is not base64', () => {
        expect(osc52Text('c;?')).toBeNull();
        expect(osc52Text('c;')).toBeNull();
        expect(osc52Text('c')).toBeNull();
        expect(osc52Text('c;not base64!')).toBeNull();
    });
});

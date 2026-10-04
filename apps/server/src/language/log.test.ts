import { describe, expect, it } from 'bun:test';
import { LanguageLog } from './log.ts';

describe('language log', () => {
    it('splits what a process wrote into lines and drops the empty ones', () => {
        const log = new LanguageLog(() => 5);
        log.push('server', 'one\r\n\ntwo  \nthree');
        expect(log.tail()).toEqual([
            { at: 5, stream: 'server', text: 'one' },
            { at: 5, stream: 'server', text: 'two' },
            { at: 5, stream: 'server', text: 'three' }
        ]);
    });

    it('keeps the last 500 lines and cuts a very long one', () => {
        const log = new LanguageLog();
        for (let i = 0; i < 600; i++) {
            log.push('install', `line ${i}`);
        }
        expect(log.tail()).toHaveLength(500);
        expect(log.tail(1)[0].text).toBe('line 599');
        expect(log.tail()[0].text).toBe('line 100');
        log.push('host', 'x'.repeat(5000));
        expect(log.tail(1)[0].text).toHaveLength(2003);
    });

    it('says what a stream last wrote', () => {
        const log = new LanguageLog();
        log.push('server', 'boom');
        log.push('host', 'noted');
        expect(log.last('server')).toBe('boom');
        expect(log.last('install')).toBeNull();
    });
});

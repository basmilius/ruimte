import { describe, expect, test } from 'bun:test';
import { greetingLines } from './greeting.ts';

const facts = { version: '0.4.0', host: '127.0.0.1', port: 4210, home: '/home/bas/.ruimte' };

describe('greetingLines', () => {
    test('a log keeps its one line', () => {
        expect(greetingLines({ ...facts, interactive: false })).toEqual(['ruimte server 0.4.0 listening on ws://127.0.0.1:4210/ws (home: /home/bas/.ruimte)']);
    });

    test('a person at a terminal learns what runs and what comes next', () => {
        const lines = greetingLines({ ...facts, interactive: true });
        expect(lines[0]).toBe('This machine runs Ruimte 0.4.0 on ws://127.0.0.1:4210/ws (home: /home/bas/.ruimte). Ctrl+C stops it.');
        expect(lines[1]).toContain('`ruimte login`');
        expect(lines[1]).toContain('`ruimte service install`');
    });

    test('another port rides along with every command', () => {
        const [, next] = greetingLines({ ...facts, port: 4290, interactive: true });
        expect(next).toContain('`ruimte login --port 4290`');
        expect(next).toContain('`ruimte pair --port 4290`');
        expect(next).toContain('`ruimte service install --port 4290`');
    });
});

import { expect, test } from 'bun:test';
import { terminalDictationText } from './terminal';

test('dictation cannot introduce Enter, escape sequences or other terminal controls', () => {
    expect(terminalDictationText('hello\r\nworld\t!\u2028next\u2029last')).toBe('hello  world ! next last');
    expect(terminalDictationText('\x1b[201~\x03\x00\x7f\x85exit\n')).toBe('[201~exit ');
});

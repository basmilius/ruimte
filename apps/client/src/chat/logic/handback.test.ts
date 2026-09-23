import { expect, test } from 'bun:test';
import type { ChatToolItem } from '@ruimte/contracts';
import { handbackReportOf } from './handback';

const call = (id: string, name: string, input: unknown): ChatToolItem => ({
    id,
    kind: 'tool',
    createdAt: 0,
    turnId: null,
    toolUseId: id,
    name,
    input,
    output: null,
    state: 'done',
    parentToolUseId: null
});

test('a handback call carries its report in `message`, and a call without one is only a tool call', () => {
    expect(handbackReportOf(call('1', 'SubagentHandback', { message: '## Review\n\nAll good.' }))).toBe('## Review\n\nAll good.');
    expect(handbackReportOf(call('2', 'SubagentHandback', { message: '  ' }))).toBeNull();
    expect(handbackReportOf(call('3', 'SubagentHandback', {}))).toBeNull();
    expect(handbackReportOf(call('4', 'Bash', { message: 'not a report' }))).toBeNull();
});

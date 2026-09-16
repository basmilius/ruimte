import { expect, test } from 'bun:test';
import type { ChatToolItem } from '@ruimte/contracts';
import { handbackReportOf, isHandbackNotice, lastHandbackReport } from './handback';

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

// The result Claude Code 2.1.273 left on a background agent that handed its report back.
const NOTICE =
    'This agent\'s report was delivered to you as a message from "a6bd7450917db5fe0" (its SubagentHandback call). Read it there; it is not repeated here.';

test('the notice is matched on its fixed wording, the one-line summary of it included, and nothing else is', () => {
    expect(isHandbackNotice(NOTICE)).toBe(true);
    expect(isHandbackNotice('This agent\'s report was delivered to you as a message from "a6bd7450917db5fe0"..')).toBe(true);
    expect(isHandbackNotice('The report was delivered to you as a message; read it there.')).toBe(false);
    expect(isHandbackNotice('I sent a message from "x" to the team.')).toBe(false);
    expect(isHandbackNotice(null)).toBe(false);
});

test('a handback call carries its report in `message`, and a call without one is only a tool call', () => {
    expect(handbackReportOf(call('1', 'SubagentHandback', { message: '## Review\n\nAll good.' }))).toBe('## Review\n\nAll good.');
    expect(handbackReportOf(call('2', 'SubagentHandback', { message: '  ' }))).toBeNull();
    expect(handbackReportOf(call('3', 'SubagentHandback', {}))).toBeNull();
    expect(handbackReportOf(call('4', 'Bash', { message: 'not a report' }))).toBeNull();
    expect(
        lastHandbackReport([call('1', 'SubagentHandback', { message: 'first' }), call('5', 'Bash', {}), call('6', 'SubagentHandback', { message: 'second' })])
    ).toBe('second');
    expect(lastHandbackReport([])).toBeNull();
});

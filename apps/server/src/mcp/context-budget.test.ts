import { expect, test } from 'bun:test';
import { catalog } from './catalog.ts';
import BUDGET from './context-budget.json';
import { MCP_INSTRUCTIONS } from './instructions.ts';

/*
 * What every session pays in context before its first turn: the tool list as a model sees it, for a chat
 * with every tool shown, and the server's instructions. A change that grows either fails here, so the
 * growth is a choice; a change that shrinks one fails too, until the baseline is lowered to match.
 */
function measured(): { tools: number; instructions: number } {
    const listed = catalog().map((tool) => ({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema }));

    return { tools: Buffer.byteLength(JSON.stringify(listed), 'utf8'), instructions: Buffer.byteLength(MCP_INSTRUCTIONS, 'utf8') };
}

test('the tool list and the instructions stay within their budget', () => {
    const now = measured();

    for (const key of ['tools', 'instructions'] as const) {
        if (now[key] < BUDGET[key]) {
            throw new Error(`The ${key} take ${now[key]} bytes, less than the ${BUDGET[key]} of context-budget.json: lower the baseline to ${now[key]}`);
        }
    }

    expect(now).toEqual(BUDGET);
});

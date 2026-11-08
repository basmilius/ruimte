import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { EXTERNAL_TIERS, type ExternalTier } from '@ruimte/contracts';
import type { CanvasHost } from '../tools/host.ts';
import { approvalTools, type ApprovalPorts } from '../tunnels/approvals.ts';
import { externalActorId, type ExternalCaller } from './caller.ts';
import type { InputSchema, Tool } from './catalog.ts';
import { visibleExternalTools } from './external-catalog.ts';
import BUDGET from './external-context-budget.json';
import { EXTERNAL_INSTRUCTIONS } from './external-instructions.ts';
import FIXTURE from './external-tool-list.fixture.json';

/*
 * The tool list a client elsewhere sees, per tier, held against a fixture so a change cannot rename a tool or a field, change
 * a type or a required flag, or put a tool in a tier it was not in. A tool added to the catalog stays out of every tier until someone lists it.
 * `RUIMTE_WRITE_TOOL_FIXTURE=1 bun test apps/server/src/mcp/external-tool-list.test.ts` writes the fixture and the budget anew.
 * The budget holds what a hosted client pays in context before its first call; like the one of `/mcp`, it grows only by a choice.
 */

const FIXTURE_PATH = join(import.meta.dir, 'external-tool-list.fixture.json');
const BUDGET_PATH = join(import.meta.dir, 'external-context-budget.json');

// Computer use is on and every tier's tools show; the approval tools come with the box.
const host = { computer: { enabled: true } } as unknown as CanvasHost;
const unusedPorts = {} as ApprovalPorts;

function caller(tier: ExternalTier, approvals: boolean): ExternalCaller {
    return {
        kind: 'external',
        id: externalActorId('cred-1'),
        credentialId: 'cred-1',
        label: 'Hosted bot',
        grant: { tier, projects: null, ceiling: 'supervised', approvals }
    };
}

function listOf(tier: ExternalTier, approvals = false): Tool[] {
    return visibleExternalTools(caller(tier, approvals), host, approvalTools(unusedPorts));
}

function shape(tool: Tool) {
    const schema = tool.inputSchema as InputSchema & {
        properties: Record<string, { type?: string; items?: { type?: string }; enum?: string[] }>;
        required?: string[];
    };
    const required = new Set(schema.required ?? []);

    return {
        name: tool.name,
        annotations: { readOnlyHint: tool.annotations.readOnlyHint === true, destructiveHint: tool.annotations.destructiveHint === true },
        fields: Object.entries(schema.properties)
            .map(([key, field]) => ({
                key,
                type: field.type,
                items: field.items?.type ?? null,
                enum: field.enum === undefined ? null : [...field.enum].sort(),
                required: required.has(key)
            }))
            .sort((left, right) => left.key.localeCompare(right.key))
    };
}

function current(): Record<string, ReturnType<typeof shape>[]> {
    const byName = (left: Tool, right: Tool): number => left.name.localeCompare(right.name);

    return {
        ...Object.fromEntries(EXTERNAL_TIERS.map((tier) => [tier, listOf(tier).sort(byName).map(shape)])),
        approvals: approvalTools(unusedPorts).sort(byName).map(shape)
    };
}

function bytes(tools: readonly Tool[]): number {
    return Buffer.byteLength(JSON.stringify(tools.map((tool) => ({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema }))), 'utf8');
}

function measured(): Record<string, number> {
    return {
        ...Object.fromEntries(EXTERNAL_TIERS.map((tier) => [tier, bytes(listOf(tier))])),
        approvals: bytes(approvalTools(unusedPorts)),
        instructions: Buffer.byteLength(EXTERNAL_INSTRUCTIONS, 'utf8')
    };
}

test('each tier lists the names, fields and annotations of the fixture', async () => {
    const now = current();

    if (process.env.RUIMTE_WRITE_TOOL_FIXTURE === '1') {
        await Bun.write(FIXTURE_PATH, `${JSON.stringify(now, null, 4)}\n`);
        await Bun.write(BUDGET_PATH, `${JSON.stringify(measured(), null, 4)}\n`);
    }

    expect(now).toEqual(FIXTURE as unknown as typeof now);
});

test('the approval tools join a credential only with its box, whatever the tier', () => {
    for (const tier of EXTERNAL_TIERS) {
        expect(listOf(tier).map((tool) => tool.name)).not.toContain('approval_list');
        expect(listOf(tier, true).map((tool) => tool.name)).toEqual(expect.arrayContaining(['approval_list', 'approval_answer']));
    }
});

test('the tool lists and the instructions stay within their budget', () => {
    const now = measured();

    for (const key of Object.keys(now)) {
        if (now[key]! < (BUDGET as Record<string, number>)[key]!) {
            throw new Error(
                `The ${key} take ${now[key]} bytes, less than the ${(BUDGET as Record<string, number>)[key]} of external-context-budget.json: lower the baseline to ${now[key]}`
            );
        }
    }

    expect(now).toEqual(BUDGET);
});

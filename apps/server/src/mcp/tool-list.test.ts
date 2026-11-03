import { expect, test } from 'bun:test';
import { join } from 'node:path';
import type { ProjectContent } from '@ruimte/contracts';
import type { CanvasHost } from '../tools/host.ts';
import type { InputSchema, Tool } from './catalog.ts';
import { visibleTools } from './mcp-route.ts';
import FIXTURE from './tool-list.fixture.json';

/*
 * The tool list as a model sees it, held against a fixture so a change to a toolkit cannot rename a
 * tool or a field, change a type, a required flag or an annotation, or show a tool to another caller. Descriptions may change; the budget test keeps them from growing.
 * `RUIMTE_WRITE_TOOL_FIXTURE=1 bun test apps/server/src/mcp/tool-list.test.ts` writes the fixture anew.
 */

const FIXTURE_PATH = join(import.meta.dir, 'tool-list.fixture.json');

interface ListedTool {
    name: string;
    description: string;
    inputSchema: InputSchema;
    annotations: Tool['annotations'];
    audience: Tool['audience'];
}

interface ToolList {
    callers: { chat: string[]; terminal: string[] };
    tools: ListedTool[];
}

function content(): ProjectContent {
    return {
        name: 'repo',
        color: '#123456',
        views: [
            {
                kind: 'canvas',
                id: 'main',
                name: 'Canvas',
                nodes: [
                    { id: 'chat-1', kind: 'chat', title: 'Lead', x: 0, y: 0, w: 560, h: 640, provider: 'claude' },
                    { id: 'term-1', kind: 'terminal', title: 'Shell', x: 0, y: 700, w: 560, h: 360 }
                ],
                texts: [],
                edges: [],
                layouts: []
            }
        ]
    } as ProjectContent;
}

/* A chat sees everything there is: computer use is on and the project has a connection. A terminal has neither. */
function host(everything: boolean): CanvasHost {
    return {
        projects: {
            locate: () => ({ projectId: 'p1', folder: '/nowhere/repo', canvasId: 'main' }),
            read: async () => content()
        },
        computer: { enabled: everything },
        databases: { list: async () => (everything ? [{ id: 'db0' }] : []) }
    } as unknown as CanvasHost;
}

async function current(): Promise<ToolList> {
    const chat = await visibleTools('chat-1', host(true));
    const terminal = await visibleTools('term-1', host(false));
    const names = (tools: readonly Tool[]): string[] => tools.map((tool) => tool.name).sort();

    return {
        callers: { chat: names(chat), terminal: names(terminal) },
        tools: [...chat]
            .sort((left, right) => left.name.localeCompare(right.name))
            .map((tool) => ({
                name: tool.name,
                description: tool.description,
                inputSchema: tool.inputSchema,
                annotations: tool.annotations,
                audience: tool.audience
            }))
    };
}

/* What the fixture holds a tool to: everything but the words. */
function shape(tool: ListedTool) {
    const required = new Set(tool.inputSchema.required ?? []);

    return {
        name: tool.name,
        annotations: { readOnlyHint: tool.annotations.readOnlyHint === true, destructiveHint: tool.annotations.destructiveHint === true },
        audience: tool.audience,
        fields: Object.entries(tool.inputSchema.properties)
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

test('the tool list keeps the names, fields, annotations and callers of the fixture', async () => {
    const now = await current();

    if (process.env.RUIMTE_WRITE_TOOL_FIXTURE === '1') {
        await Bun.write(FIXTURE_PATH, `${JSON.stringify(now, null, 4)}\n`);
    }

    const fixture = FIXTURE as ToolList;

    expect(now.callers).toEqual(fixture.callers);
    expect(now.tools.map(shape)).toEqual(fixture.tools.map(shape));
});

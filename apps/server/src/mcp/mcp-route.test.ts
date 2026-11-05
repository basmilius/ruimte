import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { NODE_SIZE, type ProjectContent } from '@ruimte/contracts';
import { z } from 'zod';
import type { CanvasHost } from '../canvas/host.ts';
import { ContextRefusal } from '../context/context-store.ts';
import { ProjectError } from '../projects/project-error.ts';
import { defineTool, defineToolkit } from '../tools/tool.ts';
import { buildCatalog, type ToolContext } from './catalog.ts';
import { AgentFiles, readOpened } from './files.ts';
import { callTool, handleMcpRequest, visibleTools } from './mcp-route.ts';

const PLACE = { projectId: 'p1', folder: '/nowhere/repo', canvasId: 'main' };

let content: ProjectContent;
let rev: number;
let revisions: Array<number | undefined>;
let alerts: string[];
let computerOn: boolean;
let connections: number;

function freshContent(): ProjectContent {
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
                    { id: 'term-1', kind: 'terminal', title: 'Shell', x: 0, y: 700, w: 560, h: 360 },
                    { id: 'note-1', kind: 'note', title: 'Plan', x: 700, y: 0, w: 320, h: 240, text: '' }
                ],
                texts: [],
                edges: [],
                layouts: []
            }
        ]
    } as ProjectContent;
}

function host(): CanvasHost {
    const projects: Partial<CanvasHost['projects']> = {
        locate: (id) => (id === 'chat-1' || id === 'term-1' ? PLACE : null),
        machineOfNode: () => null,
        read: async () => content,
        revision: async () => rev,
        mutate: async (_projectId, apply, expectedRev) => {
            revisions.push(expectedRev);

            if (expectedRev !== undefined && expectedRev !== rev) {
                throw new ProjectError('rev-conflict', 'The project changed since it was read');
            }

            const mutation = await apply(content);

            if (mutation.content !== null) {
                content = mutation.content;
                rev += 1;
            }

            return mutation.result;
        }
    };

    return {
        projects,
        lineage: { madeBy: (nodeId: string) => (nodeId === 'note-1' ? 'chat-1' : null), depthOf: () => 0, put: async () => {} },
        machine: { agentsDeleteAnyView: false, nodeSize: (kind: keyof typeof NODE_SIZE) => NODE_SIZE[kind] },
        messages: {
            alert: (_nodeId: string, text: string) => {
                alerts.push(text);
            }
        },
        checkouts: { paths: async () => [] },
        context: {
            list: (targetId: string) => (targetId === 'chat-1' ? [{ id: 'note-1', kind: 'text' as const, title: 'Plan' }] : []),
            answer: async (_targetId: string, sourceId: string, tail: number | null) => {
                if (sourceId !== 'note-1') {
                    throw new ContextRefusal('unknown-source', `${sourceId} is not linked to this session`);
                }

                return { text: tail === null ? 'one\ntwo' : 'two' };
            },
            answerSource: async () => ({ text: '' })
        },
        computer: {
            get enabled() {
                return computerOn;
            }
        },
        databases: { list: async () => Array.from({ length: connections }, (_unused, index) => ({ id: `db${index}` })) }
    } as unknown as CanvasHost;
}

function context(caller: string, files = new AgentFiles('/nowhere/repo', [])): ToolContext {
    return { caller, host: host(), files: async () => files };
}

async function call(caller: string, name: string, input: Record<string, unknown>) {
    return callTool(await visibleTools(caller, host()), name, input, context(caller));
}

function textOf(result: Awaited<ReturnType<typeof call>>): string {
    const [first] = result.content;

    return first?.type === 'text' ? first.text : '';
}

beforeEach(() => {
    content = freshContent();
    rev = 4;
    revisions = [];
    alerts = [];
    computerOn = false;
    connections = 0;
});

describe('visibility', () => {
    test('a terminal sees no chat tools, and a chat sees them', async () => {
        const terminal = (await visibleTools('term-1', host())).map((tool) => tool.name);
        const chat = (await visibleTools('chat-1', host())).map((tool) => tool.name);

        expect(terminal).toContain('node_list');
        expect(terminal).not.toContain('plan_new');
        expect(terminal).not.toContain('visual_show');
        expect(terminal).not.toContain('chat_attach');
        expect(chat).toContain('plan_new');
        expect(chat).toContain('ui_catalog');
    });

    test('computer use and databases show their tools only while they are there', async () => {
        expect((await visibleTools('chat-1', host())).some((tool) => tool.name.startsWith('computer_') || tool.name.startsWith('database_'))).toBe(false);

        computerOn = true;
        connections = 1;
        const names = (await visibleTools('chat-1', host())).map((tool) => tool.name);

        expect(names).toContain('computer_act');
        expect(names).toContain('database_query');
    });

    test('a tool the caller cannot see is refused by name', async () => {
        const result = await call('term-1', 'plan_new', {});

        expect(result.isError).toBe(true);
        expect(textOf(result)).toBe('refused unknown-tool: plan_new is not a tool this session has');
    });
});

describe('calls', () => {
    test('a text arrives as it was sent, backslashes included', async () => {
        const result = await call('chat-1', 'alert', { text: 'line one\\nstill line one' });

        expect(result.isError).toBeUndefined();
        expect(textOf(result)).toBe('alerted\tchat-1');
        expect(alerts).toEqual(['line one\\nstill line one']);
    });

    test('a patch lands as one write, held to the revision as a whole', async () => {
        const result = await call('chat-1', 'node_update', { node_id: 'note-1', title: 'Renamed', color: 'blue', revision: 4 });
        const note = content.views[0]!.kind === 'canvas' ? content.views[0]!.nodes.find((node) => node.id === 'note-1') : undefined;

        expect(result.isError).toBeUndefined();
        expect(note?.title).toBe('Renamed');
        expect(note?.accent).toBe('blue');
        expect(revisions).toEqual([4]);
        expect(rev).toBe(5);
    });

    test('a patch with one part refused changes nothing', async () => {
        const result = await call('chat-1', 'view_edit', { view_id: 'main', name: 'Changed', icon: 'no-such-lucide-icon', revision: 4 });

        expect(result.isError).toBe(true);
        expect(content.views[0]!.name).toBe('Canvas');
        expect(rev).toBe(4);
    });

    test('a patch with nothing to change is refused with the fields it takes', async () => {
        const result = await call('chat-1', 'node_update', { node_id: 'note-1' });

        expect(result.isError).toBe(true);
        expect(textOf(result)).toBe('refused nothing-to-change: node_update needs one of title, color');
    });

    test('a field the tool does not take is refused before the tool runs, with the fields it takes', async () => {
        const result = await call('chat-1', 'alert', { text: 'hi', loud: true });

        expect(textOf(result).split('\n')).toEqual(['refused bad-arguments: alert takes no loud', 'fields\ttext']);
        expect(alerts).toEqual([]);
    });

    test('a project write refused by the store comes back as a refusal', async () => {
        const result = await call('chat-1', 'node_update', { node_id: 'note-1', title: 'Late', revision: 3 });

        expect(result.isError).toBe(true);
        expect(textOf(result)).toStartWith('refused rev-conflict: ');
    });
});

describe('context', () => {
    test('context_list names what is linked, and context_read reads it', async () => {
        expect(textOf(await call('chat-1', 'context_list', {}))).toBe('note-1\ttext\tPlan\t-\t-');
        expect(textOf(await call('chat-1', 'context_read', { id: 'note-1' }))).toBe('one\ntwo');
        expect(textOf(await call('chat-1', 'context_read', { id: 'note-1', tail: 1 }))).toBe('two');
    });

    test('a source the caller cannot read is refused with what it can read under it', async () => {
        const result = await call('chat-1', 'context_read', { id: 'note-9' });

        expect(result.isError).toBe(true);
        expect(textOf(result).split('\n')).toEqual(['refused unknown-source: note-9 is not linked to this session', 'note-1\ttext\tPlan']);
    });
});

describe('files', () => {
    let root: string;

    beforeEach(async () => {
        root = await mkdtemp(join(tmpdir(), 'ruimte-mcp-files-'));
    });

    afterEach(async () => {
        await rm(root, { recursive: true, force: true });
    });

    async function opened(files: AgentFiles, path: string): Promise<string> {
        const file = await files.open(path);
        await file.handle.close();

        return file.path;
    }

    test('a file inside an allowed folder opens and one outside is refused', async () => {
        const project = join(root, 'repo');
        const outside = join(root, 'elsewhere.txt');
        await Bun.write(join(project, 'notes.txt'), 'inside');
        await writeFile(outside, 'outside');
        await symlink(outside, join(project, 'link.txt'));
        const files = new AgentFiles(project, [await realpath(project)]);

        expect(await opened(files, 'notes.txt')).toEndWith(`${sep}${join('repo', 'notes.txt')}`);
        await expect(files.open(outside)).rejects.toMatchObject({ code: 'path-outside' });
        await expect(files.open('link.txt')).rejects.toMatchObject({ code: 'path-outside' });
        await expect(files.open('missing.txt')).rejects.toMatchObject({ code: 'bad-path' });
    });

    test('a link that leads out is refused naming where it leads', async () => {
        const project = join(root, 'repo');
        const outside = join(root, 'elsewhere.png');
        await Bun.write(join(project, 'notes.txt'), 'inside');
        await writeFile(outside, 'outside');
        await symlink(outside, join(project, 'link.png'));
        const files = new AgentFiles(project, [await realpath(project)]);

        await expect(files.open('link.png')).rejects.toMatchObject({
            message: `${join(project, 'link.png')} leads to ${await realpath(outside)}, which is outside the folders a tool reads from: the project folder, its worktrees, your chat folder and the temp folder`
        });
    });

    test('the temp folder is always allowed', async () => {
        const path = join(root, 'shot.txt');
        await writeFile(path, 'x');
        const files = await AgentFiles.of(join(root, 'repo'), [], []);

        expect(await opened(files, path)).toEndWith(`${sep}shot.txt`);
    });

    test('an open file reads what was judged, whatever its name points at later', async () => {
        const project = join(root, 'repo');
        const outside = join(root, 'elsewhere.txt');
        const notes = join(project, 'notes.txt');
        await Bun.write(notes, 'inside');
        await writeFile(outside, 'outside');
        const files = new AgentFiles(project, [await realpath(project)]);
        const file = await files.open('notes.txt');
        await rm(notes);
        await symlink(outside, notes);
        const bytes = Buffer.alloc(64);

        try {
            expect(bytes.subarray(0, await readOpened(file.handle, bytes)).toString()).toBe('inside');
        } finally {
            await file.handle.close();
        }
    });
});

describe('images', () => {
    let root: string;
    let project: string;
    let inside: string;
    let outside: string;

    beforeEach(async () => {
        root = await realpath(await mkdtemp(join(tmpdir(), 'ruimte-mcp-images-')));
        project = join(root, 'repo');
        inside = join(project, 'shot.png');
        outside = join(root, 'private.png');
        await Bun.write(inside, 'inside png');
        await writeFile(outside, 'private png');
    });

    afterEach(async () => {
        await rm(root, { recursive: true, force: true });
    });

    /* A tool that names `named` in its answer and hands back `handed` as a picture it wrote. */
    async function shot(named: string, handed: string | null) {
        const tool = defineTool('test', {
            name: 'test_shot',
            description: 'Takes a picture.',
            input: z.object({}),
            run: async (_input, toolCall) => {
                if (handed !== null) {
                    toolCall.image(handed);
                }

                return [`shot\t${named}`, `note\t${named} is not embedded: this process may not read it`];
            }
        });
        const files = new AgentFiles(project, [project]);

        return callTool(
            buildCatalog([defineToolkit('test', [tool], [{ name: 'shots', lines: [] }])]),
            'test_shot',
            {},
            { ...context('chat-1'), files: async () => files }
        );
    }

    function imagesOf(result: Awaited<ReturnType<typeof shot>>): string[] {
        return result.content.flatMap((part) => (part.type === 'image' ? [Buffer.from(part.data, 'base64').toString()] : []));
    }

    test('a path in the answer text is never read as a picture', async () => {
        expect(imagesOf(await shot(outside, null))).toEqual([]);
        expect(imagesOf(await shot(inside, null))).toEqual([]);
    });

    test('a picture a tool hands back is read only inside the caller folders', async () => {
        expect(imagesOf(await shot(inside, inside))).toEqual(['inside png']);
        expect(imagesOf(await shot(outside, outside))).toEqual([]);
    });
});

describe('http', () => {
    const deps = { targetForToken: (token: string) => (token === 'tok-chat' ? 'chat-1' : null), host: host() };

    function post(body: unknown, token: string | null): Request {
        return new Request('http://127.0.0.1:4210/mcp', {
            method: 'POST',
            headers: {
                accept: 'application/json, text/event-stream',
                'content-type': 'application/json',
                ...(token === null ? {} : { authorization: `Bearer ${token}` })
            },
            body: JSON.stringify(body)
        });
    }

    const initialize = {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } }
    };

    test('an unknown token gets 401', async () => {
        expect((await handleMcpRequest(post(initialize, 'stale'), deps)).status).toBe(401);
        expect((await handleMcpRequest(post(initialize, null), deps)).status).toBe(401);
    });

    test('initialize answers the instructions, and the tool list is the caller own', async () => {
        const started = (await (await handleMcpRequest(post(initialize, 'tok-chat'), deps)).json()) as { result: { instructions: string } };
        const listed = await handleMcpRequest(post({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }, 'tok-chat'), deps);
        const { result } = (await listed.json()) as { result: { tools: Array<{ name: string }> } };

        expect(started.result.instructions).toContain('never by id');
        expect(result.tools.map((tool) => tool.name)).toContain('plan_new');
    });
});

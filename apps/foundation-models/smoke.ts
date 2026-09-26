import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AppleBackend } from '../server/src/chat/apple-backend.ts';
import type { BackendEvent } from '@ruimte/agents/chat/backend';

const temporary = await mkdtemp(join(tmpdir(), 'ruimte-apple-smoke-'));
const home = join(temporary, 'state');
const project = join(temporary, 'project');
await mkdir(home);
await mkdir(project);
await writeFile(join(project, 'notes.txt'), 'deployment_color = violet\nlaunch_day = Thursday\n');
await writeFile(
    join(project, 'README.md'),
    [...Array.from({ length: 76 }, (_, index) => `Documentation line ${index}.`), 'Final section: COPPER-77'].join('\n')
);
await writeFile(
    join(project, 'paged.txt'),
    [...Array.from({ length: 124 }, (_, index) => `Documentation line ${index}.`), 'Final section: MAPLE-125'].join('\n')
);
const command = process.env.RUIMTE_APPLE_FOUNDATION_HELPER ?? fileURLToPath(new URL('./.build/debug/ruimte-foundation-models', import.meta.url));
let backend: AppleBackend;
let finish: ((event: BackendEvent) => void) | undefined;
let mode = '';
let tools: string[] = [];
let finalText = '';
let nativeSession: string | null = null;
let readPages: Array<{ path: string; offset: number; content: string; totalLines: number; nextOffset: number | null }> = [];
const contextNotes: string[] = [];
const makeBackend = (resume: string | null, generation: number) =>
    new AppleBackend(
        {
            command: [command],
            cwd: project,
            env: { ...process.env, RUIMTE_HOME: home } as Record<string, string>,
            selection: { model: 'apple-system', options: {} },
            modelName: 'Apple system',
            runtimeMode: 'supervised',
            resume,
            generation,
            context: [],
            depth: 0
        },
        {
            onEvent: (event) => {
                if (event.type === 'session') {
                    nativeSession = event.agentSessionId;
                }
                if (event.type === 'question.requested') {
                    tools.push('AskUserQuestion');
                    console.log(JSON.stringify({ mode, type: event.type, questions: event.questions }));
                    backend.respondQuestion(event.requestId, { [event.questions[0]!.id]: 'Blue' });
                }
                if (event.type === 'approval.requested') {
                    tools.push(event.toolName);
                    console.log(JSON.stringify({ mode, type: event.type, tool: event.toolName, input: event.input }));
                    if (mode === 'cancel') {
                        backend.interrupt();
                    } else {
                        backend.respondApproval(event.requestId, mode === 'deny' ? 'deny' : 'allow', 'Smoke test refusal');
                    }
                }
                if (event.type === 'tool.done') {
                    console.log(JSON.stringify({ mode, type: event.type, output: event.output }));
                    if ((mode === 'read_full' || mode === 'read_paginated') && event.state === 'done') {
                        readPages.push(JSON.parse(event.output));
                    }
                }
                if (event.type === 'note') {
                    contextNotes.push(event.text);
                    console.log(JSON.stringify({ mode, type: event.type, text: event.text }));
                }
                if (event.type === 'text.done') {
                    finalText = event.text;
                }
                if (event.type === 'turn.done' || event.type === 'failed') {
                    finish?.(event);
                }
            }
        }
    );

backend = makeBackend(null, 1);

interface Scenario {
    name: string;
    prompt: string;
    tool?: string;
    answer?: string;
    restart?: boolean;
    readPath?: string;
}
const scenarios: Scenario[] = [
    { name: 'identity', prompt: 'Wie ben je? Geef kort aan welk model je bent en waar je draait.', answer: 'Apple Foundation Models' },
    { name: 'remember', prompt: 'Remember the exact token LANTERN-73 for this conversation. Reply only Saved.' },
    { name: 'recall', prompt: 'What exact token did I ask you to remember? Reply only with that token.', answer: 'LANTERN-73' },
    { name: 'list', prompt: 'Use ListFiles with path . to list the project root.', tool: 'ListFiles', answer: 'notes.txt' },
    {
        name: 'read',
        prompt: 'Use Read to read notes.txt from zero-based line 0. What deployment color does it specify?',
        tool: 'Read',
        answer: 'violet'
    },
    {
        name: 'read_slice',
        prompt: 'Use Read to read notes.txt with offset 1, the zero-based line index. What launch day does that line specify?',
        tool: 'Read',
        answer: 'Thursday'
    },
    {
        name: 'read_full',
        prompt: 'Lees README.md volledig en vertel kort wat erin staat, inclusief de laatste sectie.',
        tool: 'Read',
        answer: 'COPPER-77',
        readPath: 'README.md'
    },
    {
        name: 'read_paginated',
        prompt: 'Lees paged.txt volledig en vertel kort wat erin staat, inclusief de laatste sectie.',
        tool: 'Read',
        answer: 'MAPLE-125',
        readPath: 'paged.txt'
    },
    { name: 'deny', prompt: 'Use Read to read notes.txt from line 0 again. Wait for permission.', tool: 'Read' },
    {
        name: 'search',
        prompt: 'Use Grep with path ., query deployment_color and glob *.txt. Name the matching file.',
        tool: 'Grep',
        answer: 'notes.txt'
    },
    {
        name: 'edit',
        prompt: 'Use Edit on notes.txt. Replace the exact text deployment_color = violet with deployment_color = green. Do not use a shell.',
        tool: 'Edit'
    },
    {
        name: 'write',
        prompt: 'Use Write to create greeting.txt with the exact text hello world followed by a newline. Do not use a shell.',
        tool: 'Write'
    },
    { name: 'command', prompt: "Use Bash to execute printf 'command-ok\\n'. Report its output.", tool: 'Bash', answer: 'command-ok' },
    {
        name: 'ask',
        prompt: 'Before we continue, ask me whether I prefer Blue or Green. Wait for my answer and repeat it.',
        tool: 'AskUserQuestion',
        answer: 'Blue'
    },
    { name: 'persist_seed', prompt: 'Remember the exact token CYPRESS-19 for my next follow-up. Reply only Saved.' },
    { name: 'cancel', prompt: 'Use Read to read notes.txt again.', tool: 'Read' },
    {
        name: 'recall_after_restart',
        prompt: 'What exact token did I most recently ask you to remember? Reply only with that token.',
        answer: 'CYPRESS-19',
        restart: true
    }
];
if (process.argv.includes('--trim')) {
    for (let index = 0; index < 13; index++) {
        scenarios.push({ name: `trim_${index}`, prompt: `Remember marker ${index}. Reply only saved.` });
    }
    scenarios.push({ name: 'recall_after_trim', prompt: 'What was the last numbered marker I gave you? Reply only with its number.', answer: '12' });
}
try {
    await backend.start();
    for (const scenario of scenarios) {
        mode = scenario.name;
        if (scenario.restart) {
            if (!nativeSession) {
                throw new Error('The helper did not return a native session id.');
            }
            await backend.dispose();
            backend = makeBackend(nativeSession, 2);
            await backend.start();
        }
        tools = [];
        readPages = [];
        finalText = '';
        const start = performance.now();
        const result = new Promise<BackendEvent>((resolve) => {
            finish = resolve;
        });
        const timer = setTimeout(() => {
            backend.interrupt();
            finish?.({ type: 'failed', message: 'Smoke timeout' });
        }, 90_000);
        backend.sendTurn({ text: scenario.prompt, preamble: null, attachments: [], mentions: [], skills: [] });
        const completion = await result;
        clearTimeout(timer);
        console.log(JSON.stringify({ mode, milliseconds: Math.round(performance.now() - start), tools, finalText, completion }));
        if (
            completion.type !== 'turn.done' ||
            completion.state !== (mode === 'cancel' || mode === 'deny' ? 'aborted' : 'done') ||
            (scenario.tool && !tools.includes(scenario.tool)) ||
            (scenario.answer && !finalText.toLowerCase().includes(scenario.answer.toLowerCase()))
        ) {
            throw new Error(`Smoke scenario ${mode} failed`);
        }
        if (scenario.readPath) {
            const pages = readPages.filter((page) => page.path === scenario.readPath);
            const covered = new Set(pages.flatMap((page) => page.content.split('\n').map((_line, index) => page.offset + index)));
            if (!pages.some((page) => page.nextOffset === null) || covered.size !== pages[0]?.totalLines) {
                throw new Error(`Smoke scenario ${mode} did not read the complete file`);
            }
        }
    }
    if (!(await readFile(join(project, 'notes.txt'), 'utf8')).includes('deployment_color = green')) {
        throw new Error('The edit did not reach the fixture.');
    }
    if ((await readFile(join(project, 'greeting.txt'), 'utf8')).trim() !== 'hello world') {
        throw new Error('The new file has unexpected content.');
    }
    mode = 'compact';
    const compacted = new Promise<BackendEvent>((resolve) => {
        finish = resolve;
    });
    backend.compact();
    const compactResult = await compacted;
    if (compactResult.type !== 'turn.done' || compactResult.state !== 'done') {
        throw new Error('Manual context trimming failed.');
    }
    if (!contextNotes.some((note) => note.includes('unfinished turn'))) {
        throw new Error('Cancellation did not report the model memory rollback.');
    }
    if (process.argv.includes('--trim') && !contextNotes.some((note) => note.includes('context was summarized'))) {
        throw new Error('Context compaction did not report its summary.');
    }
} finally {
    await backend.dispose();
    await rm(temporary, { recursive: true, force: true });
}

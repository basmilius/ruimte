import { copyFile, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AppleBackend } from '../server/src/chat/apple-backend.ts';
import type { BackendEvent } from '@ruimte/agents/chat/backend';

const source = process.argv[2];
if (!source) {
    throw new Error('Usage: bun apps/foundation-models/workflow-smoke.ts <workday-fixture-folder> [--evaluate-workday]');
}
const inputs = ['README.md', 'overlegnotities.md', 'klantmail.md', 'planning.md'];
const original = new Map(await Promise.all(inputs.map(async (name) => [name, await readFile(join(source, name), 'utf8')] as const)));
const workdayPrompt = await readFile(join(source, 'STARTPROMPT.txt'), 'utf8');
const helper = process.env.RUIMTE_APPLE_FOUNDATION_HELPER ?? fileURLToPath(new URL('./dist/ruimte-foundation-models', import.meta.url));

const scenarios: ('question' | 'question_cancel' | 'denied_read' | 'workday')[] = ['question', 'question_cancel', 'denied_read'];
if (process.argv.includes('--evaluate-workday')) {
    scenarios.push('workday');
}

for (const scenario of scenarios) {
    const temporary = await mkdtemp(join(tmpdir(), 'afm-workflow-smoke-'));
    const project = join(temporary, 'project');
    const home = join(temporary, 'home');
    await mkdir(project);
    await mkdir(home);
    await Promise.all(inputs.map((name) => copyFile(join(source, name), join(project, name))));
    const read = new Set<string>();
    const calls = new Map<string, string>();
    const actions: string[] = [];
    let questions = 0;
    let withdrawn = false;
    let denied = false;
    let text = '';
    let failure: string | undefined;
    let finish: ((event: BackendEvent) => void) | undefined;
    const backend = new AppleBackend(
        {
            command: [helper],
            cwd: project,
            env: { ...process.env, RUIMTE_HOME: home } as Record<string, string>,
            selection: { model: 'apple-system', options: {} },
            modelName: 'Apple',
            runtimeMode: 'full-access',
            resume: null,
            generation: 1,
            context: [],
            depth: 0
        },
        {
            onEvent: (event) => {
                if (event.type === 'tool.started') {
                    calls.set(event.ref, event.name);
                    actions.push(event.name);
                }
                if (event.type === 'approval.requested') {
                    const input = event.input as Record<string, unknown>;
                    if (scenario === 'denied_read' && !denied && event.toolName === 'Read' && input.file_path === 'README.md') {
                        denied = true;
                        backend.respondApproval(event.requestId, 'deny', 'Do not read this file.');
                        return;
                    }
                    const allowed =
                        scenario === 'workday' &&
                        ((event.toolName === 'Read' && inputs.includes(String(input.file_path))) ||
                            (event.toolName === 'Edit' && input.file_path === 'planning.md') ||
                            (event.toolName === 'Write' && input.file_path === 'concept-reactie.md'));
                    if (!allowed || (event.toolName !== 'Read' && read.size !== inputs.length)) {
                        failure = `Unexpected or premature tool: ${event.toolName}`;
                        backend.interrupt();
                    } else {
                        backend.respondApproval(event.requestId, 'allow');
                    }
                }
                if (event.type === 'tool.done' && calls.get(event.ref) === 'Read' && event.state === 'done') {
                    const page = JSON.parse(event.output);
                    if (page.offset === 0 && page.nextOffset === null) {
                        read.add(page.path);
                    }
                }
                if (event.type === 'question.requested') {
                    questions++;
                    console.log(JSON.stringify({ scenario, questions: event.questions, read: [...read] }));
                    if (scenario === 'denied_read') {
                        failure = 'The model asked another question after a final denial.';
                        backend.interrupt();
                    } else if (scenario === 'question_cancel') {
                        backend.interrupt();
                    } else if (scenario === 'workday' && read.size !== inputs.length) {
                        failure = 'Asked for clarification before reading the supplied files.';
                        backend.interrupt();
                    } else {
                        const answer = scenario === 'question' ? 'Donderdag.' : 'Stel dinsdag 6 oktober om 11:00 voor. Dit is nog niet bevestigd.';
                        backend.respondQuestion(event.requestId, { [event.questions[0]!.id]: answer });
                    }
                }
                if (event.type === 'request.withdrawn') {
                    withdrawn = true;
                }
                if (event.type === 'text.done') {
                    text = event.text;
                }
                if (event.type === 'turn.done' || event.type === 'failed') {
                    finish?.(event);
                }
            }
        }
    );
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        await backend.start();
        const done = new Promise<BackendEvent>((resolve) => {
            finish = resolve;
        });
        timer = setTimeout(() => {
            failure = 'Workflow smoke timed out.';
            backend.interrupt();
            finish?.({ type: 'failed', message: failure });
        }, 90_000);
        backend.sendTurn({
            text:
                scenario === 'denied_read'
                    ? 'Lees README.md en vat de inhoud kort samen.'
                    : scenario !== 'workday'
                      ? 'Vraag me op welke dag ik een teamlunch wil houden en wacht op mijn antwoord. Herhaal daarna alleen de gekozen dag in je antwoord.'
                      : workdayPrompt,
            preamble: null,
            attachments: [],
            mentions: [],
            skills: []
        });
        const result = await done;
        console.log(JSON.stringify({ scenario, actions, questions, read: [...read], text, result, failure }));
        if (scenario === 'question_cancel') {
            if (failure || result.type !== 'turn.done' || result.state !== 'aborted' || questions !== 1 || !withdrawn) {
                throw new Error(failure ?? 'Cancelling the question did not withdraw its card and abort the turn.');
            }
            continue;
        }
        if (failure || result.type !== 'turn.done' || result.state !== (scenario === 'denied_read' ? 'aborted' : 'done')) {
            throw new Error(failure ?? 'The workflow did not finish.');
        }
        if (scenario === 'denied_read') {
            if (!denied || questions || actions.length !== 1) {
                throw new Error('A denied read was not treated as a final decision.');
            }
        } else if (scenario === 'question') {
            if (!questions || !text.toLowerCase().includes('donderdag')) {
                throw new Error('The natural-language request did not use a question card and its answer.');
            }
        } else {
            if (read.size !== inputs.length) {
                throw new Error('The model did not read all supplied files.');
            }
            const planning = await readFile(join(project, 'planning.md'), 'utf8');
            const reply = await readFile(join(project, 'concept-reactie.md'), 'utf8');
            if (planning === original.get('planning.md') || !reply.trim()) {
                throw new Error('The requested documents were not written.');
            }
            for (const name of inputs.filter((name) => name !== 'planning.md')) {
                if ((await readFile(join(project, name), 'utf8')) !== original.get(name)) {
                    throw new Error(`Source file was changed: ${name}`);
                }
            }
            console.log(JSON.stringify({ scenario, planning, reply }));
        }
    } finally {
        clearTimeout(timer);
        await backend.dispose();
        await rm(temporary, { recursive: true, force: true });
    }
}

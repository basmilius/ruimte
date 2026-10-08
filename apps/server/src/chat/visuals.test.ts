import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { VISUAL_LIMITS, type ChatItem, type ChatVisual, type ProjectContent } from '@ruimte/contracts';
import { visualFileName } from '@adecore/agents/chat/visual-store';
import { ManualClock } from '@adecore/agents/outbox/manual-clock';
import { readBytes } from '../bytes/read-bytes.ts';
import type { VisualHost } from '../canvas/verb.ts';
import { IMAGES_LINE, SHOWN_LINE } from '../canvas/visual-verb.ts';
import { VisualRenderError, type VisualPreview } from '../visuals/renderer.ts';
import { ProjectStore } from '../projects/project-store.ts';
import type { SessionEvent } from '../sessions/manager.ts';
import { bootTestDaemon, runVerb, type TestDaemon } from '../tasks/test-daemon.ts';
import { ATTACHMENTS_PATH, handleAttachmentRequest } from './attachment-route.ts';

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
                    { id: 'chat-lead', kind: 'chat', title: 'Lead', x: 0, y: 0, w: 560, h: 640, provider: 'claude' },
                    { id: 'term-lead', kind: 'terminal', title: 'Shell', x: 0, y: 700, w: 560, h: 360 }
                ],
                texts: [],
                edges: [],
                layouts: []
            }
        ]
    };
}

const PAGE = '<!doctype html><html><head><title>Bars</title></head><body><div style="background:var(--chart-1)">32</div></body></html>';

let root: string;
let home: string;
let folder: string;
let store: ProjectStore;
let clock: ManualClock;
let running: TestDaemon[];

beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'ruimte-visuals-'));
    home = join(root, 'home');
    folder = join(root, 'repo');
    await mkdir(folder, { recursive: true });
    store = new ProjectStore(home);
    const opened = await store.openProject({ folder });
    await store.save(opened.summary.projectId, opened.document.rev, content());
    store.release(opened.summary.projectId);
    clock = new ManualClock();
    running = [];
});

afterEach(async () => {
    for (const daemon of running) {
        await daemon.stop();
    }
    store.closeAll();
    await rm(root, { recursive: true, force: true });
});

async function boot(
    options: { installed?: ('claude' | 'codex')[]; visualReplies?: boolean; visualRender?: Pick<VisualHost, 'preview' | 'measure'> } = {}
): Promise<TestDaemon> {
    const daemon = await bootTestDaemon({
        home,
        store,
        clock,
        installed: options.installed ?? ['claude'],
        machine: { resumeAtReset: false, visualReplies: options.visualReplies ?? true },
        ...(options.visualRender === undefined ? {} : { visualRender: options.visualRender })
    });
    running.push(daemon);
    return daemon;
}

async function bootWithChat(options: Parameters<typeof boot>[0] = {}): Promise<TestDaemon> {
    const daemon = await boot(options);
    daemon.worker.start();
    await daemon.chats.create({ chatId: 'chat-lead', provider: 'claude', cwd: folder });
    return daemon;
}

/* The events the client the test daemon answers requests for hears, once it attached to a chat. */
function listen(daemon: TestDaemon): SessionEvent[] {
    const events: SessionEvent[] = [];
    daemon.chats.subscribe('client-1', (event) => events.push(event as SessionEvent));
    return events;
}

function visualEvents(events: readonly SessionEvent[]): ChatVisual[][] {
    return events.flatMap((event) => (event.event === 'chat.visuals' ? [event.payload.visuals] : []));
}

async function show(daemon: TestDaemon, caller: string, argv: string[]): Promise<string[]> {
    return runVerb(daemon, caller, 'visual', ['show', ...argv]);
}

async function shown(daemon: TestDaemon, title: string, page = PAGE): Promise<string> {
    const lines = await show(daemon, 'chat-lead', ['--title', title, `--html=${page}`]);
    const [kind, id] = lines[0]!.split('\t');
    expect(kind).toBe('visual');
    return id!;
}

function refusalCode(lines: string[]): string | undefined {
    return lines[0]!.startsWith('refused\t') ? lines[0]!.split('\t')[1] : undefined;
}

function exists(path: string): Promise<boolean> {
    return stat(path).then(
        () => true,
        () => false
    );
}

function pagePath(chatId: string, visualId: string): string {
    return join(home, 'attachments', encodeURIComponent(chatId), `${visualId}.html`);
}

describe('visual verbs', () => {
    test('visual show from a chat stores the page, says it is shown above the reply, and an attached client hears it', async () => {
        const daemon = await bootWithChat();
        expect(await daemon.request('chat.attach', { chatId: 'chat-lead' })).toMatchObject({ ok: true, result: { visuals: [] } });
        const events = listen(daemon);

        const lines = await show(daemon, 'chat-lead', ['--title', 'Open issues', '--height', '320', `--html=${PAGE}`]);
        const [kind, id, title, size] = lines[0]!.split('\t');
        expect([kind, title]).toEqual(['visual', 'Open issues']);
        expect(lines[1]).toBe(SHOWN_LINE);
        expect(lines).toHaveLength(2);

        const [visual] = await daemon.chats.listVisuals('chat-lead');
        expect(visual).toMatchObject({ id, title: 'Open issues', maxHeight: 320 });
        expect(size).toBe(`${visual!.size} bytes`);
        // The page is stored with the bootstrap in front of what the agent wrote.
        const stored = await readFile(pagePath('chat-lead', id!), 'utf8');
        expect(stored).toContain('<div style="background:var(--chart-1)">32</div>');
        expect(stored.length).toBeGreaterThan(PAGE.length);
        expect(visualEvents(events)).toEqual([[visual!]]);

        const attached = await daemon.request('chat.attach', { chatId: 'chat-lead' });
        expect(attached).toMatchObject({ ok: true, result: { visuals: [visual!] } });
    });

    test('without --height the frame may take the most a visual may, and the page arrives byte for byte through --html', async () => {
        const daemon = await bootWithChat();
        const page = '<p title="a\\nb">Ten\tcases</p>\n';
        const id = await shown(daemon, 'Cases', page);
        const [visual] = await daemon.chats.listVisuals('chat-lead');
        expect(visual).toMatchObject({ id, maxHeight: VISUAL_LIMITS.maxHeight });
        expect(await readFile(pagePath('chat-lead', id), 'utf8')).toEndWith(page);
    });

    test('a terminal is told a visual shows only in an AI chat', async () => {
        const daemon = await bootWithChat();
        const lines = await show(daemon, 'term-lead', ['--title', 'Bars', `--html=${PAGE}`]);
        expect(lines[0]).toBe('refused\tvisual-needs-chat\tA visual shows only in the thread of an AI chat, and you are a terminal: answer in text instead');
        expect(refusalCode(await runVerb(daemon, 'term-lead', 'visual', ['list']))).toBe('visual-needs-chat');
        expect(await daemon.chats.listVisuals('chat-lead')).toEqual([]);
    });

    test('with visual replies off a chat is told to answer in text, and what it showed before still lists', async () => {
        const daemon = await bootWithChat({ visualReplies: false });
        const lines = await show(daemon, 'chat-lead', ['--title', 'Bars', `--html=${PAGE}`]);
        expect(lines[0]).toBe('refused\tvisuals-off\tA person turned visual replies off on this machine: answer in text, and do not call visual again');
        expect(await daemon.chats.listVisuals('chat-lead')).toEqual([]);
        expect(await runVerb(daemon, 'chat-lead', 'visual', ['list'])).toEqual(['note\tThis chat shows no visual']);
    });

    test('what the store refuses comes back under its own code and message, with the help to read', async () => {
        const daemon = await bootWithChat();
        const empty = await show(daemon, 'chat-lead', ['--title', 'Bars', '--html=']);
        expect(empty).toEqual(['refused\tvisual-invalid\tThe page is empty; pass one self-contained HTML document', 'detail\truimte-context help visual']);
        const blank = await show(daemon, 'chat-lead', ['--title', ' ', `--html=${PAGE}`]);
        expect(blank[0]).toBe('refused\tvisual-invalid\tA visual needs a title; give it a short one that says what the page shows');
        const long = await show(daemon, 'chat-lead', ['--title', 'x'.repeat(VISUAL_LIMITS.title + 1), `--html=${PAGE}`]);
        expect(refusalCode(long)).toBe('visual-invalid');
        const large = await show(daemon, 'chat-lead', ['--title', 'Bars', `--html=${'x'.repeat(VISUAL_LIMITS.bytes + 1)}`]);
        expect(refusalCode(large)).toBe('visual-too-large');
        expect(large[0]).toContain('load libraries from a public CDN URL');
        expect(await daemon.chats.listVisuals('chat-lead')).toEqual([]);
    });

    test('the command line is checked before anything is stored', async () => {
        const daemon = await bootWithChat();
        expect(await show(daemon, 'chat-lead', [`--html=${PAGE}`])).toEqual([
            'refused\tbad-arguments\tvisual show needs --title, a few words that say what the page shows',
            'usage\tvisual show\t--title T [--height H] (< page.html | --html H)',
            'detail\truimte-context help visual show'
        ]);
        expect((await show(daemon, 'chat-lead', ['--title', 'Bars', '--height', 'tall', `--html=${PAGE}`]))[0]).toBe(
            'refused\tbad-arguments\t--height takes a whole number of CSS pixels'
        );
        expect((await show(daemon, 'chat-lead', ['--title', 'Bars', '--height', '40', `--html=${PAGE}`]))[0]).toBe(
            `refused\tbad-arguments\t--height is from ${VISUAL_LIMITS.minHeight} to ${VISUAL_LIMITS.maxHeight} CSS pixels`
        );
        expect(refusalCode(await show(daemon, 'chat-lead', ['page.html', '--title', 'Bars']))).toBe('bad-arguments');
        expect(refusalCode(await runVerb(daemon, 'chat-lead', 'visual', ['remove']))).toBe('bad-arguments');
        expect(await daemon.chats.listVisuals('chat-lead')).toEqual([]);
    });

    test('visual list prints every visual of the chat and visual remove takes one away, for every attached client', async () => {
        const daemon = await bootWithChat();
        await daemon.request('chat.attach', { chatId: 'chat-lead' });
        const first = await shown(daemon, 'Bars');
        const second = await shown(daemon, 'Lines');
        const [one, two] = await daemon.chats.listVisuals('chat-lead');
        expect(await runVerb(daemon, 'chat-lead', 'visual', ['list'])).toEqual([
            `visual\t${first}\tBars\t${one!.size} bytes`,
            `visual\t${second}\tLines\t${two!.size} bytes`
        ]);

        const events = listen(daemon);
        expect(await runVerb(daemon, 'chat-lead', 'visual', ['remove', first])).toEqual([`removed\t${first}\tBars`]);
        expect(await exists(pagePath('chat-lead', first))).toBe(false);
        expect(visualEvents(events)).toEqual([[two!]]);

        const gone = await runVerb(daemon, 'chat-lead', 'visual', ['remove', first]);
        expect(gone).toEqual([`refused\tvisual-not-found\tThis chat shows no visual ${first}`, `visual\t${second}\tLines\t${two!.size} bytes`]);

        // A person removes one from its card; one that is already gone is no refusal.
        expect(await daemon.request('chat.removeVisual', { chatId: 'chat-lead', visualId: second })).toMatchObject({ ok: true, result: { visuals: [] } });
        expect(await daemon.request('chat.removeVisual', { chatId: 'chat-lead', visualId: second })).toMatchObject({ ok: true, result: { visuals: [] } });
        expect(visualEvents(events)).toEqual([[two!], []]);
        expect(await runVerb(daemon, 'chat-lead', 'visual', ['list'])).toEqual(['note\tThis chat shows no visual']);
    });

    test('help visual carries the rules for a page and an example to copy', async () => {
        const daemon = await boot();
        const lines = await runVerb(daemon, 'chat-lead', 'help', ['visual']);
        expect(lines[0]).toBe('usage\tvisual\t<write|preview|show|list|remove> ...');
        expect(lines.some((line) => line.startsWith('preview\tPreview first, then show: ruimte-context visual preview < page.html'))).toBe(true);
        expect(lines).toContain(
            'action\tvisual preview\t[--width W] [--appearance dark|light] (< page.html | --html H)\tRenders a self-contained HTML page the way this chat would draw it, without showing it, and answers a png of it, the height it needs and what it wrote to its console.'
        );
        expect(lines.some((line) => line.startsWith('page\tA visual is one self-contained HTML document'))).toBe(true);
        expect(lines.some((line) => line.startsWith('layout\t'))).toBe(true);
        expect(lines.some((line) => line.startsWith('theme\t') && line.includes('--chart-1'))).toBe(true);
        expect(lines.filter((line) => line.startsWith('example\t'))[0]).toBe(
            `example\truimte-context visual show --title "Open issues per label" --height 160 <<'EOF'`
        );
        expect(lines.filter((line) => line.startsWith('example\t')).at(-1)).toBe('example\tEOF');
        expect(lines).toContain(IMAGES_LINE);
        expect(lines.some((line) => line.startsWith('storage\t') && line.includes('outside the project'))).toBe(true);
    });

    test('help visual show and help visual preview say under stdin that local images are embedded', async () => {
        const daemon = await boot();
        expect(IMAGES_LINE).toBe(
            'images\tA local image may be written as its absolute file path, as the whole of a quoted attribute or JS string or the bare argument of a CSS url(), such as <img src="/tmp/before.png">. ' +
                'The CLI reads it in your own process and embeds it, so the page needs no file on this machine: at most 10 MiB per image and 16 MiB for the page with its images. ' +
                'A file counts only when its bytes are an image. visual show refuses a page with an image it cannot embed; visual preview embeds what it can and prints a line for the rest'
        );
        for (const action of ['show', 'preview']) {
            const lines = await runVerb(daemon, 'chat-lead', 'help', ['visual', action]);
            expect(lines[lines.findIndex((line) => line.startsWith('stdin\t')) + 1]).toBe(IMAGES_LINE);
        }
        const show = await runVerb(daemon, 'chat-lead', 'help', ['visual', 'show']);
        expect(show.find((line) => line.startsWith('refusals\t'))).toContain('\tvisual-images-missing\tvisual-image-too-large\t');
        const preview = await runVerb(daemon, 'chat-lead', 'help', ['visual', 'preview']);
        expect(preview).toContain(
            'prints\tmissing|too-large\tpath\treason\tlast, one line per local image the CLI left as written, which visual show would refuse'
        );
    });
});

describe('previews and measured heights', () => {
    function previewed(overrides: Partial<VisualPreview> = {}): VisualPreview {
        return { path: '/home/screenshots/visual-1a2b-1.png', width: 768, height: 420, shotHeight: 420, console: [], omitted: 0, ...overrides };
    }

    test('visual preview prints the shot, the height, the console and that show publishes it, at the reply width in dark by default', async () => {
        const asked: unknown[] = [];
        const preview = async (chatId: string, input: { html: string; width: number; appearance: 'dark' | 'light' }): Promise<VisualPreview> => {
            asked.push({ chatId, ...input });
            return previewed({
                width: input.width,
                console: [
                    { level: 'log', text: 'drawn 3 bars' },
                    { level: 'exception', text: 'Uncaught TypeError: x is not a function at page.html:12:5' }
                ],
                omitted: 4
            });
        };
        const daemon = await bootWithChat({ visualRender: { preview } });
        expect(await runVerb(daemon, 'chat-lead', 'visual', ['preview', `--html=${PAGE}`])).toEqual([
            'shot\t/home/screenshots/visual-1a2b-1.png\tthe png on this machine, which you open with your own tools',
            'height\t420\tthe height the page needs at 768px',
            'console\tlog\tdrawn 3 bars',
            'console\texception\tUncaught TypeError: x is not a function at page.html:12:5',
            'note\t4 more console messages were left out',
            'next\tThis only checked the page; ruimte-context visual show --title T with the same page on stdin shows it above your reply'
        ]);
        await runVerb(daemon, 'chat-lead', 'visual', ['preview', '--width', '400', '--appearance', 'light', `--html=${PAGE}`]);
        expect(asked).toEqual([
            { chatId: 'chat-lead', html: PAGE, width: 768, appearance: 'dark' },
            { chatId: 'chat-lead', html: PAGE, width: 400, appearance: 'light' }
        ]);
        expect(await daemon.chats.listVisuals('chat-lead')).toEqual([]);
    });

    test('a quiet page gets a note, and a page taller than its shot says how much the shot covers', async () => {
        const daemon = await bootWithChat({ visualRender: { preview: async () => previewed({ height: 5200, shotHeight: 4000 }) } });
        const lines = await runVerb(daemon, 'chat-lead', 'visual', ['preview', `--html=${PAGE}`]);
        expect(lines.slice(1, 4)).toEqual([
            'height\t5200\tthe height the page needs at 768px',
            'note\tThe shot covers the first 4000 of those pixels',
            'note\tThe page wrote nothing to its console'
        ]);
    });

    test('without a browser the preview is refused under a code of its own, and show still works', async () => {
        const daemon = await bootWithChat();
        const lines = await runVerb(daemon, 'chat-lead', 'visual', ['preview', `--html=${PAGE}`]);
        expect(lines).toEqual(['refused\tpreview-unavailable\tThis machine renders no previews; show the page with visual show without a preview']);
        await shown(daemon, 'Bars');

        const refusing = await bootWithChat({
            visualRender: {
                preview: async () => {
                    throw new VisualRenderError(
                        'preview-unavailable',
                        'This machine has no Chrome to render a preview with; show the page with visual show without a preview'
                    );
                }
            }
        });
        expect(await runVerb(refusing, 'chat-lead', 'visual', ['preview', `--html=${PAGE}`])).toEqual([
            'refused\tpreview-unavailable\tThis machine has no Chrome to render a preview with; show the page with visual show without a preview'
        ]);
    });

    test('a preview is refused for a terminal, with visual replies off, for an empty page and for flags out of range', async () => {
        let previews = 0;
        const preview = async (): Promise<VisualPreview> => {
            previews++;
            return previewed();
        };
        const daemon = await bootWithChat({ visualRender: { preview } });
        expect(refusalCode(await runVerb(daemon, 'term-lead', 'visual', ['preview', `--html=${PAGE}`]))).toBe('visual-needs-chat');
        expect(await runVerb(daemon, 'chat-lead', 'visual', ['preview', '--html='])).toEqual([
            'refused\tvisual-invalid\tThe page is empty; pass one self-contained HTML document',
            'detail\truimte-context help visual'
        ]);
        expect((await runVerb(daemon, 'chat-lead', 'visual', ['preview', '--width', '200', `--html=${PAGE}`]))[0]).toBe(
            'refused\tbad-arguments\t--width is from 240 to 1600 CSS pixels'
        );
        expect((await runVerb(daemon, 'chat-lead', 'visual', ['preview', '--appearance', 'sepia', `--html=${PAGE}`]))[0]).toBe(
            'refused\tbad-arguments\t--appearance is dark or light'
        );
        const off = await bootWithChat({ visualReplies: false, visualRender: { preview } });
        expect(refusalCode(await runVerb(off, 'chat-lead', 'visual', ['preview', `--html=${PAGE}`]))).toBe('visuals-off');
        expect(previews).toBe(0);
    });

    test('visual show stores the heights the page was measured at, and without them when measuring gave none', async () => {
        const measured: string[] = [];
        let answer: [number, number][] | undefined = [
            [320, 610],
            [768, 420]
        ];
        const measure = async (html: string): Promise<[number, number][] | undefined> => {
            measured.push(html);
            return answer;
        };
        const daemon = await bootWithChat({ visualRender: { measure } });
        const first = await shown(daemon, 'Bars');
        answer = undefined;
        const second = await shown(daemon, 'Lines');
        await show(daemon, 'chat-lead', ['--title', 'Empty', '--html= ']);
        const [one, two] = await daemon.chats.listVisuals('chat-lead');
        expect(one).toMatchObject({
            id: first,
            heights: [
                [320, 610],
                [768, 420]
            ]
        });
        expect(two!.id).toBe(second);
        expect(two!.heights).toBeUndefined();
        // An empty page is refused by the store without a browser started for it.
        expect(measured).toEqual([PAGE, PAGE]);
    });
});

describe('visuals and the chat they belong to', () => {
    test("writes and replaces source only in the caller's chat storage, without publishing it", async () => {
        const daemon = await bootWithChat();
        const path = join(home, 'chats', 'chat-lead.visuals', 'chart.html');
        const lines = await runVerb(daemon, 'chat-lead', 'visual', ['write', '--name', 'chart.html', `--html=${PAGE}`]);
        expect(lines[0]).toBe(`file\t${path}`);
        expect(await readFile(path, 'utf8')).toBe(PAGE);
        await runVerb(daemon, 'chat-lead', 'visual', ['write', '--name', 'chart.html', '--html=<p>Updated</p>']);
        expect(await readFile(path, 'utf8')).toBe('<p>Updated</p>');
        expect(await daemon.chats.listVisuals('chat-lead')).toEqual([]);
        expect(await exists(join(folder, 'chart.html'))).toBe(false);
        expect(refusalCode(await runVerb(daemon, 'chat-lead', 'visual', ['write', '--name', '../other.html', `--html=${PAGE}`]))).toBe('visual-invalid');
        expect(refusalCode(await runVerb(daemon, 'term-lead', 'visual', ['write', '--name', 'chart.html', `--html=${PAGE}`]))).toBe('visual-needs-chat');
        const off = await bootWithChat({ visualReplies: false });
        expect(refusalCode(await runVerb(off, 'chat-lead', 'visual', ['write', '--name', 'other.html', `--html=${PAGE}`]))).toBe('visuals-off');
    });

    const turnsOf = (items: readonly ChatItem[]) => items.filter((item) => item.kind === 'turn');

    const say = async (daemon: TestDaemon, chatId: string, text: string): Promise<void> => {
        const before = turnsOf(daemon.chats.get(chatId)?.thread.list() ?? []).length;
        await daemon.chats.send(chatId, text);
        await daemon.until(() => {
            const chat = daemon.chats.get(chatId);
            return chat !== undefined && chat.info.activeTurnId === null && turnsOf(chat.thread.list()).length === before + 1;
        });
    };

    test('a fork copies the visuals up to its cut, each with a page of its own', async () => {
        const daemon = await bootWithChat({ installed: ['claude', 'codex'] });
        await say(daemon, 'chat-lead', 'one');
        await say(daemon, 'chat-lead', 'two');
        const [first, second] = turnsOf(daemon.chats.get('chat-lead')!.thread.list());
        const kept = await daemon.chats.publishVisual('chat-lead', { title: 'Kept', html: PAGE, turnId: first!.id });
        await daemon.chats.publishVisual('chat-lead', { title: 'Past the cut', html: PAGE, turnId: second!.id });

        const answer = await daemon.request('chat.fork', { chatId: 'chat-lead', turnId: first!.id, provider: 'codex' });
        expect(answer).toMatchObject({ ok: true });
        const { nodeId } = (answer as { result: { nodeId: string } }).result;

        expect(await daemon.chats.listVisuals(nodeId)).toEqual([kept]);
        expect(await readFile(pagePath(nodeId, kept.id), 'utf8')).toBe(await readFile(pagePath('chat-lead', kept.id), 'utf8'));
        // Removing it from the original leaves the fork's page where it is.
        await daemon.chats.removeVisual('chat-lead', kept.id);
        expect(await exists(pagePath(nodeId, kept.id))).toBe(true);
    });

    test('clearing a chat removes its visuals and their pages, and the attached client hears an empty list', async () => {
        const daemon = await bootWithChat();
        const source = await daemon.visuals.writeSource('chat-lead', 'chart.html', PAGE);
        const preview = await daemon.visuals.writePreview('chat-lead', new Uint8Array([137, 80, 78, 71]));
        await daemon.request('chat.attach', { chatId: 'chat-lead' });
        const id = await shown(daemon, 'Bars');
        const events = listen(daemon);

        expect(await daemon.request('chat.clear', { chatId: 'chat-lead' })).toMatchObject({ ok: true });
        expect(await exists(join(home, 'chats', visualFileName('chat-lead')))).toBe(false);
        expect(await exists(pagePath('chat-lead', id))).toBe(false);
        expect(await exists(source)).toBe(false);
        expect(await exists(preview)).toBe(false);
        expect(visualEvents(events)).toEqual([[]]);
        expect(await daemon.chats.listVisuals('chat-lead')).toEqual([]);
    });

    test('deleting a chat removes its visuals and their pages', async () => {
        const daemon = await bootWithChat();
        const source = await daemon.visuals.writeSource('chat-lead', 'chart.html', PAGE);
        const id = await shown(daemon, 'Bars');

        expect(await daemon.request('chat.kill', { chatId: 'chat-lead' })).toMatchObject({ ok: true });
        expect(await exists(join(home, 'chats', visualFileName('chat-lead')))).toBe(false);
        expect(await exists(pagePath('chat-lead', id))).toBe(false);
        expect(await exists(source)).toBe(false);
    });

    test('after a restart the page is found by its id before anyone opened the chat, and goes out as a download', async () => {
        const first = await bootWithChat();
        const id = await shown(first, 'Bars');
        running.splice(running.indexOf(first), 1);
        await first.stop();

        const second = await boot();
        expect(second.chats.get('chat-lead')).toBeUndefined();
        // The lookup a loaded chat answers from knows nothing of a chat nobody opened yet.
        expect(second.chats.attachment('chat-lead', id)).toBeNull();
        const found = await second.chats.findAttachment('chat-lead', id);
        expect(found).toEqual({ id, name: 'Bars.html', mime: 'text/html', size: expect.any(Number), path: pagePath('chat-lead', id) });
        expect(await second.chats.findAttachment('chat-lead', 'nope')).toBeNull();
        expect(await second.chats.findAttachment('chat-other', id)).toBeNull();

        const url = new URL(`http://127.0.0.1:4210${ATTACHMENTS_PATH}/chat-lead/${id}`);
        const response = await handleAttachmentRequest(
            new Request(url, { headers: { authorization: 'Bearer secret' } }),
            url,
            '127.0.0.1',
            { localSecret: 'secret', tickets: { ticketAccess: async () => null } },
            (chatId, attachmentId) => second.chats.findAttachment(chatId, attachmentId)
        );
        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toBe('text/html');
        expect(response.headers.get('content-disposition')).toBe('attachment; filename="Bars.html"');
        expect(response.headers.get('x-content-type-options')).toBe('nosniff');

        const piece = await readBytes(
            { attachment: (chatId, attachmentId) => second.chats.findAttachment(chatId, attachmentId), projectIcon: async () => null, file: async () => null },
            { resource: { kind: 'attachment', chatId: 'chat-lead', attachmentId: id }, offset: 0, length: 256 * 1024 }
        );
        expect(piece.mime).toBe('text/html');
        expect(new TextDecoder().decode(piece.bytes)).toContain('<div style="background:var(--chart-1)">32</div>');
    });
});

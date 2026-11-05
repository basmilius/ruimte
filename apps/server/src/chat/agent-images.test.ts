import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, readdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { ManualClock } from '@adecore/agents/testing';
import { ACTION_DEFINITIONS } from '@ruimte/actions';
import { AgentFiles } from '../agent-files/files.ts';
import type { ProjectStore } from '../projects/project-store.ts';
import { bootTestDaemon, releasedProject, type TestDaemon } from '../tasks/test-daemon.ts';
import { refusalCode, toolAnswer, toolCall } from '../tools/tool-test-helpers.ts';
import { AGENT_ATTACHMENT_LIMIT } from './agent-images.ts';
import { leadAndShellProject } from './lead-chat-test-helpers.ts';

const MIB = 1024 * 1024;

/* Just enough of a PNG for its bytes to read as one. */
const PNG = Buffer.concat([Buffer.from('\x89PNG\r\n\x1a\n', 'latin1'), Buffer.from([0, 0, 0, 13]), Buffer.from('IHDR'), Buffer.alloc(17)]);

/* A binary STL of `triangles` empty triangles, whose size is what tells it from any other binary. */
function binaryStl(triangles: number): Buffer {
    const bytes = Buffer.alloc(84 + 50 * triangles);
    bytes.writeUInt32LE(triangles, 80);
    return bytes;
}

const ASCII_STL = Buffer.from(
    'solid part\n facet normal 0 0 1\n  outer loop\n   vertex 0 0 0\n   vertex 1 0 0\n   vertex 0 1 0\n  endloop\n endfacet\nendsolid part\n'
);

/* A binary glTF header of version 2, the only one a viewer reads. */
const GLB = Buffer.concat([Buffer.from('glTF'), Buffer.from([2, 0, 0, 0, 32, 0, 0, 0]), Buffer.alloc(20)]);

/* The local header of a zip whose first entry is `name`, which is what makes a zip a USDZ package. */
function zipNamed(name: string): Buffer {
    const header = Buffer.alloc(30);
    header.write('PK\x03\x04', 0, 'latin1');
    header.writeUInt16LE(name.length, 26);
    return Buffer.concat([header, Buffer.from(name), Buffer.alloc(16)]);
}

let root: string;
let home: string;
let folder: string;
let store: ProjectStore;
let running: TestDaemon[];

beforeEach(async () => {
    ({ root, home, folder, store } = await releasedProject('ruimte-agent-images-', leadAndShellProject()));
    running = [];
});

afterEach(async () => {
    for (const daemon of running) {
        await daemon.stop();
    }
    store.closeAll();
    await rm(root, { recursive: true, force: true });
});

async function bootWithChat(): Promise<TestDaemon> {
    const daemon = await bootTestDaemon({
        home,
        store,
        clock: new ManualClock(),
        installed: ['claude'],
        machine: { resumeAtReset: false, visualReplies: true }
    });
    running.push(daemon);
    daemon.worker.start();
    await daemon.chats.create({ chatId: 'chat-lead', provider: 'claude', cwd: folder });
    return daemon;
}

let written = 0;

/* What chat_attach answers for these bytes, written to a file of their own in the project folder first. */
async function attach(daemon: TestDaemon, caller: string, bytes: Uint8Array, name = 'shot.png'): Promise<string[]> {
    const place = join(folder, 'attach', String(written++));
    await mkdir(place, { recursive: true });
    await writeFile(join(place, 'upload'), bytes);
    const files = await AgentFiles.of(folder, [], []);

    return (await toolAnswer('chat_attach', { path: join(place, 'upload'), name }, { ...toolCall(caller, daemon.host), files: async () => files })).lines;
}

describe('chat attach', () => {
    test.each(['heic', 'heif'])('stores and retrieves a %s attachment without changing its bytes', async (extension) => {
        const daemon = await bootWithChat();
        const image = await readFile(new URL(`../../../ios/Tests/Fixtures/Files/image.${extension}`, import.meta.url));
        const lines = await attach(daemon, 'chat-lead', image, `photo.${extension}`);
        const [, id] = lines[0]!.split('\t');
        const found = await daemon.chats.findAttachment('chat-lead', id!);

        expect(found).toMatchObject({ name: `photo.${extension}`, mime: 'image/heic' });
        expect(await readFile(found!.path)).toEqual(image);
    });

    test('stores an image under an agent id and prints it, and the attachment lookup answers it', async () => {
        const daemon = await bootWithChat();
        const lines = await attach(daemon, 'chat-lead', PNG);
        const [kind, id, name, mime, size] = lines[0]!.split('\t');
        expect([kind, name, mime, size]).toEqual(['attachment', 'shot.png', 'image/png', String(PNG.byteLength)]);
        expect(id).toMatch(/^agent-[0-9a-f-]{36}$/);
        expect(lines[1]).toBe(`next\tShow it with <Image attachment="${id}" alt="..."/> in a ruimte-ui block`);

        const found = await daemon.chats.findAttachment('chat-lead', id!);
        expect(found).toMatchObject({ id, name: 'shot.png', mime: 'image/png', size: PNG.byteLength });
        expect(found!.path).toStartWith(join(home, 'attachments', 'chat-lead', `${id}~`));
        expect(await readFile(found!.path)).toEqual(PNG);
    });

    test('takes the type from the bytes, so text and a vector image are refused and a renamed gif is a gif', async () => {
        const daemon = await bootWithChat();
        expect(refusalCode(await attach(daemon, 'chat-lead', Buffer.from('a list of things to do\n'), 'shot.png'))).toBe('attach-not-image');
        const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>');
        expect(refusalCode(await attach(daemon, 'chat-lead', svg, 'logo.png'))).toBe('attach-not-image');
        const gif = Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(16)]);
        expect((await attach(daemon, 'chat-lead', gif, 'looks-like.png'))[0]).toContain('\timage/gif\t');
    });

    test('refuses an image past the size limit, and the 65th image of a chat', async () => {
        const daemon = await bootWithChat();
        const large = Buffer.concat([PNG, Buffer.alloc(10 * MIB)]);
        expect(refusalCode(await attach(daemon, 'chat-lead', large))).toBe('attach-too-large');
        for (let i = 0; i < AGENT_ATTACHMENT_LIMIT; i++) {
            expect((await attach(daemon, 'chat-lead', PNG))[0]).toStartWith('attachment\t');
        }
        const lines = await attach(daemon, 'chat-lead', PNG);
        expect(refusalCode(lines)).toBe('attach-limit');
        expect(lines[0]).toContain(`${AGENT_ATTACHMENT_LIMIT} images and models`);
    });

    test('attaches sent at once cannot pass the limit together', async () => {
        const daemon = await bootWithChat();
        const results = await Promise.all(Array.from({ length: AGENT_ATTACHMENT_LIMIT + 6 }, () => attach(daemon, 'chat-lead', PNG)));
        expect(results.filter((lines) => lines[0]!.startsWith('attachment\t'))).toHaveLength(AGENT_ATTACHMENT_LIMIT);
        expect(results.filter((lines) => refusalCode(lines) === 'attach-limit')).toHaveLength(6);
        expect((await readdir(join(home, 'attachments', 'chat-lead'))).filter((name) => name.startsWith('agent-'))).toHaveLength(AGENT_ATTACHMENT_LIMIT);
    });

    test('stores a binary glTF, a USDZ and an STL by their bytes and points at a Model block', async () => {
        const daemon = await bootWithChat();
        const models: Array<[Buffer, string, string]> = [
            [GLB, 'robot.bin', 'model/gltf-binary'],
            [zipNamed('scene.usdc'), 'room.zip', 'model/vnd.usdz+zip'],
            [binaryStl(2), 'part.dat', 'model/stl'],
            [ASCII_STL, 'part.txt', 'model/stl']
        ];
        for (const [bytes, name, mime] of models) {
            const lines = await attach(daemon, 'chat-lead', bytes, name);
            const [kind, id, kept, type, size] = lines[0]!.split('\t');
            expect([kind, kept, type, size]).toEqual(['attachment', name, mime, String(bytes.byteLength)]);
            expect(lines[1]).toBe(`next\tShow it with <Model attachment="${id}">caption</Model> in a ruimte-ui block once the person asks to see it`);
            const found = await daemon.chats.findAttachment('chat-lead', id!);
            expect(found).toMatchObject({ id, name, mime, size: bytes.byteLength });
            expect(new Uint8Array(await readFile(found!.path))).toEqual(new Uint8Array(bytes));
        }
    });

    test('refuses a zip that is no USDZ and an STL whose size does not add up', async () => {
        const daemon = await bootWithChat();
        expect(refusalCode(await attach(daemon, 'chat-lead', zipNamed('readme.txt'), 'scene.usdz'))).toBe('attach-not-image');
        expect(refusalCode(await attach(daemon, 'chat-lead', Buffer.concat([binaryStl(2), Buffer.alloc(1)]), 'part.stl'))).toBe('attach-not-image');
        expect(await stat(join(home, 'attachments', 'chat-lead')).catch(() => null)).toBeNull();
    });

    test('a model may take 50 MiB where an image takes 10, and the two share the limit of a chat', async () => {
        const daemon = await bootWithChat();
        const largest = Math.floor((50 * MIB - 84) / 50);
        expect((await attach(daemon, 'chat-lead', binaryStl(largest), 'large.stl'))[0]).toContain('\tmodel/stl\t');
        expect(refusalCode(await attach(daemon, 'chat-lead', binaryStl(largest + 1), 'larger.stl'))).toBe('attach-too-large');
        for (let i = 1; i < AGENT_ATTACHMENT_LIMIT; i++) {
            expect((await attach(daemon, 'chat-lead', PNG))[0]).toStartWith('attachment\t');
        }
        expect(refusalCode(await attach(daemon, 'chat-lead', GLB, 'robot.glb'))).toBe('attach-limit');
    });

    test('a terminal is told an image attaches only to an AI chat, and nothing is stored', async () => {
        const daemon = await bootWithChat();
        const lines = await attach(daemon, 'term-lead', PNG);
        expect(lines[0]).toStartWith('refused\tattach-needs-chat\t');
        expect(lines[0]).toContain('you are a terminal');
        expect(await stat(join(home, 'attachments', 'term-lead')).catch(() => null)).toBeNull();
    });

    test('a path outside the folders a chat may read is refused before anything is read', async () => {
        const daemon = await bootWithChat();
        const files = await AgentFiles.of(folder, [], []);
        const { lines } = await toolAnswer('chat_attach', { path: '/etc/hosts' }, { ...toolCall('chat-lead', daemon.host), files: async () => files });
        expect(lines[0]).toStartWith('refused\tpath-outside\t');
        expect(await stat(join(home, 'attachments', 'chat-lead')).catch(() => null)).toBeNull();
    });

    test('the action takes no path: only a name and the bytes', () => {
        expect(Object.keys(ACTION_DEFINITIONS['chat.attach'].input.shape)).toEqual(['name', 'data']);
    });
});

describe('finding an agent image', () => {
    test('answers only the exact ids of this chat, never a path or another chat', async () => {
        const daemon = await bootWithChat();
        const [, id] = (await attach(daemon, 'chat-lead', PNG))[0]!.split('\t');
        expect(await daemon.chats.findAttachment('chat-lead', id!)).not.toBeNull();
        expect(await daemon.chats.findAttachment('other-chat', id!)).toBeNull();
        for (const bad of [`${id}.png`, `../${id}`, 'agent-', 'agent-../../x', '']) {
            expect(await daemon.chats.findAttachment('chat-lead', bad)).toBeNull();
        }
    });

    test('keeps the name the agent gave, however odd, and cuts one too long to be a file name', async () => {
        const daemon = await bootWithChat();
        const names = ['Home screen (dark).png', 'a/b\\c ~ d?.png', 'häuser-🏠.png', 'x'.repeat(190), 'tab\tand\nnewline.png'];
        for (const name of names) {
            const [, id, kept] = (await attach(daemon, 'chat-lead', PNG, name))[0]!.split('\t');
            const found = await daemon.chats.findAttachment('chat-lead', id!);
            expect(found!.name).toBe(kept!);
            expect(found!.name).toBe(name.length > 150 ? name.slice(0, found!.name.length) : name.replaceAll(/[\t\n]/g, ''));
            expect(Buffer.byteLength(basename(found!.path))).toBeLessThan(255);
        }
    });

    test('a fork gets the same images under the same ids, and the original keeps its own', async () => {
        const daemon = await bootWithChat();
        const [, id] = (await attach(daemon, 'chat-lead', PNG))[0]!.split('\t');
        await daemon.chats.copyAgentImages('chat-lead', 'chat-fork');
        const copy = await daemon.chats.findAttachment('chat-fork', id!);
        expect(copy).toMatchObject({ id, name: 'shot.png', size: PNG.byteLength });
        expect(copy!.path).toStartWith(join(home, 'attachments', 'chat-fork', `${id}~`));
        expect(await daemon.chats.findAttachment('chat-lead', id!)).not.toBeNull();
        // A link in the folder is not an image of the chat: it is neither found nor copied.
        const outside = join(root, 'secret.png');
        await writeFile(outside, PNG);
        const linked = 'agent-00000000-0000-4000-8000-000000000000';
        await symlink(outside, join(home, 'attachments', 'chat-lead', `${linked}.png`));
        expect(await daemon.chats.findAttachment('chat-lead', linked)).toBeNull();
        await daemon.chats.copyAgentImages('chat-lead', 'chat-fork-2');
        expect(await readdir(join(home, 'attachments', 'chat-fork-2'))).toEqual([basename((await daemon.chats.findAttachment('chat-lead', id!))!.path)]);
        // Nothing to copy leaves no folder behind.
        await daemon.chats.copyAgentImages('chat-without-images', 'chat-empty');
        expect(await stat(join(home, 'attachments', 'chat-empty')).catch(() => null)).toBeNull();
    });
});

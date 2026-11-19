import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { ManualClock } from '@adecore/agents/testing';
import { leadAndShellProject } from '../chat/lead-chat-test-helpers.ts';
import type { ProjectStore } from '../projects/project-store.ts';
import { RUIMTE_SKILLS } from '../skills/catalog.ts';
import { MemorySkillDisk } from '../skills/skill-disk-test-helpers.ts';
import { bootTestDaemon, releasedProject, turnsOf, type TestDaemon } from '../testing/test-daemon.ts';

let root: string;
let home: string;
let folder: string;
let store: ProjectStore;
let running: TestDaemon[];

beforeEach(async () => {
    ({ root, home, folder, store } = await releasedProject('ruimte-skills-', leadAndShellProject()));
    running = [];
});

afterEach(async () => {
    for (const daemon of running) {
        await daemon.stop();
    }
    store.closeAll();
    await rm(root, { recursive: true, force: true });
});

const [DESIGN] = RUIMTE_SKILLS;

async function bootWithChat(disk = new MemorySkillDisk()): Promise<TestDaemon> {
    const daemon = await bootTestDaemon({ home, store, clock: new ManualClock(), skillDisk: disk });
    running.push(daemon);
    await daemon.chats.create({ chatId: 'chat-lead', provider: 'claude', cwd: folder });

    return daemon;
}

/* Sends as a person's client does and answers what the CLI heard, which the fake echoes back. */
async function heard(daemon: TestDaemon, text: string): Promise<string> {
    const before = turnsOf(daemon, 'chat-lead').length;
    const answer = await daemon.request('chat.send', { chatId: 'chat-lead', text, skills: ['ruimte-design', 'report'] });
    expect(answer).toMatchObject({ ok: true });
    await daemon.until(() => turnsOf(daemon, 'chat-lead').length === before + 1 && daemon.chats.get('chat-lead')?.info.activeTurnId === null);
    const items = daemon.chats.get('chat-lead')!.thread.list();
    const reply = items.findLast((item) => item.kind === 'assistant');

    return reply?.kind === 'assistant' ? reply.text : '';
}

describe('the skills Ruimte ships', () => {
    test('are listed by name, title and description', async () => {
        const daemon = await bootWithChat();

        expect(await daemon.request('skill.list', {})).toMatchObject({
            ok: true,
            result: { skills: [{ name: 'ruimte-design', title: 'design', description: DESIGN!.description }] }
        });
    });

    test('a prompt that names one hears a note in front, once, with where it lies and what the chat runs on', async () => {
        const daemon = await bootWithChat();
        const { selection } = daemon.chats.get('chat-lead')!.info;
        const text = 'Make me a $ruimte-design of the settings, and then $ruimte-design again';

        const echo = await heard(daemon, text);

        expect(echo).toStartWith(`echo: Ruimte skill ruimte-design: ${DESIGN!.description}`);
        expect(echo.split('Ruimte skill ruimte-design').length).toBe(2);
        expect(echo).toContain(`Read its instructions in ${join(home, 'skills', 'ruimte-design', 'SKILL.md')} and follow them.`);
        expect(echo).toContain(`This chat runs on cli claude, model ${selection.model} and `);
        expect(echo).toEndWith(`\n\n${text}`);
        const items = daemon.chats.get('chat-lead')!.thread.list();
        expect(items.findLast((item) => item.kind === 'user')).toMatchObject({ text, skills: ['report'] });
        expect(items.filter((item) => item.kind === 'note')).toEqual([]);
        // Claude Code reads outside the chat's folder only what it was handed.
        expect(daemon.claude.started.at(-1)!.argv).toContain(`--add-dir=${join(home, 'skills')}`);
    });

    test('a prompt that names no skill Ruimte ships hears nothing more', async () => {
        const daemon = await bootWithChat();

        expect(await heard(daemon, 'use $ruimte-sketch and $ruimte-designer here')).toBe('echo: use $ruimte-sketch and $ruimte-designer here');
    });

    test('a machine that cannot write them still starts, and the note carries the instructions', async () => {
        const disk = new MemorySkillDisk();
        disk.failing.add('replaceFolder');
        disk.failing.add('writeText');
        const daemon = await bootWithChat(disk);

        const echo = await heard(daemon, '$ruimte-design the login');

        expect(echo).toContain(`Follow its instructions:\n${DESIGN!.files['SKILL.md']}`);
        expect(echo).not.toContain('Read its instructions in');
    });
});

import { afterEach, describe, expect, test } from 'bun:test';
import { ActionRegistry } from '@ruimte/actions';
import type { ProjectClosingResult, ProjectSummary } from '@ruimte/contracts';
import { useDocument } from '@/state/document';
import { TransportError } from '@/transport-api/transport';
import { questionOf } from './action-support';
import { PERSON_ACTION_CALL, VOICE_ACTION_CALL } from './client-actions';
import { projectActions, type ListedProject, type ProjectMachine } from './project-actions';

function summary(projectId: string, name: string, closedAt: number | null = null): ProjectSummary {
    return {
        projectId,
        name,
        color: '#000',
        folder: `/work/${projectId}`,
        lastOpenedAt: 1,
        closedAt,
        available: true,
        icon: { kind: 'initial', value: name[0]! },
        nameSource: 'chosen'
    };
}

function listed(projectId: string, name: string, extra: Partial<ListedProject> = {}): ListedProject {
    const row = summary(projectId, name, extra.recent === true ? 5 : null);
    return {
        endpointId: 'mac',
        projectId,
        name,
        machine: 'Mac',
        folder: row.folder,
        recent: false,
        active: false,
        available: true,
        summary: row,
        ...extra
    };
}

interface Calls {
    opened: string[];
    closed: string[];
    removed: string[];
    renamed: string[];
    icons: string[];
    colors: string[];
}

function fake(projects: ListedProject[], overrides: Partial<ProjectMachine> = {}) {
    const calls: Calls = { opened: [], closed: [], removed: [], renamed: [], icons: [], colors: [] };
    const machine: Partial<ProjectMachine> = {
        projects: () => projects,
        switching: async () => false,
        open: async (endpointId, projectId) => {
            calls.opened.push(`${endpointId}:${projectId}`);
            return 'done';
        },
        closing: async () => ({ sessions: 2, otherClients: 0 }),
        close: async (_endpointId, row) => {
            calls.closed.push(row.projectId);
        },
        remove: async (_endpointId, projectId) => {
            calls.removed.push(projectId);
        },
        rename: async (project, name) => {
            calls.renamed.push(`${project.projectId}:${name}`);
        },
        setColor: async (project, color) => {
            calls.colors.push(`${project.projectId}:${color}`);
        },
        chooseIcon: async (project, icon) => {
            calls.icons.push(`${project.projectId}:${icon?.value ?? 'none'}`);
        },
        useFolderIcon: async (project) => {
            calls.icons.push(`${project.projectId}:folder`);
        },
        ...overrides
    };
    return { registry: new ActionRegistry<void>(projectActions(useDocument, machine)), calls };
}

afterEach(() => {
    useDocument.getState().load(null, null);
});

describe('project actions', () => {
    test('moving a chat asks the machine once, answers with the project and refuses a voice', async () => {
        const moved: unknown[] = [];
        const { registry } = fake([], {
            moveChat: async (endpointId, payload) => {
                moved.push([endpointId, payload]);
                return { summary: summary('vinyl', 'Vinyl'), viewId: payload.chatId, ownFilesLeftAt: null };
            }
        });
        const input = { endpointId: 'mac', chatId: 'chat-1', to: { projectId: 'vinyl' }, ownFiles: 'leave' } as const;
        expect(await registry.execute('chat.move', input, PERSON_ACTION_CALL)).toMatchObject({
            status: 'completed',
            output: { project: 'Vinyl', projectId: 'vinyl', viewId: 'chat-1' }
        });
        expect(moved).toEqual([['mac', { chatId: 'chat-1', to: { projectId: 'vinyl' }, ownFiles: 'leave' }]]);
        expect(await registry.execute('chat.move', input, VOICE_ACTION_CALL)).toMatchObject({ status: 'failed' });
        expect(moved).toHaveLength(1);
    });

    test('a refusal of the machine reaches the person with its code', async () => {
        const { registry } = fake([], {
            moveChat: async () => {
                throw new TransportError('move-refused', 'This chat is still working');
            }
        });
        expect(
            await registry.execute('chat.move', { endpointId: 'mac', chatId: 'chat-1', to: { projectId: 'vinyl' }, ownFiles: 'leave' }, PERSON_ACTION_CALL)
        ).toMatchObject({ error: { code: 'move-refused', message: 'This chat is still working' } });
    });

    test('lists projects in use and under Recent, and opening one under Recent brings it back', async () => {
        const { registry, calls } = fake([listed('atlas', 'Atlas', { active: true }), listed('old', 'Old', { recent: true })]);
        const list = await registry.execute('project.list', {}, VOICE_ACTION_CALL);
        expect(list).toMatchObject({
            output: {
                projects: [
                    { projectId: 'atlas', recent: false, active: true },
                    { projectId: 'old', recent: true }
                ]
            }
        });
        expect(JSON.stringify(list)).not.toContain('summary');
        expect(await registry.execute('project.switch', { endpointId: 'mac', projectId: 'old' }, VOICE_ACTION_CALL)).toMatchObject({
            status: 'completed',
            output: { project: 'Old' }
        });
        expect(calls.opened).toEqual(['mac:old']);
    });

    test.each(['failed', 'cancelled', 'replaced'] as const)('a %s switch is not reported as success', async (outcome) => {
        const { registry } = fake([listed('atlas', 'Atlas')], { open: async () => outcome });
        expect(await registry.execute('project.switch', { endpointId: 'mac', projectId: 'atlas' }, VOICE_ACTION_CALL)).toMatchObject({
            error: { code: 'project-switch-failed' }
        });
    });

    test('a folder that is gone, a project nobody lists and a switch in progress are refused before anything opens', async () => {
        const { registry, calls } = fake([listed('gone', 'Gone', { available: false })]);
        expect(await registry.execute('project.switch', { endpointId: 'mac', projectId: 'gone' }, VOICE_ACTION_CALL)).toMatchObject({
            error: { code: 'project-unavailable' }
        });
        expect(await registry.execute('project.switch', { endpointId: 'mac', projectId: 'nope' }, VOICE_ACTION_CALL)).toMatchObject({
            error: { code: 'unknown-project' }
        });
        const busy = fake([listed('atlas', 'Atlas')], { switching: async () => true });
        expect(await busy.registry.execute('project.switch', { endpointId: 'mac', projectId: 'atlas' }, VOICE_ACTION_CALL)).toMatchObject({
            error: { code: 'project-switching' }
        });
        expect(calls.opened).toEqual([]);
    });

    test.each([
        [{ sessions: 2, otherClients: 0 }, '2 running sessions end'],
        [{ sessions: 3, otherClients: 1 }, 'nothing stops running'],
        [null, 'cannot be reached']
    ] as [ProjectClosingResult | null, string][])('closing asks Voice first and says what keeps running', async (answer, words) => {
        const { registry, calls } = fake([listed('atlas', 'Atlas')], { closing: async () => answer });
        const asked = await registry.execute('project.close', { endpointId: 'mac', projectId: 'atlas' }, VOICE_ACTION_CALL);
        expect(questionOf(asked)).toContain(words);
        expect(calls.closed).toEqual([]);
        if (asked.status !== 'needs_confirmation') {
            return;
        }
        expect(await registry.confirm(asked.confirmationToken, true, VOICE_ACTION_CALL)).toMatchObject({
            status: 'completed',
            output: { project: 'Atlas', sessions: answer?.sessions ?? null, otherClients: answer?.otherClients ?? null }
        });
        expect(calls.closed).toEqual(['atlas']);
    });

    test('a person closes straight away, since the close dialog was the question, and a closed one is refused', async () => {
        const { registry, calls } = fake([listed('atlas', 'Atlas'), listed('old', 'Old', { recent: true })]);
        expect(await registry.execute('project.close', { endpointId: 'mac', projectId: 'atlas' }, PERSON_ACTION_CALL)).toMatchObject({ status: 'completed' });
        expect(await registry.execute('project.close', { endpointId: 'mac', projectId: 'old' }, PERSON_ACTION_CALL)).toMatchObject({
            error: { code: 'already-closed' }
        });
        expect(calls.closed).toEqual(['atlas']);
    });

    test('Voice renames and marks a project, and never uploads an image, creates or deletes one', async () => {
        const { registry, calls } = fake([listed('atlas', 'Atlas')]);
        expect(
            await registry.execute(
                'project.setAppearance',
                { endpointId: 'mac', projectId: 'atlas', name: 'Atlas 2', icon: 'rocket', color: null },
                VOICE_ACTION_CALL
            )
        ).toMatchObject({ status: 'completed' });
        expect(calls.renamed).toEqual(['atlas:Atlas 2']);
        expect(calls.icons).toEqual(['atlas:rocket']);
        expect(
            await registry.execute(
                'project.setAppearance',
                { endpointId: 'mac', projectId: 'atlas', name: null, icon: 'folder', color: null },
                VOICE_ACTION_CALL
            )
        ).toMatchObject({ output: { icon: 'folder' } });
        expect(
            await registry.execute(
                'project.setAppearance',
                { endpointId: 'mac', projectId: 'atlas', name: null, icon: 'no-such-icon', color: null },
                VOICE_ACTION_CALL
            )
        ).toMatchObject({ error: { code: 'unknown-icon' } });
        expect(
            await registry.execute(
                'project.setAppearance',
                { endpointId: 'mac', projectId: 'atlas', name: null, icon: null, image: { mime: 'image/png', base64: 'AA==' }, color: null },
                VOICE_ACTION_CALL
            )
        ).toMatchObject({ error: { code: 'forbidden-field' } });
        expect(await registry.execute('project.create', { endpointId: 'mac', folder: '/work/new', createFolder: true }, VOICE_ACTION_CALL)).toMatchObject({
            error: { code: 'forbidden-action' }
        });
        expect(await registry.execute('project.delete', { endpointId: 'mac', projectId: 'atlas', removeFiles: null }, VOICE_ACTION_CALL)).toMatchObject({
            error: { code: 'forbidden-action' }
        });
    });

    test('a color goes to the project, and the color it has already changes nothing', async () => {
        const { registry, calls } = fake([listed('atlas', 'Atlas')]);
        expect(
            await registry.execute(
                'project.setAppearance',
                { endpointId: 'mac', projectId: 'atlas', name: null, icon: null, color: '#e7000b' },
                VOICE_ACTION_CALL
            )
        ).toMatchObject({ status: 'completed' });
        expect(calls.colors).toEqual(['atlas:#e7000b']);
        expect(
            await registry.execute('project.setAppearance', { endpointId: 'mac', projectId: 'atlas', name: null, icon: null, color: null }, VOICE_ACTION_CALL)
        ).toMatchObject({ error: { code: 'nothing-to-change' } });
    });

    test('none clears a picked icon, so the project wears its default again', async () => {
        const { registry, calls } = fake([listed('atlas', 'Atlas')]);
        expect(
            await registry.execute('project.setAppearance', { endpointId: 'mac', projectId: 'atlas', name: null, icon: 'none', color: null }, VOICE_ACTION_CALL)
        ).toMatchObject({ status: 'completed' });
        expect(calls.icons).toEqual(['atlas:none']);
    });

    test('deleting asks even a person, names the folder, and only removes after yes', async () => {
        const { registry, calls } = fake([listed('atlas', 'Atlas')]);
        const asked = await registry.execute('project.delete', { endpointId: 'mac', projectId: 'atlas', removeFiles: true }, PERSON_ACTION_CALL);
        expect(questionOf(asked)).toContain('Its canvas file in /work/atlas is removed too');
        expect(calls.removed).toEqual([]);
        if (asked.status === 'needs_confirmation') {
            await registry.confirm(asked.confirmationToken, true, PERSON_ACTION_CALL);
        }
        expect(calls.removed).toEqual(['atlas']);
    });
});

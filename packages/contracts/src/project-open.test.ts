import { expect, test } from 'bun:test';
import { ProjectOpenPayloadSchema, ProjectSummarySchema } from './project.ts';

test('a project is opened by id or folder', () => {
    for (const payload of [{}, { name: 'Loose' }, { folder: '' }]) {
        expect(ProjectOpenPayloadSchema.safeParse(payload).success).toBe(false);
    }
    expect(ProjectOpenPayloadSchema.safeParse({ projectId: 'existing' }).success).toBe(true);
    expect(ProjectOpenPayloadSchema.safeParse({ folder: '/repo', createFolder: true }).success).toBe(true);
});

test('a project summary requires a folder', () => {
    const summary = {
        projectId: 'p',
        name: 'Repo',
        color: '#000000',
        lastOpenedAt: 0,
        available: true,
        icon: { kind: 'initial', value: 'R' },
        nameSource: 'folder'
    };
    expect(ProjectSummarySchema.safeParse({ ...summary, folder: '/repo' }).success).toBe(true);
    expect(ProjectSummarySchema.safeParse({ ...summary, folder: null }).success).toBe(false);
});

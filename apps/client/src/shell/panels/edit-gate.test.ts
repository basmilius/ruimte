import { describe, expect, test } from 'bun:test';
import { editBlockOf, type EditGateInput } from '@/shell/panels/edit-gate';

const gate = (patch: Partial<EditGateInput>): EditGateInput => ({
    path: '/repo/src/a.ts',
    roots: ['/repo', '/home/me/.ruimte/worktrees/repo-feature'],
    plain: false,
    coarse: false,
    zoomedOut: false,
    ...patch
});

describe('editBlockOf', () => {
    test('offers a file in the project folder or one of its worktrees', () => {
        expect(editBlockOf(gate({}))).toBeNull();
        expect(editBlockOf(gate({ path: '/home/me/.ruimte/worktrees/repo-feature/src/a.ts' }))).toBeNull();
    });

    test('refuses a file outside, including a folder that only starts with the same name', () => {
        expect(editBlockOf(gate({ path: '/elsewhere/a.ts' }))).toBe('outside-project');
        expect(editBlockOf(gate({ path: '/repository/a.ts' }))).toBe('outside-project');
        expect(editBlockOf(gate({ roots: [] }))).toBe('outside-project');
    });

    test('refuses the state Ruimte keeps in a project, in a worktree too', () => {
        expect(editBlockOf(gate({ path: '/repo/.ruimte/project.json' }))).toBe('ruimte-state');
        expect(editBlockOf(gate({ path: '/home/me/.ruimte/worktrees/repo-feature/.ruimte/private/project.json' }))).toBe('ruimte-state');
        expect(editBlockOf(gate({ path: '/repo/.ruimteish/a.ts' }))).toBeNull();
    });

    test('refuses a file drawn as plain text, a finger and a node zoomed out', () => {
        expect(editBlockOf(gate({ plain: true }))).toBe('plain');
        expect(editBlockOf(gate({ coarse: true }))).toBe('touch');
        expect(editBlockOf(gate({ zoomedOut: true }))).toBe('zoom');
    });
});

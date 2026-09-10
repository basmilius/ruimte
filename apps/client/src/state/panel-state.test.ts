import { describe, expect, test } from 'bun:test';
import { ProjectLocalSchema } from '@ruimte/contracts';
import { parsePanels, serializePanels, type PanelsState } from './panel-state.ts';

const defaults: PanelsState = {
    panel: { open: false, kind: 'files' },
    preview: { open: false },
    panelWidth: null,
    previewWidth: null,
    tabs: [],
    active: null,
    expandedDirs: [],
    gitScope: 'worktree',
    gitCollapsedDirs: [],
    gitLogHeight: 200
};

const full: PanelsState = {
    panel: { open: true, kind: 'git' },
    preview: { open: true },
    panelWidth: 480,
    previewWidth: 640,
    tabs: [
        { key: '/repo/readme.md', path: '/repo/readme.md', pinned: true, dirty: false },
        { key: '/repo/src/main.ts', path: '/repo/src/main.ts', pinned: false, dirty: false },
        {
            key: 'diff:/repo/src/main.ts',
            path: '/repo/src/main.ts',
            view: { kind: 'diff', cwd: '/repo', scope: 'base', staged: false },
            pinned: false,
            dirty: false
        }
    ],
    active: 'diff:/repo/src/main.ts',
    expandedDirs: ['src/', 'src/state/'],
    gitScope: 'base',
    gitCollapsedDirs: ['src', 'src/state'],
    gitLogHeight: 260
};

describe('panels in the machine-local file', () => {
    test('everything the panels remember survives the round trip', () => {
        expect(parsePanels(serializePanels(full), defaults)).toEqual(full);
    });

    test('what the file leaves out falls back to the defaults', () => {
        const other: PanelsState = { ...defaults, panel: { open: true, kind: 'git' }, panelWidth: 300 };
        expect(parsePanels(undefined, other)).toEqual(other);
        expect(parsePanels({ panel: { open: false, kind: 'files' } }, other)).toEqual({ ...other, panel: { open: false, kind: 'files' } });
    });

    test('a width nobody dragged stays out of the file, and one that makes no sense is ignored', () => {
        expect(serializePanels(defaults)).not.toHaveProperty('panelWidth');
        expect(parsePanels({ panelWidth: 0, previewWidth: -20 }, defaults)).toMatchObject({ panelWidth: null, previewWidth: null });
    });

    test('a preview without a file to show stays closed', () => {
        expect(parsePanels({ preview: { open: true } }, defaults).preview).toEqual({ open: false });
        expect(parsePanels({ preview: { open: true }, tabs: [{ path: 'a', pinned: false }] }, defaults).preview).toEqual({ open: true });
    });

    test('an active tab that is not open is not what the viewer points at', () => {
        expect(parsePanels({ tabs: [{ path: 'a', pinned: false }], activeTab: 'b' }, defaults).active).toBe('a');
        expect(parsePanels({ tabs: [], activeTab: 'b' }, defaults).active).toBeNull();
    });

    test('a file and its diff are two tabs of one path, and a file without a scope opens on the default', () => {
        const parsed = parsePanels(
            {
                tabs: [
                    { path: 'a', pinned: false },
                    { path: 'a', pinned: false, view: { kind: 'diff', cwd: '/repo', scope: 'base', staged: true } }
                ]
            },
            defaults
        );
        expect(parsed.tabs.map((tab) => tab.key)).toEqual(['a', 'diff:a']);
        expect(parsed.gitScope).toBe('worktree');
    });

    test('the daemon takes what is serialized, and a file from before the panels still parses', () => {
        const local = { camera: null, focusedNodeId: null, panels: serializePanels(full) };
        expect(ProjectLocalSchema.parse(local)).toEqual(local);
        expect(ProjectLocalSchema.parse({ camera: null, focusedNodeId: 'n1' }).panels).toBeUndefined();
    });
});

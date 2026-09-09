import { toWorld } from '@/canvas/math';
import { useCanvas, type NodeKind } from '@/state/canvas';
import { useProject } from '@/state/project';
import { fileManagerName, useServer } from '@/state/server';
import { useTheme } from '@/state/theme';
import { useUi } from '@/state/ui';
import { transport } from '@/transport';

export interface Command {
    id: string;
    label: string;
    hint?: string;
    /* Shown next to the label; the chord itself lives in the keyboard handler. */
    shortcut?: string;
    run(): void;
}

const centerWorld = () => {
    const s = useCanvas.getState();
    return toWorld(s.camera, { x: s.viewport.w / 2, y: s.viewport.h / 2 });
};

export const addNodeAtCenter = (kind: NodeKind, options?: { title?: string; command?: string }): string =>
    useCanvas.getState().addNode(kind, centerWorld(), options);

/* Everything the palette can do besides jumping to a node. One list, so the dock and the keys agree. */
export const appCommands = (): Command[] => {
    const canvas = useCanvas.getState();
    const anyLocked = Object.values(canvas.locks).some(Boolean);
    const folder = useProject.getState().current?.folder ?? null;
    return [
        { id: 'open-folder', label: 'Open a folder as a project', hint: 'Type a path', run: () => useUi.getState().openPalette('~/') },
        ...(folder
            ? [
                  {
                      id: 'reveal',
                      label: `Open project in ${fileManagerName(useServer.getState().platform)}`,
                      run: () => void transport.request('fs.reveal', { path: folder }).catch(() => undefined)
                  }
              ]
            : []),
        { id: 'add-terminal', label: 'New terminal', shortcut: '⌥T', run: () => void addNodeAtCenter('terminal') },
        { id: 'add-chat', label: 'New chat', shortcut: '⌥C', run: () => void addNodeAtCenter('chat') },
        { id: 'add-browser', label: 'New browser', shortcut: '⌥B', run: () => void addNodeAtCenter('browser') },
        { id: 'add-group', label: 'New group', shortcut: '⌥G', run: () => void addNodeAtCenter('group') },
        {
            id: 'group-selection',
            label: 'Group selection',
            hint: canvas.selection.length === 0 ? 'Select nodes first' : undefined,
            shortcut: '⌘G',
            run: () => void useCanvas.getState().groupSelection()
        },
        { id: 'add-text', label: 'New text', run: () => void useCanvas.getState().addText(centerWorld()) },
        { id: 'layout-save', label: 'Save layout as', hint: 'Remember where everything sits', run: () => useUi.getState().setLayoutDialogOpen(true) },
        ...canvas.layouts.flatMap((layout) => [
            { id: `layout-apply-${layout.name}`, label: `Apply layout: ${layout.name}`, run: () => useCanvas.getState().applyLayout(layout.name) },
            { id: `layout-delete-${layout.name}`, label: `Delete layout: ${layout.name}`, run: () => useCanvas.getState().deleteLayout(layout.name) }
        ]),
        { id: 'fit', label: 'Zoom to fit', shortcut: '⇧1', run: () => useCanvas.getState().fitAll() },
        { id: 'zoom-selection', label: 'Zoom to selection', shortcut: '⇧2', run: () => useCanvas.getState().zoomToSelection() },
        { id: 'zoom-reset', label: 'Zoom to 100%', shortcut: '⌘0', run: () => useCanvas.getState().zoomTo(1) },
        { id: 'lock', label: anyLocked ? 'Unlock everything' : 'Lock everything', run: () => useCanvas.getState().setAllLocks(!anyLocked) },
        { id: 'theme', label: 'Toggle light and dark', run: () => useTheme.getState().toggle() },
        { id: 'settings', label: 'Settings', shortcut: '⌘,', run: () => useUi.getState().setSettingsOpen(true) }
    ];
};

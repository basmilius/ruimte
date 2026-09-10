import { useState } from 'react';
import clsx from 'clsx';
import { Dialog } from '@base-ui-components/react/dialog';
import { Menu } from '@base-ui-components/react/menu';
import { Check, ChevronDown, ExternalLink, FolderOpen, Image, Pencil, Plus, Trash, X } from 'lucide-react';
import { projectClient } from '@/project';
import { ProjectGlyph } from '@/project/ProjectGlyph';
import { ProjectIconDialog } from '@/shell/ProjectIconDialog';
import { useProject } from '@/state/project';
import { fileManagerName, useServer } from '@/state/server';
import { useUi } from '@/state/ui';
import { transport } from '@/transport';
import { desktop } from '@/desktop/bridge';
import { Button } from '@/ui/Button';
import { MENU_HINT, MENU_LABEL, MENU_SEPARATOR } from '@/ui/classes';
import { Icon } from '@/ui/Icon';

type DialogKind = { kind: 'new' } | { kind: 'rename' } | { kind: 'delete'; projectId: string; name: string; folder: string | null } | null;

/* The project segment of the toolbar's breadcrumb: every known canvas, plus the ways to make, open, close and delete one. */
export function ProjectMenu() {
    const projects = useProject((s) => s.projects);
    const current = useProject((s) => s.current);
    const platform = useServer((s) => s.platform);
    const [dialog, setDialog] = useState<DialogKind>(null);
    const [value, setValue] = useState('');
    const [busy, setBusy] = useState(false);
    const [failure, setFailure] = useState<string | null>(null);
    const [iconOpen, setIconOpen] = useState(false);

    const openDialog = (next: DialogKind, initial = ''): void => {
        setValue(initial);
        setFailure(null);
        setDialog(next);
    };

    const run = async (work: () => Promise<void>): Promise<void> => {
        setBusy(true);
        setFailure(null);
        try {
            await work();
            setDialog(null);
        } catch (e) {
            setFailure(e instanceof Error ? e.message : 'That did not work');
        } finally {
            setBusy(false);
        }
    };

    // The desktop app has a real dialog; a browser tab types the path in the palette instead.
    const openFolder = async (): Promise<void> => {
        const bridge = desktop();
        if (!bridge) {
            useUi.getState().openPalette('~/');
            return;
        }
        const folder = await bridge.pickFolder(current?.folder ?? undefined);
        if (folder) {
            await projectClient.openFolder(folder).catch(() => undefined);
        }
    };

    const submit = (): void => {
        if (!dialog) {
            return;
        }
        if (dialog.kind === 'new') {
            void run(() => projectClient.createProject(value.trim() || 'Untitled canvas'));
        }
        if (dialog.kind === 'rename' && value.trim() !== '') {
            void run(() => projectClient.rename(value.trim()));
        }
    };

    return (
        <>
            <Menu.Root>
                <Menu.Trigger className="flex h-8 min-w-0 items-center gap-2 rounded-md px-2 text-left hover:bg-surface-sunken data-[popup-open]:bg-surface-sunken">
                    {current ? (
                        <ProjectGlyph projectId={current.projectId} icon={current.icon} color={current.color} />
                    ) : (
                        <span className="h-3 w-3 shrink-0 rounded-sm bg-text-faint" />
                    )}
                    <span className="truncate text-sm font-medium text-text">{current?.name ?? 'No project'}</span>
                    <Icon icon={ChevronDown} size={14} className="shrink-0 text-text-muted" />
                </Menu.Trigger>
                <Menu.Portal>
                    <Menu.Positioner className="z-[var(--z-popup)]" side="bottom" sideOffset={6} align="start">
                        <Menu.Popup className="menu-popup min-w-60">
                            {projects.length > 0 && <div className={MENU_LABEL}>Projects</div>}
                            {projects.map((project) => (
                                <Menu.Item
                                    key={project.projectId}
                                    className={clsx('menu-item items-start', !project.available && 'opacity-50')}
                                    disabled={!project.available}
                                    onClick={() => void projectClient.openProject(project.projectId).catch(() => undefined)}
                                >
                                    {/* The folder under the name makes this row two lines high, so the 20 pixel boxes
                                        hold the glyph and the check on the name's line instead of between both lines. */}
                                    <span className="flex h-5 shrink-0 items-center">
                                        <ProjectGlyph projectId={project.projectId} icon={project.icon} color={project.color} />
                                    </span>
                                    <span className="flex min-w-0 flex-col">
                                        <span className="truncate">{project.name}</span>
                                        <span className="truncate text-xs text-text-faint">{project.folder ?? 'Not in a folder'}</span>
                                    </span>
                                    {project.projectId === current?.projectId && (
                                        <span className="ml-auto flex h-5 shrink-0 items-center">
                                            <Icon icon={Check} size={14} />
                                        </span>
                                    )}
                                </Menu.Item>
                            ))}
                            {projects.length > 0 && <Menu.Separator className={MENU_SEPARATOR} />}
                            <Menu.Item className="menu-item" onClick={() => openDialog({ kind: 'new' })}>
                                <Icon icon={Plus} size={14} /> New canvas
                            </Menu.Item>
                            <Menu.Item className="menu-item" onClick={() => void openFolder()}>
                                <Icon icon={FolderOpen} size={14} /> Open folder
                            </Menu.Item>
                            {current && (
                                <>
                                    <Menu.Separator className={MENU_SEPARATOR} />
                                    {current.folder && (
                                        <Menu.Item
                                            className="menu-item"
                                            onClick={() => void transport.request('fs.reveal', { path: current.folder! }).catch(() => undefined)}
                                        >
                                            <Icon icon={ExternalLink} size={14} /> Open in {fileManagerName(platform)}
                                        </Menu.Item>
                                    )}
                                    <Menu.Item className="menu-item" onClick={() => openDialog({ kind: 'rename' }, current.name)}>
                                        <Icon icon={Pencil} size={14} /> Rename project
                                    </Menu.Item>
                                    <Menu.Item className="menu-item" onClick={() => setIconOpen(true)}>
                                        <Icon icon={Image} size={14} /> Set icon
                                        {current.nameSource !== 'chosen' && <span className={MENU_HINT}>Name from the folder</span>}
                                    </Menu.Item>
                                    <Menu.Item className="menu-item" onClick={() => void projectClient.closeProject()}>
                                        <Icon icon={X} size={14} /> Close project
                                        <span className={MENU_HINT}>Sessions keep running</span>
                                    </Menu.Item>
                                    <Menu.Item
                                        className="menu-item text-status-error"
                                        onClick={() => openDialog({ kind: 'delete', projectId: current.projectId, name: current.name, folder: current.folder })}
                                    >
                                        <Icon icon={Trash} size={14} /> Delete project
                                    </Menu.Item>
                                </>
                            )}
                        </Menu.Popup>
                    </Menu.Positioner>
                </Menu.Portal>
            </Menu.Root>

            <Dialog.Root open={dialog !== null} onOpenChange={(open) => !open && setDialog(null)}>
                <Dialog.Portal>
                    <Dialog.Backdrop className="dialog-backdrop" />
                    <Dialog.Popup className="dialog-popup top-[24vh] w-[420px] p-5">
                        {dialog?.kind === 'new' && (
                            <>
                                <Dialog.Title className="text-base font-semibold text-text">New canvas</Dialog.Title>
                                <p className="mt-1 text-xs text-text-muted">
                                    Stored with the app, not in a folder. Open a folder instead to share it through git.
                                </p>
                                <input
                                    autoFocus
                                    className="field mt-3"
                                    aria-label="Canvas name"
                                    placeholder="Name"
                                    value={value}
                                    onChange={(e) => setValue(e.target.value)}
                                    onKeyDown={(e) => {
                                        e.stopPropagation();
                                        if (e.key === 'Enter') {
                                            submit();
                                        }
                                    }}
                                />
                            </>
                        )}
                        {dialog?.kind === 'rename' && (
                            <>
                                <Dialog.Title className="text-base font-semibold text-text">Rename project</Dialog.Title>
                                <p className="mt-1 text-xs text-text-muted">The name goes into the canvas file, so everyone with the folder sees it.</p>
                                <input
                                    autoFocus
                                    className="field mt-3"
                                    aria-label="Project name"
                                    placeholder="Name"
                                    value={value}
                                    onChange={(e) => setValue(e.target.value)}
                                    onKeyDown={(e) => {
                                        e.stopPropagation();
                                        if (e.key === 'Enter') {
                                            submit();
                                        }
                                    }}
                                />
                            </>
                        )}
                        {dialog?.kind === 'delete' && (
                            <>
                                <Dialog.Title className="text-base font-semibold text-text">Delete {dialog.name}?</Dialog.Title>
                                <p className="mt-1 text-xs text-text-muted">
                                    {dialog.folder
                                        ? 'Forgets the project here. Its canvas file in the folder is removed too; nothing else in the folder is touched.'
                                        : 'The canvas and its file are removed. Running sessions keep running until their nodes are closed.'}
                                </p>
                            </>
                        )}
                        {failure && <p className="mt-2 text-xs text-status-error">{failure}</p>}
                        <div className="mt-4 flex items-center justify-end gap-2">
                            <Button onClick={() => setDialog(null)}>Cancel</Button>
                            {dialog?.kind === 'delete' ? (
                                <Button variant="danger" disabled={busy} onClick={() => void run(() => projectClient.deleteProject(dialog.projectId, true))}>
                                    <Icon icon={Trash} size={12} /> Delete
                                </Button>
                            ) : (
                                <Button variant="primary" disabled={busy} onClick={submit}>
                                    {dialog?.kind === 'rename' ? 'Rename' : 'Create'}
                                </Button>
                            )}
                        </div>
                    </Dialog.Popup>
                </Dialog.Portal>
            </Dialog.Root>

            {current && <ProjectIconDialog project={current} open={iconOpen} onOpenChange={setIconOpen} />}
        </>
    );
}

import { useState } from 'react';
import clsx from 'clsx';
import { Dialog } from '@base-ui-components/react/dialog';
import { Menu } from '@base-ui-components/react/menu';
import { CheckIcon, ChevronDownIcon, ExternalLinkIcon, FolderOpenIcon, PlusIcon, TrashIcon, XIcon } from '@hugeicons/core-free-icons';
import { projectClient } from '@/project';
import { useProject } from '@/state/project';
import { fileManagerName, useServer } from '@/state/server';
import { useUi } from '@/state/ui';
import { transport } from '@/transport';
import { desktop } from '@/desktop/bridge';
import { Icon } from '@/ui/Icon';

type DialogKind = { kind: 'new' } | { kind: 'delete'; projectId: string; name: string; folder: string | null } | null;

const fieldClass =
    'h-9 w-full rounded-lg border border-border bg-surface px-2.5 text-[13px] text-text outline-none placeholder:text-text-faint focus:border-accent';
const buttonClass = 'inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-[12px] font-medium';

/* The project segment of the toolbar's breadcrumb: every known canvas, plus the ways to make, open, close and delete one. */
export function ProjectMenu() {
    const projects = useProject((s) => s.projects);
    const current = useProject((s) => s.current);
    const platform = useServer((s) => s.platform);
    const [dialog, setDialog] = useState<DialogKind>(null);
    const [value, setValue] = useState('');
    const [busy, setBusy] = useState(false);
    const [failure, setFailure] = useState<string | null>(null);

    const openDialog = (next: DialogKind): void => {
        setValue('');
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
    };

    return (
        <>
            <Menu.Root>
                <Menu.Trigger className="flex h-8 min-w-0 items-center gap-2 rounded-md px-2 text-left hover:bg-surface-sunken data-[popup-open]:bg-surface-sunken">
                    <span className="h-3 w-3 shrink-0 rounded-sm" style={{ background: current?.color ?? 'var(--text-faint)' }} />
                    <span className="truncate text-[13px] font-medium text-text">{current?.name ?? 'No project'}</span>
                    <Icon icon={ChevronDownIcon} size={14} className="shrink-0 text-text-muted" />
                </Menu.Trigger>
                <Menu.Portal>
                    <Menu.Positioner className="z-50" side="bottom" sideOffset={6} align="start">
                        <Menu.Popup className="menu-popup min-w-60">
                            {projects.length > 0 && <div className="menu-label">Projects</div>}
                            {projects.map((project) => (
                                <Menu.Item
                                    key={project.projectId}
                                    className={clsx('menu-item', !project.available && 'opacity-50')}
                                    disabled={!project.available}
                                    onClick={() => void projectClient.openProject(project.projectId).catch(() => undefined)}
                                >
                                    <span className="h-3 w-3 shrink-0 rounded-sm" style={{ background: project.color }} />
                                    <span className="flex min-w-0 flex-col">
                                        <span className="truncate">{project.name}</span>
                                        <span className="truncate text-[11px] text-text-faint">{project.folder ?? 'Not in a folder'}</span>
                                    </span>
                                    {project.projectId === current?.projectId && <Icon icon={CheckIcon} size={13} className="ml-auto" />}
                                </Menu.Item>
                            ))}
                            {projects.length > 0 && <Menu.Separator className="menu-separator" />}
                            <Menu.Item className="menu-item" onClick={() => openDialog({ kind: 'new' })}>
                                <Icon icon={PlusIcon} size={14} /> New canvas
                            </Menu.Item>
                            <Menu.Item className="menu-item" onClick={() => void openFolder()}>
                                <Icon icon={FolderOpenIcon} size={14} /> Open folder
                            </Menu.Item>
                            {current && (
                                <>
                                    <Menu.Separator className="menu-separator" />
                                    {current.folder && (
                                        <Menu.Item
                                            className="menu-item"
                                            onClick={() => void transport.request('fs.reveal', { path: current.folder! }).catch(() => undefined)}
                                        >
                                            <Icon icon={ExternalLinkIcon} size={14} /> Open in {fileManagerName(platform)}
                                        </Menu.Item>
                                    )}
                                    <Menu.Item className="menu-item" onClick={() => void projectClient.closeProject()}>
                                        <Icon icon={XIcon} size={14} /> Close project
                                        <span className="ml-auto text-[11px] text-text-faint">Sessions keep running</span>
                                    </Menu.Item>
                                    <Menu.Item
                                        className="menu-item text-status-error"
                                        onClick={() => openDialog({ kind: 'delete', projectId: current.projectId, name: current.name, folder: current.folder })}
                                    >
                                        <Icon icon={TrashIcon} size={14} /> Delete project
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
                                <Dialog.Title className="text-[15px] font-semibold text-text">New canvas</Dialog.Title>
                                <p className="mt-1 text-[12px] text-text-muted">
                                    Stored with the app, not in a folder. Open a folder instead to share it through git.
                                </p>
                                <input
                                    autoFocus
                                    className={clsx(fieldClass, 'mt-3')}
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
                                <Dialog.Title className="text-[15px] font-semibold text-text">Delete {dialog.name}?</Dialog.Title>
                                <p className="mt-1 text-[12px] text-text-muted">
                                    {dialog.folder
                                        ? 'Forgets the project here. Its canvas file in the folder is removed too; nothing else in the folder is touched.'
                                        : 'The canvas and its file are removed. Running sessions keep running until their nodes are closed.'}
                                </p>
                            </>
                        )}
                        {failure && <p className="mt-2 text-[12px] text-status-error">{failure}</p>}
                        <div className="mt-4 flex items-center justify-end gap-2">
                            <button className={clsx(buttonClass, 'text-text-muted hover:bg-surface-sunken hover:text-text')} onClick={() => setDialog(null)}>
                                Cancel
                            </button>
                            {dialog?.kind === 'delete' ? (
                                <button
                                    className={clsx(buttonClass, 'bg-status-error text-accent-text disabled:opacity-50')}
                                    disabled={busy}
                                    onClick={() => void run(() => projectClient.deleteProject(dialog.projectId, true))}
                                >
                                    <Icon icon={TrashIcon} size={13} /> Delete
                                </button>
                            ) : (
                                <button className={clsx(buttonClass, 'bg-accent text-accent-text disabled:opacity-50')} disabled={busy} onClick={submit}>
                                    Create
                                </button>
                            )}
                        </div>
                    </Dialog.Popup>
                </Dialog.Portal>
            </Dialog.Root>
        </>
    );
}

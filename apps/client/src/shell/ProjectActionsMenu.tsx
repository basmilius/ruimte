import { useState } from 'react';
import { Dialog } from '@base-ui-components/react/dialog';
import { Menu } from '@base-ui-components/react/menu';
import { ExternalLink, Image, MoreHorizontal, Pencil, Trash, X } from 'lucide-react';
import { projectClient } from '@/project';
import { closeWarning, sessionNodesOf } from '@/project/project-sessions';
import { ProjectIconDialog } from '@/shell/ProjectIconDialog';
import { ProjectNameDialog } from '@/shell/ProjectNameDialog';
import { useDocument } from '@/state/document';
import { useEndpoints } from '@/state/endpoints';
import { useProject } from '@/state/project';
import { fileManagerName, useServer } from '@/state/server';
import { transportFor } from '@/transport';
import { Button } from '@/ui/Button';
import { MENU_HINT } from '@/ui/classes';
import { Icon } from '@/ui/Icon';
import { Tooltip } from '@/ui/Tooltip';

/*
 * Everything the open project can be asked, in one menu at the end of the toolbar. These used to
 * hang under the project switcher, which made that menu two things at once: the list of projects to
 * go to, and the options of the one you are already in. They sit next to Files and Git now, with
 * the other controls that act on the canvas in front of you.
 */
export function ProjectActionsMenu() {
    const current = useProject((s) => s.current);
    const currentEndpointId = useProject((s) => s.currentEndpointId);
    const activeId = useEndpoints((s) => s.activeId);
    const platform = useServer((s) => s.platform);
    const [renameOpen, setRenameOpen] = useState(false);
    const [iconOpen, setIconOpen] = useState(false);
    const [deleteOpen, setDeleteOpen] = useState(false);
    /* The sessions the confirmation counted, and null while it is shut: what stops is read the moment it is asked, not while the dialog stands. */
    const [closing, setClosing] = useState<number | null>(null);
    const [busy, setBusy] = useState(false);
    const [failure, setFailure] = useState<string | null>(null);

    if (!current) {
        return null;
    }

    const reveal = async (folder: string): Promise<void> => {
        // The folder is on the machine the project came from, which is not the active one mid-switch.
        await transportFor(currentEndpointId ?? activeId)
            ?.request('fs.reveal', { path: folder })
            .catch(() => undefined);
    };

    const close = async (): Promise<void> => {
        setClosing(null);
        await projectClient.closeProject();
    };

    const remove = async (): Promise<void> => {
        setBusy(true);
        setFailure(null);
        try {
            await projectClient.deleteProject(current.projectId, true);
            setDeleteOpen(false);
        } catch (e) {
            setFailure(e instanceof Error ? e.message : 'That did not work');
        } finally {
            setBusy(false);
        }
    };

    return (
        <>
            <Menu.Root>
                <Tooltip label="Project" name>
                    <Menu.Trigger className="icon-btn">
                        <Icon icon={MoreHorizontal} size={16} />
                    </Menu.Trigger>
                </Tooltip>
                <Menu.Portal>
                    <Menu.Positioner className="z-[var(--z-popup)]" side="bottom" align="end" sideOffset={6}>
                        <Menu.Popup className="menu-popup min-w-52">
                            {current.folder && (
                                <Menu.Item className="menu-item" onClick={() => void reveal(current.folder!)}>
                                    <Icon icon={ExternalLink} size={14} /> Open in {fileManagerName(platform)}
                                </Menu.Item>
                            )}
                            <Menu.Item className="menu-item" onClick={() => setRenameOpen(true)}>
                                <Icon icon={Pencil} size={14} /> Rename project
                            </Menu.Item>
                            <Menu.Item className="menu-item" onClick={() => setIconOpen(true)}>
                                <Icon icon={Image} size={14} /> Set icon
                                {current.nameSource !== 'chosen' && <span className={MENU_HINT}>Name from the folder</span>}
                            </Menu.Item>
                            <Menu.Item className="menu-item" onClick={() => setClosing(sessionNodesOf(useDocument.getState().exportViews()).length)}>
                                <Icon icon={X} size={14} /> Close project
                                <span className={MENU_HINT}>Stops its sessions</span>
                            </Menu.Item>
                            <Menu.Item className="menu-item text-status-error" onClick={() => setDeleteOpen(true)}>
                                <Icon icon={Trash} size={14} /> Delete project
                            </Menu.Item>
                        </Menu.Popup>
                    </Menu.Positioner>
                </Menu.Portal>
            </Menu.Root>

            <ProjectNameDialog
                open={renameOpen}
                onOpenChange={setRenameOpen}
                title="Rename project"
                description="The name goes into the canvas file, so everyone with the folder sees it."
                action="Rename"
                initial={current.name}
                onSubmit={(name) => projectClient.rename(name)}
            />

            <ProjectIconDialog project={current} open={iconOpen} onOpenChange={setIconOpen} />

            {/* The same shape as the delete below it: a title that names the project, one paragraph
                that says what goes, and the button that does it. Closing is not a delete, but it
                ends sessions that cannot be brought back, so it asks in the same words. */}
            <Dialog.Root open={closing !== null} onOpenChange={(next) => !next && setClosing(null)}>
                <Dialog.Portal>
                    <Dialog.Backdrop className="dialog-backdrop" />
                    <Dialog.Popup className="dialog-popup w-[420px] p-5">
                        <Dialog.Title className="text-base font-semibold text-text">Close {current.name}?</Dialog.Title>
                        <p className="mt-1 text-xs text-text-muted">{closeWarning(closing ?? 0)}</p>
                        <div className="mt-4 flex items-center justify-end gap-2">
                            <Button onClick={() => setClosing(null)}>Cancel</Button>
                            <Button variant={closing === 0 ? 'primary' : 'danger'} onClick={() => void close()}>
                                <Icon icon={X} size={12} /> Close
                            </Button>
                        </div>
                    </Dialog.Popup>
                </Dialog.Portal>
            </Dialog.Root>

            <Dialog.Root open={deleteOpen} onOpenChange={setDeleteOpen}>
                <Dialog.Portal>
                    <Dialog.Backdrop className="dialog-backdrop" />
                    <Dialog.Popup className="dialog-popup w-[420px] p-5">
                        <Dialog.Title className="text-base font-semibold text-text">Delete {current.name}?</Dialog.Title>
                        <p className="mt-1 text-xs text-text-muted">
                            {current.folder
                                ? 'Forgets the project here. Its canvas file in the folder is removed too; nothing else in the folder is touched.'
                                : 'The canvas and its file are removed.'}{' '}
                            The sessions of its nodes stop, the same as on a close.
                        </p>
                        {failure && <p className="mt-2 text-xs text-status-error">{failure}</p>}
                        <div className="mt-4 flex items-center justify-end gap-2">
                            <Button onClick={() => setDeleteOpen(false)}>Cancel</Button>
                            <Button variant="danger" disabled={busy} onClick={() => void remove()}>
                                <Icon icon={Trash} size={12} /> Delete
                            </Button>
                        </div>
                    </Dialog.Popup>
                </Dialog.Portal>
            </Dialog.Root>
        </>
    );
}

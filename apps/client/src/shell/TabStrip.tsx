import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import type { AgentStatus } from '@ruimte/contracts';
import { viewIconOf, type ProjectView } from '@ruimte/contracts';
import { StatusDot } from '@/canvas/NodeFrame';
import { PATHS_DRAG_TYPE } from '@/canvas/drop';
import { writeMentionDrag } from '@adecore/agents-react/chat/mentions';
import { useBrowserDisplayTitle } from '@/browser/title';
import { useDatabaseConnectionList } from '@/database/connections';
import { databaseTabTitle } from '@/database/tab-look';
import { ViewGlyph } from '@/project/ViewGlyph';
import { closeTabAction } from '@/actions/client-actions';
import { isLooseView, type LooseCellView } from '@/shell/cell-view';
import { FileMenuItems } from '@/shell/panels/FileMenuItems';
import { LooseGlyph } from '@/shell/panels/LooseGlyph';
import { basenameOf } from '@/shell/panels/files-tree';
import { SplitItems, ViewMenuItems } from '@/shell/ViewMenuItems';
import { TabMenuItems } from '@/shell/TabMenuItems';
import { useCellView } from '@/shell/use-cell-view';
import { setDragging, VIEW_DRAG_TYPE } from '@/shell/view-drag';
import { isSameCell, type CellAt } from '@/shell/split';
import { useDocument } from '@/state/document';
import { isCheckoutDiff, isDatabaseTab, useFiles, type DatabaseTab, type FileTab } from '@/state/files';
import { useGit } from '@/state/git';
import { useChats } from '@adecore/agents-react/state/chats';
import { sessionStatus, useSessionRow } from '@/state/sessions';
import { endpointKey, useEndpointId } from '@/state/keys';
import { isUnsavedDraft, useTextDrafts } from '@/state/text-drafts';
import { ContextMenu, DocumentTab, Icon, Menu, TabStrip as CoreTabStrip } from '@adecore/ui';
import { CANVAS_SHORTCUTS } from '@/canvas/shortcuts';

interface TabShellProps {
    id: string;
    label: string;
    hint: string;
    glyph: ReactNode;
    /* Something to say after the name: the lines a diff changed. */
    detail?: ReactNode;
    /* A file with changes nobody saved, or a table with edits nobody submitted. */
    unsavedLabel?: string;
    pinned?: boolean;
    /* Written beside the view payload for a drop that wants more of the tab, such as a file for a composer. */
    onDragData?: (transfer: DataTransfer) => void;
    /* A mark that says the view needs the person, which must be seen from a tab in the background. */
    attention?: ReactNode;
    onDoubleClick?: () => void;
    onClose: () => void;
    menu: ReactNode;
}

/* One tab of the strip, whatever it holds: the looks and the keys are the strip's, what it says and what its menu offers are the view's. */
function TabShell({ id, label, hint, glyph, detail, unsavedLabel, pinned = false, onDragData, attention, onDoubleClick, onClose, menu }: TabShellProps) {
    const onDragStart = (event: React.DragEvent<HTMLButtonElement>): void => {
        // The bar is a drag handle of its own, whose payload would take the place of this one.
        event.stopPropagation();
        event.dataTransfer.setData(VIEW_DRAG_TYPE, id);
        onDragData?.(event.dataTransfer);
        event.dataTransfer.effectAllowed = onDragData === undefined ? 'move' : 'copyMove';
        // The drop indicator in another cell is as wide as this tab is.
        setDragging(id, false, Math.round(event.currentTarget.closest('[data-tab-id]')?.getBoundingClientRect().width ?? 0) || null);
    };
    return (
        <ContextMenu.Root>
            <ContextMenu.Trigger
                render={
                    <DocumentTab
                        item={{ id, label, hint, icon: glyph, detail, attention, unsaved: unsavedLabel, pinned }}
                        data-tab-id={id}
                        onClose={onClose}
                        closeShortcut={CANVAS_SHORTCUTS.closeCell}
                        onDoubleClick={onDoubleClick}
                        onDragStart={(_, event) => onDragStart(event)}
                        onDragEnd={() => setDragging(null)}
                    />
                }
                onContextMenu={(event) => event.stopPropagation()}
            />
            <ContextMenu.Popup>
                <TabMenuItems viewId={id} />
                {menu}
            </ContextMenu.Popup>
        </ContextMenu.Root>
    );
}

/* A changed side that changed nothing has no number: `+0` is noise, and both at zero is a diff with nothing in it to count. */
function LineCount({ tabKey }: { tabKey: string }) {
    const count = useGit((s) => s.counts[tabKey]);
    if (count === undefined || (count.added === 0 && count.deleted === 0)) {
        return null;
    }
    return (
        <span className="flex shrink-0 items-center gap-1 tabular-nums">
            {count.added > 0 && <span className="text-term-green">+{count.added}</span>}
            {count.deleted > 0 && <span className="text-term-red">-{count.deleted}</span>}
        </span>
    );
}

/*
 * A file, its diff or a whole commit. Changes share one tab: the strip keeps the file's name so it stays
 * readable, with the mark that says this is a diff and not the file.
 */
function FileTabItem({ tab, tabKey, label }: { tab: FileTab; tabKey: string; label: string }) {
    const { t } = useTranslation('panels');
    const endpointId = useEndpointId();
    const unsaved = useTextDrafts((s) => tab.view === undefined && isUnsavedDraft(s.rows[endpointKey(endpointId, tab.path)]));
    const commit = tab.view?.commit;
    const hint =
        commit !== undefined
            ? t('git.tab.commitHint', { hash: commit.slice(0, 7) })
            : isCheckoutDiff(tab.path, tab.view)
              ? t('git.tab.checkoutHint', { name: basenameOf(tab.path), base: tab.view?.base ?? t('worktree.baseBranch') })
              : tab.view
                ? basenameOf(tab.path)
                : tab.path;
    return (
        <TabShell
            id={tabKey}
            label={label}
            hint={hint}
            glyph={<LooseGlyph tab={tab} />}
            detail={tab.view ? <LineCount tabKey={tabKey} /> : undefined}
            unsavedLabel={unsaved ? t('file.unsaved.mark') : undefined}
            pinned={tab.pinned}
            /* A diff is a tab about a comparison, so there is nothing for a canvas or a composer to take from it. */
            onDragData={
                tab.view === undefined
                    ? (transfer) => {
                          transfer.setData(PATHS_DRAG_TYPE, tab.path);
                          writeMentionDrag(transfer, [tab.path]);
                      }
                    : undefined
            }
            onDoubleClick={() => useFiles.getState().setPinned(tabKey, !tab.pinned)}
            onClose={() => useFiles.getState().close(tabKey)}
            menu={<FileMenuItems tabKey={tabKey} />}
        />
    );
}

/* The tab names the table; its tooltip says where that table is, as a file's says its path. */
function DatabaseTabItem({ tab }: { tab: DatabaseTab }) {
    const { t } = useTranslation('databases');
    const connections = useDatabaseConnectionList();
    const unsubmitted = useFiles((s) => s.unsubmitted[tab.key] === true);
    const connection = connections.find((entry) => entry.id === tab.connectionId)?.name ?? '';
    return (
        <TabShell
            id={tab.key}
            label={databaseTabTitle(tab)}
            hint={connection === '' ? tab.schema : t('tab.hint', { schema: tab.schema, connection })}
            glyph={<LooseGlyph tab={tab} />}
            unsavedLabel={unsubmitted ? t('tab.unsubmitted') : undefined}
            pinned={tab.pinned}
            onDoubleClick={() => useFiles.getState().setPinned(tab.key, !tab.pinned)}
            onClose={() => useFiles.getState().close(tab.key)}
            menu={<FileMenuItems tabKey={tab.key} />}
        />
    );
}

function LooseTabItem({ view }: { view: LooseCellView }) {
    return isDatabaseTab(view.tab) ? <DatabaseTabItem tab={view.tab} /> : <FileTabItem tab={view.tab} tabKey={view.id} label={view.name} />;
}

function NeedsYouMark({ status }: { status: AgentStatus | undefined }) {
    return status === 'needs-you' ? <StatusDot status="needs-you" plain /> : null;
}

function ChatAttention({ id }: { id: string }) {
    const endpointId = useEndpointId();
    return <NeedsYouMark status={useChats((s) => s.statusByKey[endpointKey(endpointId, id)]?.info.status)} />;
}

function TerminalAttention({ id }: { id: string }) {
    return <NeedsYouMark status={useSessionRow(id, sessionStatus)} />;
}

/* A view of the project as a tab: its mark and its name, the cell's own menu, and a close that only takes it off the screen. */
function ProjectTabItem({ at, view }: { at: CellAt; view: ProjectView }) {
    const { t } = useTranslation('panels');
    const { t: td } = useTranslation('databases');
    const title = useBrowserDisplayTitle(view.id, view.name ?? '', 'titleSource' in view ? view.titleSource : undefined);
    const label = view.kind === 'browser' ? title : (view.name ?? '');
    const unsubmitted = useFiles((s) => view.kind === 'database' && s.unsubmitted[view.id] === true);
    return (
        <TabShell
            id={view.id}
            label={label}
            hint={label}
            unsavedLabel={unsubmitted ? td('tab.unsubmitted') : undefined}
            glyph={
                <ViewGlyph
                    id={view.id}
                    kind={view.kind}
                    icon={viewIconOf(view)}
                    provider={view.kind === 'chat' || view.kind === 'terminal' ? view.node.provider : null}
                    path={view.kind === 'file' ? view.path : null}
                />
            }
            attention={view.kind === 'chat' ? <ChatAttention id={view.id} /> : view.kind === 'terminal' ? <TerminalAttention id={view.id} /> : undefined}
            onClose={() => closeTabAction(view.id)}
            menu={
                <>
                    <Menu.Item onClick={() => closeTabAction(view.id)}>
                        <Icon icon={X} size={14} /> {t('file.tab.close')}
                    </Menu.Item>
                    <Menu.Separator />
                    <SplitItems at={at} separated />
                    <ViewMenuItems viewId={view.id} kind={view.kind} />
                </>
            }
        />
    );
}

function StripTab({ at, id }: { at: CellAt; id: string }) {
    const view = useCellView(id);
    if (view === null) {
        return null;
    }
    return isLooseView(view) ? <LooseTabItem view={view} /> : <ProjectTabItem at={at} view={view} />;
}

/*
 * The views of a tab host as a strip of tabs, in the bar of its cell. A double-click pins a loose tab,
 * a right click offers the menu of what the tab holds, and a pinned tab shows the pin next to its close
 * button. The active tab is marked and kept in sight.
 */
export function TabStrip({ at, ids, active }: { at: CellAt; ids: readonly string[]; active: string }) {
    const focused = useDocument((s) => s.layout !== null && isSameCell(s.layout.focus, at));
    return (
        <CoreTabStrip
            data-tab-strip=""
            items={ids.map((id) => ({ id, label: id }))}
            value={active}
            onValueChange={(id) => useDocument.getState().activateTab(id)}
            focused={focused}
            renderTab={({ id }) => <StripTab at={at} id={id} />}
        />
    );
}

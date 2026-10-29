import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { AgentStatus, ProjectView } from '@ruimte/contracts';
import { StatusDot } from '@/canvas/NodeFrame';
import { WaitingCount } from '@/attention/WaitingCount';
import { PATHS_DRAG_TYPE } from '@/canvas/drop';
import { writeMentionDrag } from '@adecore/agents-react/chat';
import { useBrowserDisplayTitle } from '@/browser/title';
import { useDatabaseConnectionList } from '@/database/connections';
import { databaseTabTitle } from '@/database/tab-look';
import { ViewGlyph } from '@/project/ViewGlyph';
import { closeTabAction } from '@/actions/client-actions';
import { isLooseView, viewGlyphOf, type LooseCellView } from '@/shell/cell-view';
import { FileMenuItems } from '@/shell/panels/FileMenuItems';
import { LooseGlyph } from '@/shell/panels/LooseGlyph';
import { basenameOf } from '@/shell/panels/files-tree';
import { splitSentence } from '@/shell/change-size';
import { ViewMenuItems } from '@/shell/ViewMenuItems';
import { TabMenuItems } from '@/shell/TabMenuItems';
import { useCellView } from '@/shell/use-cell-view';
import { setDragging, VIEW_DRAG_TYPE } from '@/shell/view-drag';
import { isSameCell, type CellAt } from '@/shell/split';
import { useDocument } from '@/state/document';
import { useWaitingCount } from '@/state/attention';
import { isArtifactTab, isCheckoutDiff, isDatabaseTab, useFiles, type ArtifactTab, type DatabaseTab, type FileTab } from '@/state/files';
import { useGit } from '@/state/git';
import { useChats } from '@adecore/agents-react/state';
import { sessionStatus, useSessionRow } from '@/state/sessions';
import { endpointKey, useEndpointId } from '@/state/keys';
import { isUnsavedDraft, useTextDrafts } from '@/state/text-drafts';
import { setTabPinned } from '@/state/tab-close';
import { useViewPinned } from '@/state/view-pins';
import { ContextMenu, DocumentTab, TabStrip as CoreTabStrip } from '@adecore/ui';
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

/* A loose tab pins on a double click and closes out of the pool. */
function looseControls(key: string, pinned: boolean): Pick<TabShellProps, 'pinned' | 'onDoubleClick' | 'onClose'> {
    return { pinned, onDoubleClick: () => useFiles.getState().setPinned(key, !pinned), onClose: () => useFiles.getState().close(key) };
}

/* A changed side that changed nothing has no number: `+0` is noise, and both at zero is a diff with nothing in it to count. */
function LineCount({ tabKey }: { tabKey: string }) {
    const count = useGit((s) => s.counts[tabKey]);
    if (count === undefined || (count.added === 0 && count.deleted === 0)) {
        return null;
    }
    return (
        <span className="flex shrink-0 items-center gap-1 font-mono text-2xs tabular-nums">
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
    const split = useGit((s) => s.counts[tabKey]?.split);
    const commit = tab.view?.commit;
    const whole =
        commit !== undefined
            ? t('git.tab.commitHint', { hash: commit.slice(0, 7) })
            : isCheckoutDiff(tab.path, tab.view)
              ? t('git.tab.checkoutHint', { name: basenameOf(tab.path), base: tab.view?.base ?? t('worktree.baseBranch') })
              : null;
    const sentence = whole === null || split === undefined ? null : splitSentence(split);
    const hint = whole !== null ? (sentence === null ? whole : `${whole} (${sentence})`) : tab.view ? basenameOf(tab.path) : tab.path;
    return (
        <TabShell
            id={tabKey}
            label={label}
            hint={hint}
            glyph={<LooseGlyph tab={tab} />}
            detail={tab.view ? <LineCount tabKey={tabKey} /> : undefined}
            unsavedLabel={unsaved ? t('file.unsaved.mark') : undefined}
            {...looseControls(tabKey, tab.pinned)}
            /* A diff is a tab about a comparison, so there is nothing for a canvas or a composer to take from it. */
            onDragData={
                tab.view === undefined
                    ? (transfer) => {
                          transfer.setData(PATHS_DRAG_TYPE, tab.path);
                          writeMentionDrag(transfer, [tab.path]);
                      }
                    : undefined
            }
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
            {...looseControls(tab.key, tab.pinned)}
            menu={<FileMenuItems tabKey={tab.key} />}
        />
    );
}

function ArtifactTabItem({ tab, label }: { tab: ArtifactTab; label: string }) {
    return <TabShell id={tab.key} label={label} hint={label} glyph={<LooseGlyph tab={tab} />} {...looseControls(tab.key, tab.pinned)} menu={null} />;
}

function LooseTabItem({ view }: { view: LooseCellView }) {
    if (isArtifactTab(view.tab)) {
        return <ArtifactTabItem tab={view.tab} label={view.name} />;
    }
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

function ViewAttention({ id }: { id: string }) {
    return <WaitingCount count={useWaitingCount(id)} />;
}

/* A view of the project as a tab: its mark and its name, its own menu, and a close that only takes it off the screen. */
function ProjectTabItem({ view }: { view: ProjectView }) {
    const { t: td } = useTranslation('databases');
    const title = useBrowserDisplayTitle(view.id, view.name ?? '', 'titleSource' in view ? view.titleSource : undefined);
    const label = view.kind === 'browser' ? title : (view.name ?? '');
    const unsubmitted = useFiles((s) => view.kind === 'database' && s.unsubmitted[view.id] === true);
    const pinned = useViewPinned(view.id);
    return (
        <TabShell
            id={view.id}
            label={label}
            hint={label}
            unsavedLabel={unsubmitted ? td('tab.unsubmitted') : undefined}
            glyph={<ViewGlyph {...viewGlyphOf(view)} />}
            attention={
                view.kind === 'canvas' || view.kind === 'design' ? (
                    <ViewAttention id={view.id} />
                ) : view.kind === 'chat' ? (
                    <ChatAttention id={view.id} />
                ) : view.kind === 'terminal' ? (
                    <TerminalAttention id={view.id} />
                ) : undefined
            }
            pinned={pinned}
            onDoubleClick={() => setTabPinned(view.id, !pinned)}
            onClose={() => closeTabAction(view.id)}
            menu={<ViewMenuItems viewId={view.id} kind={view.kind} />}
        />
    );
}

function StripTab({ id }: { id: string }) {
    const view = useCellView(id);
    if (view === null) {
        return null;
    }
    return isLooseView(view) ? <LooseTabItem view={view} /> : <ProjectTabItem view={view} />;
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
            pressToClose
            renderTab={({ id }) => <StripTab id={id} />}
        />
    );
}

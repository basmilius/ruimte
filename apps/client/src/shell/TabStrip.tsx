import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type WheelEvent as ReactWheelEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Pin, X } from 'lucide-react';
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
import type { CellAt } from '@/shell/split';
import { useDocument } from '@/state/document';
import { isCheckoutDiff, isDatabaseTab, useFiles, type DatabaseTab, type FileTab } from '@/state/files';
import { useGit } from '@/state/git';
import { useChats } from '@adecore/agents-react/state/chats';
import { sessionStatus, useSessionRow } from '@/state/sessions';
import { endpointKey, useEndpointId } from '@/state/keys';
import { isUnsavedDraft, useTextDrafts } from '@/state/text-drafts';
import { ContextMenu, Icon, IconButton, Menu, Tooltip } from '@adecore/ui';
import { CANVAS_SHORTCUTS } from '@/canvas/shortcuts';

/* A tab lifts on hover instead of sinking (`surface-raised` is the step above the panel's ground),
   and the active one carries its mark inside itself, so turning it on moves nothing. */
const TAB =
    "group relative inline-flex h-full shrink-0 items-center gap-1 pr-2 pl-3 text-text-muted hover:bg-surface-raised hover:text-text data-[active=true]:text-text data-[active=true]:after:absolute data-[active=true]:after:inset-x-0 data-[active=true]:after:bottom-0 data-[active=true]:after:h-[2px] data-[active=true]:after:bg-accent data-[active=true]:after:content-['']";

/* The strip clips, so the focus ring goes inside the tab. A diff tab carries the mark that says so
   next to the name, which needs the room. */
const TAB_OPEN =
    'inline-flex h-full min-w-0 max-w-40 items-center gap-1.5 text-sm text-inherit focus-visible:-outline-offset-2 group-data-[view=diff]:max-w-50';

/* The close button is the tab's own: it shows while the pointer is on the tab, while the tab is the
   open one, and while it has focus. */
const TAB_CLOSE = 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100 group-data-[active=true]:opacity-100';

interface TabShellProps {
    id: string;
    active: boolean;
    label: string;
    hint: string;
    glyph: ReactNode;
    /* Something to say after the name: the lines a diff changed. */
    detail?: ReactNode;
    /* A file with changes nobody saved, or a table with edits nobody submitted. */
    unsavedLabel?: string;
    pinned?: boolean;
    diff?: boolean;
    /* Written beside the view payload for a drop that wants more of the tab, such as a file for a composer. */
    onDragData?: (transfer: DataTransfer) => void;
    /* A mark that says the view needs the person, which must be seen from a tab in the background. */
    attention?: ReactNode;
    onDoubleClick?: () => void;
    onClose: () => void;
    menu: ReactNode;
}

/* One tab of the strip, whatever it holds: the looks and the keys are the strip's, what it says and what its menu offers are the view's. */
function TabShell({
    id,
    active,
    label,
    hint,
    glyph,
    detail,
    unsavedLabel,
    pinned = false,
    diff = false,
    onDragData,
    attention,
    onDoubleClick,
    onClose,
    menu
}: TabShellProps) {
    const { t } = useTranslation('panels');
    const onDragStart = (event: React.DragEvent<HTMLButtonElement>): void => {
        // The bar is a drag handle of its own, whose payload would take the place of this one.
        event.stopPropagation();
        event.dataTransfer.setData(VIEW_DRAG_TYPE, id);
        onDragData?.(event.dataTransfer);
        event.dataTransfer.effectAllowed = onDragData === undefined ? 'move' : 'copyMove';
        setDragging(id);
    };
    return (
        <ContextMenu.Root>
            {/* The bar around the strip has a menu of its own, which a right click on a tab does not open as well. */}
            <ContextMenu.Trigger
                render={<span />}
                className={TAB}
                data-tab-id={id}
                data-active={active}
                data-view={diff ? 'diff' : undefined}
                onContextMenu={(event) => event.stopPropagation()}
            >
                <Tooltip label={hint}>
                    <button
                        className={TAB_OPEN}
                        aria-current={active}
                        draggable
                        onDragStart={onDragStart}
                        onDragEnd={() => setDragging(null)}
                        onClick={() => useDocument.getState().activateTab(id)}
                        onDoubleClick={onDoubleClick}
                    >
                        {glyph}
                        <span className="truncate">{label}</span>
                        {detail}
                        {/* Out of the row until there is something to mark, so a clean tab keeps the close button 8px from its name. */}
                        {attention}
                        {unsavedLabel !== undefined && (
                            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-text-muted">
                                <span className="sr-only">{unsavedLabel}</span>
                            </span>
                        )}
                    </button>
                </Tooltip>
                {pinned && <Icon icon={Pin} size={12} className="shrink-0 text-text-muted" />}
                <IconButton
                    icon={X}
                    size="2xs"
                    label={t('file.tab.closeNamed', { name: label })}
                    kbd={CANVAS_SHORTCUTS.closeCell}
                    className={TAB_CLOSE}
                    onClick={onClose}
                />
            </ContextMenu.Trigger>
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
function FileTabItem({ tab, tabKey, active, label }: { tab: FileTab; tabKey: string; active: boolean; label: string }) {
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
            active={active}
            label={label}
            hint={hint}
            glyph={<LooseGlyph tab={tab} />}
            detail={tab.view ? <LineCount tabKey={tabKey} /> : undefined}
            unsavedLabel={unsaved ? t('file.unsaved.mark') : undefined}
            pinned={tab.pinned}
            diff={tab.view !== undefined}
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
function DatabaseTabItem({ tab, active }: { tab: DatabaseTab; active: boolean }) {
    const { t } = useTranslation('databases');
    const connections = useDatabaseConnectionList();
    const unsubmitted = useFiles((s) => s.unsubmitted[tab.key] === true);
    const connection = connections.find((entry) => entry.id === tab.connectionId)?.name ?? '';
    return (
        <TabShell
            id={tab.key}
            active={active}
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

function LooseTabItem({ view, active }: { view: LooseCellView; active: boolean }) {
    return isDatabaseTab(view.tab) ? (
        <DatabaseTabItem tab={view.tab} active={active} />
    ) : (
        <FileTabItem tab={view.tab} tabKey={view.id} active={active} label={view.name} />
    );
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
function ProjectTabItem({ at, view, active }: { at: CellAt; view: ProjectView; active: boolean }) {
    const { t } = useTranslation('panels');
    const title = useBrowserDisplayTitle(view.id, view.name ?? '', 'titleSource' in view ? view.titleSource : undefined);
    const label = view.kind === 'browser' ? title : (view.name ?? '');
    return (
        <TabShell
            id={view.id}
            active={active}
            label={label}
            hint={label}
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

function StripTab({ at, id, active }: { at: CellAt; id: string; active: boolean }) {
    const view = useCellView(id);
    if (view === null) {
        return null;
    }
    return isLooseView(view) ? <LooseTabItem view={view} active={active} /> : <ProjectTabItem at={at} view={view} active={active} />;
}

/*
 * The views of a tab host as a strip of tabs, in the bar of its cell. A double-click pins a loose tab,
 * a right click offers the menu of what the tab holds, and a pinned tab shows the pin next to its close
 * button. The active tab is marked and kept in sight.
 */
export function TabStrip({ at, ids, active, insertAt = null }: { at: CellAt; ids: readonly string[]; active: string; insertAt?: number | null }) {
    const counts = useGit((s) => s.counts);
    const stripRef = useRef<HTMLDivElement>(null);
    const [edges, setEdges] = useState({ start: false, end: false });
    const [lineLeft, setLineLeft] = useState<number | null>(null);

    const measureEdges = useCallback((): void => {
        const strip = stripRef.current;
        if (strip === null) {
            return;
        }
        const start = strip.scrollLeft > 0;
        const end = strip.scrollLeft + strip.clientWidth < strip.scrollWidth - 1;
        setEdges((current) => (current.start === start && current.end === end ? current : { start, end }));
    }, []);

    useEffect(() => {
        const strip = stripRef.current;
        if (strip === null || typeof ResizeObserver === 'undefined') {
            return;
        }
        const observer = new ResizeObserver(measureEdges);
        observer.observe(strip);
        return () => observer.disconnect();
    }, [measureEdges]);

    // A tab opening, closing or gaining a count changes what overflows without resizing the strip.
    useLayoutEffect(measureEdges, [measureEdges, ids, counts]);

    useEffect(() => {
        stripRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }, [active]);

    const measureLine = useCallback((): void => {
        const tabs = stripRef.current?.querySelectorAll<HTMLElement>('[data-tab-id]') ?? [];
        const before = insertAt === null ? undefined : tabs[insertAt];
        const last = tabs[tabs.length - 1];
        setLineLeft(insertAt === null ? null : before !== undefined ? before.offsetLeft : last !== undefined ? last.offsetLeft + last.offsetWidth : 0);
    }, [insertAt]);

    // Where a dragged tab would land, in the strip's own coordinates so the line scrolls along with the tabs.
    useLayoutEffect(measureLine, [measureLine, ids]);

    // A trackpad swipes sideways on its own; a wheel with one axis still has to reach the strip.
    const onWheel = (event: ReactWheelEvent<HTMLDivElement>): void => {
        if (event.deltaX === 0 && event.deltaY !== 0) {
            event.currentTarget.scrollLeft += event.deltaY;
        }
    };

    return (
        <div
            ref={stripRef}
            className="scroll-fade-x relative flex h-full min-w-0 flex-1 items-stretch overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            data-fade-start={edges.start || undefined}
            data-fade-end={edges.end || undefined}
            onWheel={onWheel}
            onScroll={measureEdges}
        >
            {ids.map((id) => (
                <StripTab key={id} at={at} id={id} active={id === active} />
            ))}
            {lineLeft !== null && (
                <span aria-hidden className="pointer-events-none absolute inset-y-1 z-10 w-[2px] -translate-x-px bg-accent" style={{ left: lineLeft }} />
            )}
        </div>
    );
}

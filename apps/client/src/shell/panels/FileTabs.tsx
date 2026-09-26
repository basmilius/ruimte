import { useCallback, useEffect, useLayoutEffect, useRef, useState, type WheelEvent as ReactWheelEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { ContextMenu } from '@base-ui-components/react/context-menu';
import { GitCommitHorizontal, GitCompare, Pin, X } from 'lucide-react';
import { PATHS_DRAG_TYPE } from '@/canvas/drop';
import { MENTION_DRAG_TYPE } from '@/chat/mentions';
import { FileMenuItems } from '@/shell/panels/FileMenuItems';
import { basenameOf } from '@/shell/panels/files-tree';
import { isCheckoutDiff, useFiles } from '@/state/files';
import { useGit } from '@/state/git';
import { endpointKey, useEndpointId } from '@/state/keys';
import { isUnsavedDraft, useTextDrafts } from '@/state/text-drafts';
import { FileIcon } from '@ruimte/ui/FileIcon';
import { Icon } from '@ruimte/ui/Icon';
import { Tooltip } from '@ruimte/ui/Tooltip';
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
const TAB_CLOSE = 'icon-btn icon-btn-2xs opacity-0 group-hover:opacity-100 focus-visible:opacity-100 group-data-[active=true]:opacity-100';

/*
 * The open files as a strip of tabs, inside the preview panel's own header. A double-click pins a
 * tab, a right click offers the same menu the toolbar carries, and a pinned tab shows the pin next
 * to its close button.
 * Changes share one tab: the strip keeps the file's name so it stays readable, with the mark that
 * says this is a diff and not the file.
 */
export function FileTabs() {
    const { t } = useTranslation('panels');
    const tabs = useFiles((s) => s.tabs);
    const active = useFiles((s) => s.active);
    const counts = useGit((s) => s.counts);
    const endpointId = useEndpointId();
    const drafts = useTextDrafts((s) => s.rows);
    const stripRef = useRef<HTMLDivElement>(null);
    const [edges, setEdges] = useState({ start: false, end: false });

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
    useLayoutEffect(measureEdges, [measureEdges, tabs, counts]);

    useEffect(() => {
        stripRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }, [active]);

    // A trackpad swipes sideways on its own; a wheel with one axis still has to reach the strip.
    const onWheel = (event: ReactWheelEvent<HTMLDivElement>): void => {
        if (event.deltaX === 0 && event.deltaY !== 0) {
            event.currentTarget.scrollLeft += event.deltaY;
        }
    };

    return (
        <div
            ref={stripRef}
            className="scroll-fade-x flex h-full min-w-0 flex-1 items-stretch overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            data-fade-start={edges.start || undefined}
            data-fade-end={edges.end || undefined}
            onWheel={onWheel}
            onScroll={measureEdges}
        >
            {tabs.map((tab) => {
                // A checkout diff is "Changes"; a whole commit uses its hash because no file represents it.
                const commit = tab.view?.commit;
                const checkout = isCheckoutDiff(tab.path, tab.view);
                const count = counts[tab.key];
                const unsaved = tab.view === undefined && isUnsavedDraft(drafts[endpointKey(endpointId, tab.path)]);
                const label =
                    commit !== undefined ? commit.slice(0, 7) : checkout ? basenameOf(tab.path) : tab.view ? t('git.tab.changes') : basenameOf(tab.path);
                const hint =
                    commit !== undefined
                        ? t('git.tab.commitHint', { hash: commit.slice(0, 7) })
                        : checkout
                          ? t('git.tab.checkoutHint', { name: basenameOf(tab.path), base: tab.view?.base ?? t('worktree.baseBranch') })
                          : tab.view
                            ? basenameOf(tab.path)
                            : tab.path;
                return (
                    <ContextMenu.Root key={tab.key}>
                        <ContextMenu.Trigger render={<span />} className={TAB} data-active={tab.key === active} data-view={tab.view ? 'diff' : undefined}>
                            <Tooltip label={hint}>
                                <button
                                    className={TAB_OPEN}
                                    aria-current={tab.key === active}
                                    /* A diff is a tab about a comparison, not about a file, so there is
                                       nothing for a canvas or a composer to take from it. */
                                    draggable={tab.view === undefined}
                                    onDragStart={(event) => {
                                        event.dataTransfer.setData(PATHS_DRAG_TYPE, tab.path);
                                        event.dataTransfer.setData(MENTION_DRAG_TYPE, tab.path);
                                        event.dataTransfer.effectAllowed = 'copy';
                                    }}
                                    onClick={() => useFiles.getState().activate(tab.key)}
                                    onDoubleClick={() => useFiles.getState().setPinned(tab.key, !tab.pinned)}
                                >
                                    {tab.view ? (
                                        <Icon icon={commit === undefined ? GitCompare : GitCommitHorizontal} size={14} className="shrink-0 text-text-faint" />
                                    ) : (
                                        <FileIcon path={tab.path} size={14} />
                                    )}
                                    <span className="truncate">{label}</span>
                                    {/* A side that changed nothing has no number: `+0` is noise, and both
                                    at zero is a diff with nothing in it to count. */}
                                    {tab.view && count !== undefined && (count.added > 0 || count.deleted > 0) && (
                                        <span className="flex shrink-0 items-center gap-1 tabular-nums">
                                            {count.added > 0 && <span className="text-term-green">+{count.added}</span>}
                                            {count.deleted > 0 && <span className="text-term-red">-{count.deleted}</span>}
                                        </span>
                                    )}
                                    {/* Out of the row until there is something to mark, so a clean tab keeps the close button 8px from its name. */}
                                    {unsaved && (
                                        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-text-muted">
                                            <span className="sr-only">{t('file.unsaved.mark')}</span>
                                        </span>
                                    )}
                                </button>
                            </Tooltip>
                            {tab.pinned && <Icon icon={Pin} size={12} className="shrink-0 text-text-muted" />}
                            <Tooltip label={t('file.tab.closeNamed', { name: label })} kbd={CANVAS_SHORTCUTS.closeCell} name>
                                <button className={TAB_CLOSE} onClick={() => useFiles.getState().close(tab.key)}>
                                    <Icon icon={X} size={12} />
                                </button>
                            </Tooltip>
                        </ContextMenu.Trigger>
                        <ContextMenu.Portal>
                            <ContextMenu.Positioner className="z-(--z-popup)">
                                <ContextMenu.Popup className="menu-popup">
                                    <FileMenuItems tabKey={tab.key} />
                                </ContextMenu.Popup>
                            </ContextMenu.Positioner>
                        </ContextMenu.Portal>
                    </ContextMenu.Root>
                );
            })}
        </div>
    );
}

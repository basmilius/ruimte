import { useTranslation } from 'react-i18next';
import {
    ArrowRightToLine,
    Copy,
    CornerUpRight,
    Expand,
    Frame,
    ListX,
    MessageSquare,
    PanelBottom,
    PanelRight,
    Settings2,
    Shrink,
    Terminal,
    Trash,
    UserRoundMinus,
    Users,
    X
} from 'lucide-react';
import { canShareView, isCanvasView, type ProjectView } from '@ruimte/contracts';
import { useDatabaseViewShareRefusal } from '@/database/view-sharing';
import { BookmarkSubmenu } from '@adecore/agents-react/chat/ui/BookmarkSubmenu';
import { ForkMenuItem } from '@/chat/ForkMenuItem';
import { useOffersFork } from '@/chat/use-offers-fork';
import {
    closeCellAction,
    closeCellsRightOfAction,
    closeOtherCellsAction,
    duplicateViewAction,
    placeViewOnCanvasAction,
    showViewOnCanvasAction,
    splitAction
} from '@/actions/client-actions';
import { FlagSubmenu } from '@/project/FlagSubmenu';
import { askDeleteView, askViewSettings, openSessionInKind, setViewShared } from '@/project/views';
import { sessionHandoffs, viewOffers } from '@/shell/view-offers';
import { FileActionItems } from '@/shell/panels/FileActionItems';
import { resolveStoredPath } from '@/shell/panels/files-tree';
import { canSplit, cellAt, cellCount, cellsRightOf, freeViewFor, isTabHost, maximizedCell, type CellAt } from '@/shell/split';
import { useChatRow } from '@adecore/agents-react/state/chats';
import { cellViewOf, hasActiveCanvas, useDocument } from '@/state/document';
import { isScratchProject, useProject } from '@/state/project';
import { useProviders } from '@adecore/agents-react/state/providers';
import { useSessionRow } from '@/state/sessions';
import { fileManagerName, useServer } from '@/state/server';
import { useTransport } from '@/transport/context';
import { CANVAS_SHORTCUTS } from '@/canvas/shortcuts';
import { Icon, Kbd, KEY_SHORTCUTS, Menu, Tooltip } from '@adecore/ui';

interface ViewMenuItemsProps {
    viewId: string;
    kind: ProjectView['kind'];
    /* In the sidebar the focused row takes F2 itself, so only there does the hint hold. */
    onSidebar?: boolean;
}

/*
 * Everything a view can be asked, as menu items. The sidebar's right click, the view menu in the
 * toolbar and the right click on a cell's bar offer the same list in the same order, so the three
 * never drift apart; `ContextMenu` draws a `Menu.Item` as its own.
 *
 * Four groups, each a line apart: what the view is, how to get another one, where it stands, and
 * who else sees it, with the delete on its own at the bottom. A group nobody is offered takes its
 * line with it, so the menu never opens on a line against a line.
 */
export function ViewMenuItems({ viewId, kind, onSidebar = false }: ViewMenuItemsProps) {
    const { t } = useTranslation(['shell', 'common']);
    const shared = useDocument((state) => state.shared).includes(viewId);
    /* Offered whether or not the folder is a repository: finding that out means starting a git watch,
       which opening a menu has no business doing, and sharing without one only writes a file nobody
       pulls yet. Left out for a view that cannot travel, and for a divider, which goes where the
       group under it goes and is nobody's to share. */
    const saved = useDocument((state) => state.views.some((candidate) => candidate.id === viewId));
    const view = useDocument((state) => cellViewOf(state, viewId) ?? undefined);
    /* A canvas to land on. Without one the rows that put a view on a canvas would do nothing at all,
       so they are left out rather than greyed, which a menu has no room to explain. */
    const shareRefusal = useDatabaseViewShareRefusal(view);
    const hasCanvas = useDocument((state) => state.views.some(isCanvasView));
    const onCanvas = useDocument(hasActiveCanvas);
    const folder = useProject((state) => state.current?.folder ?? null);
    const scratch = useProject((state) => isScratchProject(state.current));
    const platform = useServer((state) => state.platform);
    /* What the daemon knows about the session, which is newer than what the view was opened with. */
    const chat = useChatRow(viewId, (row) => row?.info);
    const agent = useSessionRow(viewId, (row) => row?.agent);
    const sessionAccount = useSessionRow(viewId, (row) => row?.account);
    const providers = useProviders((state) => state.providers);
    const offersFork = useOffersFork(viewId);
    const transport = useTransport();

    const { asChat, asTerminal } = sessionHandoffs(kind, view, chat, { agent, account: sessionAccount }, providers);
    // The node of a session view works somewhere; without a folder of its own that is the project's. The Chats project shows none.
    const workingFolder = !scratch && (view?.kind === 'chat' || view?.kind === 'terminal') ? (view.node.cwd ?? chat?.cwd ?? folder) : null;
    // What a file view holds is stored against the project folder; the menu acts on the daemon's path.
    const filePath = view?.kind === 'file' ? resolveStoredPath(folder, view.path) : null;
    const offers = viewOffers({
        kind,
        shared,
        canShare: view !== undefined && canShareView(view) && shareRefusal === null,
        hasCanvas,
        onCanvas,
        offersFork,
        asChat,
        asTerminal,
        workingFolder,
        filePath,
        scratch
    });
    const drawn = offers.duplicate;
    const offerShare = view !== undefined && offers.share;
    const offerFork = offers.fork;
    const copies = drawn || offerFork || asChat !== null || asTerminal !== null;
    const offerPut = offers.putOnCanvas;
    const offerShow = offers.showOnCanvas;
    const place = offerPut || offerShow || filePath !== null || workingFolder !== null;
    if (!saved && filePath !== null) {
        return <FileActionItems path={filePath} on="view" />;
    }
    return (
        <>
            <Menu.Item onClick={() => askViewSettings(viewId)}>
                <Icon icon={Settings2} size={14} /> {t('viewMenu.viewSettings')} {onSidebar && <Kbd shortcut={KEY_SHORTCUTS.rename} />}
            </Menu.Item>
            <FlagSubmenu id={viewId} />
            {kind === 'chat' && <BookmarkSubmenu chatId={viewId} />}

            {copies && <Menu.Separator />}
            {drawn && (
                <Menu.Item onClick={() => duplicateViewAction(viewId)}>
                    <Icon icon={Copy} size={14} /> {t('sidebar.duplicate')}
                </Menu.Item>
            )}
            {asChat !== null && (
                <Menu.Item onClick={() => void openSessionInKind(viewId, 'chat', asChat)}>
                    <Icon icon={MessageSquare} size={14} /> {t('viewMenu.openInChat')}
                </Menu.Item>
            )}
            {asTerminal !== null && (
                <Menu.Item onClick={() => void openSessionInKind(viewId, 'terminal', asTerminal)}>
                    <Icon icon={Terminal} size={14} /> {t('viewMenu.openInTerminal')}
                </Menu.Item>
            )}
            {offerFork && <ForkMenuItem chatId={viewId} />}

            {place && <Menu.Separator />}
            {offerPut && (
                <Menu.Item onClick={() => placeViewOnCanvasAction(viewId)}>
                    <Icon icon={Frame} size={14} /> {t('viewMenu.putOnCanvas')}
                </Menu.Item>
            )}
            {offerShow && (
                <Menu.Item onClick={() => void showViewOnCanvasAction(viewId)}>
                    <Icon icon={Frame} size={14} /> {t('viewMenu.showOnCanvas')}
                </Menu.Item>
            )}
            {/* A file offers the same things wherever it is drawn, so a view of one says what a node
                of it says: show it, reveal it, copy its path. */}
            {filePath !== null && <FileActionItems path={filePath} on="view" />}
            {workingFolder !== null && (
                <Menu.Item onClick={() => void transport.request('fs.reveal', { path: workingFolder }).catch(() => undefined)}>
                    <Icon icon={CornerUpRight} size={14} /> {t('viewMenu.reveal', { app: fileManagerName(platform) })}
                </Menu.Item>
            )}

            {offerShare && (
                <>
                    <Menu.Separator />
                    <Menu.Item onClick={() => void setViewShared(viewId, !shared)}>
                        <Icon icon={shared ? UserRoundMinus : Users} size={14} /> {t(shared ? 'share.stop' : 'share.start')}
                    </Menu.Item>
                </>
            )}
            {/* A row cannot explain why it is off, so the reason rides on a tooltip around it. */}
            {!offerShare && saved && !shared && shareRefusal !== null && (
                <>
                    <Menu.Separator />
                    <Tooltip label={t('share.privateConnection')} side="right">
                        <div>
                            <Menu.Item disabled>
                                <Icon icon={Users} size={14} /> {t('share.start')}
                            </Menu.Item>
                        </div>
                    </Tooltip>
                </>
            )}

            <Menu.Separator />
            <Menu.Item className="text-status-error" onClick={() => askDeleteView(viewId)}>
                <Icon icon={Trash} size={14} /> {t('common:action.delete')}
            </Menu.Item>
        </>
    );
}

/*
 * Putting a view beside the one on screen, and closing the one it sits in. Which view lands there is
 * the same question the shortcut answers (`freeViewFor`): the first one that is not standing
 * anywhere yet, since a view is in at most one cell. With every view already up, or with the grid
 * full, the row is not offered. Without an `at` the rows act on the focused cell, which is what the
 * toolbar's menu wants; a cell's own bar names itself and takes the focus first, because a split
 * always lands beside the focus.
 */
export function SplitItems({ at, separated = false }: { at?: CellAt; separated?: boolean }) {
    const { t } = useTranslation('shell');
    const layout = useDocument((s) => s.layout);
    const free = useDocument(freeViewFor);
    const filling = useDocument((s) => maximizedCell(s.layout, s.maximized) !== null);
    const cell = at ?? layout?.focus ?? null;
    const closable = layout !== null;
    const multiple = layout !== null && cellCount(layout) > 1;
    const held = layout !== null && cell !== null ? cellAt(layout, cell) : null;
    const standing = held?.viewId ?? null;
    const hosted = held !== null && isTabHost(held);
    const closesRight = layout !== null && cell !== null && standing !== null && cellsRightOf(layout, cell) > 0;
    const room = (direction: 'right' | 'down'): boolean => layout !== null && free !== null && cell !== null && canSplit(layout, cell, direction, free);
    if (!room('right') && !room('down') && !closable) {
        return null;
    }
    const split = (direction: 'right' | 'down'): void => {
        if (at !== undefined) {
            useDocument.getState().focusCellAt(at);
        }
        splitAction(direction);
    };
    const toggleMaximized = (): void => {
        if (at !== undefined) {
            useDocument.getState().focusCellAt(at);
        }
        useDocument.getState().toggleMaximized();
    };
    return (
        <>
            {room('right') && (
                <Menu.Item onClick={() => split('right')}>
                    <Icon icon={PanelRight} size={14} /> {t('viewMenu.splitRight')} <Kbd shortcut={CANVAS_SHORTCUTS.splitRight} />
                </Menu.Item>
            )}
            {room('down') && (
                <Menu.Item onClick={() => split('down')}>
                    <Icon icon={PanelBottom} size={14} /> {t('viewMenu.splitDown')} <Kbd shortcut={CANVAS_SHORTCUTS.splitDown} />
                </Menu.Item>
            )}
            {multiple && standing !== null && (
                <Menu.Item onClick={toggleMaximized}>
                    <Icon icon={filling ? Shrink : Expand} size={14} /> {t(filling ? 'viewMenu.restoreSplit' : 'viewMenu.maximizeCell')}{' '}
                    <Kbd shortcut={CANVAS_SHORTCUTS.maximizeCell} />
                </Menu.Item>
            )}
            {closable && standing !== null && (
                <Menu.Item onClick={() => closeCellAction(standing)}>
                    {/* In a host the key closes the tab in front, and the cell goes with its last one. */}
                    <Icon icon={X} size={14} /> {t('cellToolbar.closeCell')} {!hosted && <Kbd shortcut={CANVAS_SHORTCUTS.closeCell} />}
                </Menu.Item>
            )}
            {multiple && cell !== null && standing !== null && (
                <Menu.Item onClick={() => closeOtherCellsAction(cell)}>
                    <Icon icon={ListX} size={14} /> {t('viewMenu.closeOthers')}
                </Menu.Item>
            )}
            {closesRight && cell !== null && (
                <Menu.Item onClick={() => closeCellsRightOfAction(cell)}>
                    <Icon icon={ArrowRightToLine} size={14} /> {t('viewMenu.closeToRight')}
                </Menu.Item>
            )}
            {/* The line under the group, drawn here rather than by the caller: with nothing to split
                these rows are gone, and a line the caller drew would sit against the next one. */}
            {separated && <Menu.Separator />}
        </>
    );
}

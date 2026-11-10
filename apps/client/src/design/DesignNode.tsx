import { Icon, IconButton } from '@adecore/ui';
import { nodeChats, nodeColorOf, type DesignPlace, type ProjectNode } from '@ruimte/contracts';
import clsx from 'clsx';
import { ChevronRight, FileCode2, RotateCw, SwatchBook, TriangleAlert } from 'lucide-react';
import { useEffect, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { accentColor, accentHeaderStyle, accentShades } from '@/canvas-model/accents';
import type { ResizeEdge } from '@/canvas-model/derived-frame';
import type { Rect } from '@/canvas-model/math';
import { useDesignPages } from '@/design/design-files';
import { arrangePages, pageName } from '@/design/design-page';
import { DesignActions } from '@/design/DesignActions';
import { DesignStage } from '@/design/DesignStage';
import { ChatBody } from '@/nodes/ChatBody';
import { useCanvas } from '@/state/canvas';
import { useEndpointId } from '@/state/current-endpoint';
import { activeDesignChat, useDesignChat } from '@/state/design-chat';
import { useDesignFolder } from '@/state/design-places';
import { storedJson } from '@/state/stored-json';
import { DerivedSet, type DerivedCard } from '@/surface/canvas/DerivedSet';
import { KindIcon } from '@/surface/canvas/KindIcon';
import { NodeHeaderControls, NodePlate } from '@/surface/nodes/node-chrome';

const FRAME = 'flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-clip-padding shadow-node';
const HEADER = 'flex h-[39px] shrink-0 items-center gap-2 border-b border-border bg-surface-raised pr-1 pl-3 text-sm text-text';

const GUTTER = 72;
const LINE_H = 40;
const STACK_GAP = 8;
/* Where a line meets a card, and the node: the middle of a 39px header, which a closed page of 40 is all of. */
const HEADER_MIDDLE = 20;
const OPEN_SIZE = { w: 720, h: 560 };
const OPEN_MIN = { w: 360, h: 320 };
/* The card is placed by its top-left corner beside the node, so only its right and bottom edges move. */
const OPEN_EDGES: readonly ResizeEdge[] = ['e', 's', 'se'];

function pageRects(node: Rect, pages: readonly string[], open: string | null, size: { w: number; h: number }): Rect[] {
    const rects: Rect[] = [];
    for (const page of pages) {
        const above = rects.at(-1);
        const y = above === undefined ? node.y : above.y + above.h + STACK_GAP;
        rects.push({ x: node.x + node.w + GUTTER, y, w: size.w, h: page === open ? size.h : LINE_H });
    }
    return rects;
}

function placeOfNode(node: ProjectNode, canvasId: string): DesignPlace | null {
    return node.path === undefined || node.path === '' ? null : { id: node.id, name: node.title, path: node.path, chats: nodeChats(node), canvasId };
}

function useNodeDesign(id: string): DesignPlace | null {
    const node = useCanvas((s) => s.nodes[id]);
    const canvasId = useCanvas((s) => s.viewId);
    return node === undefined || canvasId === null ? null : placeOfNode(node, canvasId);
}

/*
 * A design on a canvas: the chat that works on it, with the chats of the design picked at the top of its
 * composer and the design's own actions in the node's header. Its pages stand beside it (`DesignBeside`).
 */
export function DesignNodeBody({ id, focused }: { id: string; focused: boolean }) {
    const { t } = useTranslation('shell');
    const design = useNodeDesign(id);
    const { folder } = useDesignFolder(design ?? { id, path: '', canvasId: null });
    const picked = useDesignChat((state) => state.picked);
    // Without the project's folder on this machine the chat has nowhere to write a page.
    if (design === null || folder === null) {
        return <NodePlate icon={SwatchBook}>{t('design.noFolder')}</NodePlate>;
    }
    const chatId = activeDesignChat(design, picked);
    return (
        <>
            <NodeHeaderControls>
                <DesignActions design={design} compact />
            </NodeHeaderControls>
            {/* Keyed on the chat, so every chat gets a thread of its own; their picker stands at the top of the composer. */}
            <ChatBody key={chatId} id={chatId} focused={focused} onCanvas />
        </>
    );
}

const PageSizeSchema = z.object({ w: z.number().min(OPEN_MIN.w), h: z.number().min(OPEN_MIN.h) });

/* The size a person gave the open page beside a design node: this client's, per canvas and node, never in the project. */
function storedPageSize(viewId: string, nodeId: string) {
    return storedJson<{ w: number; h: number }>(`ruimte.designPage.${viewId}.${nodeId}`, PageSizeSchema);
}

/*
 * The pages of a design node beside it on the canvas, the most recently changed first, like the runs of a
 * routine: a closed page is one line, and one page at a time is open with the tools of the stage over it,
 * so a canvas runs one page of a design at most. Which page is open is this window's; its size is kept per
 * canvas and node.
 */
export function DesignBeside({ id, z }: { id: string; z: number }) {
    const { t } = useTranslation('shell');
    const endpointId = useEndpointId();
    const node = useCanvas((s) => s.nodes[id]);
    const viewId = useCanvas((s) => s.viewId);
    const design = useNodeDesign(id);
    const { folder, projectFolder } = useDesignFolder(design ?? { id, path: '', canvasId: null });
    const { pages, problem, retry } = useDesignPages(endpointId, design === null ? null : folder, projectFolder);
    const picked = useDesignChat((state) => state.picked);
    const showPage = useDesignChat((state) => state.showPage);
    // Undefined until the pages first arrive, then the newest of them; null opens none.
    const [open, setOpen] = useState<string | null | undefined>(undefined);
    // The order the cards stand in, which holds while a page is open (`arrangePages`).
    const [order, setOrder] = useState<string[] | null>(null);
    const [size, setSize] = useState(() => (viewId === null ? null : storedPageSize(viewId, id).read()) ?? OPEN_SIZE);

    // Settled once, so a page the chat writes later neither takes the card's place nor drops what is queued on it.
    if (open === undefined && pages !== null && pages.length > 0) {
        setOpen(pages[0]!);
    }

    const shown = open !== undefined && open !== null && pages?.includes(open) ? open : null;

    if (pages !== null) {
        const arranged = arrangePages(order, pages, shown !== null);

        if (order === null || arranged.join('\n') !== order.join('\n')) {
            setOrder(arranged);
        }
    }

    // The actions of the node act on the page its open card shows, and on none once it closed or went.
    useEffect(() => {
        if (pages !== null) {
            showPage(id, shown);
        }
    }, [id, pages, shown, showPage]);

    if (node === undefined || design === null || folder === null || pages === null || order === null) {
        return null;
    }
    const accent = accentColor(nodeColorOf(node));

    if (pages.length === 0) {
        const text = problem === null ? t('design.empty') : t('design.listFailed', { reason: problem });

        return (
            <DerivedSet
                owner={id}
                z={z}
                lineDown={HEADER_MIDDLE}
                {...(accent === undefined ? {} : { stroke: accentShades(accent).line })}
                cards={[
                    {
                        key: 'empty',
                        rect: { x: node.x + node.w + GUTTER, y: node.y, w: size.w, h: LINE_H },
                        linkedFrom: 'node',
                        label: text,
                        lineDown: HEADER_MIDDLE,
                        content: <EmptyLine text={text} failed={problem !== null} onRetry={retry} />
                    }
                ]}
            />
        );
    }

    const chatId = activeDesignChat(design, picked);
    const openPage = (page: string | null): void => setOpen(page);
    const resize = ({ w, h }: Rect): void => {
        setSize({ w, h });
        if (viewId !== null) {
            storedPageSize(viewId, id).write({ w, h });
        }
    };
    const rects = pageRects(node, order, shown, size);
    const cards = order.map((page, index): DerivedCard => {
        const isOpen = page === shown;
        const rect = rects[index]!;
        return {
            key: page,
            rect,
            linkedFrom: 'node',
            label: pageName(page),
            lineDown: HEADER_MIDDLE,
            content: isOpen ? (
                <div className={clsx(FRAME, 'bg-surface')} style={accent === undefined ? undefined : { borderColor: accentShades(accent).frameBorder }}>
                    <header className={clsx(HEADER, 'group/header')} style={accent === undefined ? undefined : accentHeaderStyle(accent)}>
                        <KindIcon toggle={{ folded: false, label: t('design.node.closePage'), onToggle: () => openPage(null) }}>
                            <Icon icon={FileCode2} size={14} />
                        </KindIcon>
                        <span className="min-w-0 grow truncate font-medium">{pageName(page)}</span>
                    </header>
                    <div className="flex min-h-0 grow flex-col bg-canvas-bg">
                        <DesignStage designId={id} chatId={chatId} folder={folder} watched={projectFolder ?? folder} pinned={page} />
                    </div>
                </div>
            ) : (
                <PageLine page={page} accent={accent} onOpen={() => openPage(page)} />
            ),
            // Its frame holds what the page's own script set, which drawing it again would lose; one page of a design is open at most.
            ...(isOpen ? { resize: { edges: OPEN_EDGES, minimum: OPEN_MIN, apply: resize }, live: true } : {})
        };
    });

    return <DerivedSet owner={id} z={z} cards={cards} lineDown={HEADER_MIDDLE} {...(accent === undefined ? {} : { stroke: accentShades(accent).line })} />;
}

/* Where the chat will write, as a line beside a design without pages yet; nothing opens from it. A folder that could not be read says so, with a way to read it again. */
function EmptyLine({ text, failed, onRetry }: { text: string; failed: boolean; onRetry(): void }) {
    const { t } = useTranslation('common');

    return (
        <div className={clsx(FRAME, 'flex-row items-center gap-2 bg-surface px-3 text-sm', failed ? 'text-status-error' : 'text-text-muted')}>
            <Icon icon={failed ? TriangleAlert : SwatchBook} size={14} className="shrink-0" />
            <span className="min-w-0 grow truncate">{text}</span>
            {failed && <IconButton icon={RotateCw} size="sm" label={t('action.retry')} onClick={onRetry} />}
        </div>
    );
}

function PageLine({ page, accent, onOpen }: { page: string; accent: string | undefined; onOpen: () => void }) {
    // A closed page is all header, so a colored one is tinted as a colored node's header is.
    const shades = accent === undefined ? null : accentShades(accent);
    return (
        <button
            type="button"
            aria-expanded={false}
            className={clsx(
                FRAME,
                'group/header flex-row items-center gap-2 px-3 text-left text-sm text-text',
                shades === null ? 'bg-surface hover:bg-surface-raised' : 'bg-(--page-tint) hover:bg-(--page-hover)'
            )}
            style={
                shades === null ? undefined : ({ borderColor: shades.frameBorder, '--page-tint': shades.header, '--page-hover': shades.hover } as CSSProperties)
            }
            onClick={onOpen}
        >
            {/* The page's icon, which shows the chevron to open it while the pointer is on the line, as a node's header does. */}
            <span aria-hidden className="relative flex size-3.5 shrink-0 items-center justify-center text-text-muted">
                <Icon icon={FileCode2} size={14} className="transition-opacity group-hover/header:opacity-0" />
                <Icon icon={ChevronRight} size={14} className="absolute opacity-0 transition-opacity group-hover/header:opacity-100" />
            </span>
            <span className="min-w-0 grow truncate">{pageName(page)}</span>
        </button>
    );
}

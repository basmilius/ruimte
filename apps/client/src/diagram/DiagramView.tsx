import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { ContextMenu } from '@base-ui-components/react/context-menu';
import { Menu } from '@base-ui-components/react/menu';
import { Bot, Braces, FileJson, MoreHorizontal, Pencil, RotateCcw, Sparkles } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import type { ActionInput } from '@ruimte/actions';
import { DEFAULT_NODE_TONE } from '@ruimte/diagram';
import { GRID, type Point } from '@/canvas/math';
import { useWheelCamera } from '@/canvas/use-wheel-camera';
import { DiagramDock } from '@/diagram/DiagramDock';
import { DiagramScene } from '@/diagram/DiagramScene';
import { exampleDiagram } from '@/diagram/example';
import { runAsPerson } from '@/actions/client-actions';
import { copyDiagram, openDiagramJson } from '@/diagram/diagram-actions';
import { askAgentAboutDiagram } from '@/project/views';
import { Swatches } from '@/drawing/DrawingDock';
import { useFileToolbarSlot } from '@/shell/panels/file-toolbar-slot';
import { useDiagram, useDiagramStore } from '@/state/diagram';
import { useProject } from '@/state/project';
import { MENU_LABEL, MENU_SEPARATOR } from '@/ui/classes';
import { isInFloatingLayer } from '@/ui/floating';
import { Icon } from '@/ui/Icon';
import { Tile } from '@/ui/Tile';
import { Tooltip } from '@/ui/Tooltip';

const isChrome = (target: EventTarget | null): boolean =>
    isInFloatingLayer(target) || (target instanceof Element && target.closest('[data-diagram-chrome]') !== null);

/* Screen pixels a press on a node may travel before it is a drag rather than a click. */
const DRAG_THRESHOLD = 3;

/* The node a pointer event landed on, by the mark `DiagramScene` puts on every node. */
const nodeIdAt = (target: EventTarget | null): string | null =>
    target instanceof Element ? (target.closest('[data-diagram-node]')?.getAttribute('data-diagram-node') ?? null) : null;

/* A press on a node: where it started on screen and where the node stood, so a drag moves it by the difference. */
interface NodeDrag {
    id: string;
    from: Point;
    origin: Point;
    moved: boolean;
}

/*
 * What a diagram can be asked from the bar above it: the way to its JSON file. The zoom and the
 * exports are in the dock. Portaled into the bar of the view or the cell, so it reads the store of
 * the cell it belongs to.
 */
function DiagramControls({ viewId }: { viewId: string }) {
    const { t } = useTranslation('drawing');
    const store = useDiagramStore();
    // A diagram nobody wrote has no file yet, so there is nothing to open.
    const written = useDiagram((s) => s.rev > 0);
    const hasFolder = useProject((s) => s.current?.folder != null);
    return (
        <Menu.Root>
            <Tooltip label={t('common:action.more')} name>
                <Menu.Trigger className="icon-btn h-7 w-7">
                    <Icon icon={MoreHorizontal} size={14} />
                </Menu.Trigger>
            </Tooltip>
            <Menu.Portal>
                <Menu.Positioner className="z-(--z-popup)" side="bottom" align="end" sideOffset={6}>
                    <Menu.Popup className="menu-popup min-w-52">
                        <Menu.Item className="menu-item" disabled={!hasFolder || !written} onClick={() => openDiagramJson(viewId)}>
                            <Icon icon={FileJson} size={14} /> {t('diagram.openJson')}
                        </Menu.Item>
                        <Menu.Item className="menu-item" onClick={() => copyDiagram(store, 'json')}>
                            <Icon icon={Braces} size={14} /> {t('diagram.copyJson')}
                        </Menu.Item>
                    </Menu.Popup>
                </Menu.Positioner>
            </Menu.Portal>
        </Menu.Root>
    );
}

/* The label of one node, typed over the box it names; Enter or leaving the field keeps it, Escape does not. */
function RenameField({ id, onDone }: { id: string; onDone: () => void }) {
    const { t } = useTranslation('drawing');
    const store = useDiagramStore();
    const camera = useDiagram(useShallow((s) => s.camera));
    const box = useDiagram((s) => s.layout.nodes.find((candidate) => candidate.id === id) ?? null);
    const label = useDiagram((s) => s.content.nodes.find((candidate) => candidate.id === id)?.label ?? '');
    const done = useRef(false);
    if (box === null) {
        return null;
    }
    const finish = (value: string | null): void => {
        // Enter blurs the field on its way out, which would otherwise commit a second time.
        if (done.current) {
            return;
        }
        done.current = true;
        const viewId = store.getState().viewId;
        if (value !== null && viewId !== null) {
            void runAsPerson('diagram.updateNode', { viewId, diagramNodeId: id, label: value, tone: null });
        }
        onDone();
    };
    const width = Math.max(Math.round(box.w * camera.zoom), 120);
    return (
        <input
            data-diagram-chrome
            autoFocus
            defaultValue={label}
            aria-label={t('diagram.nodeLabel')}
            className="absolute h-7 rounded-md bg-surface-sunken px-1.5 text-center text-sm font-medium text-text outline-none ring-1 ring-accent"
            style={{
                left: Math.round(camera.x + (box.x + box.w / 2) * camera.zoom - width / 2),
                top: Math.round(camera.y + (box.y + box.h / 2) * camera.zoom - 14),
                width
            }}
            onFocus={(e) => e.currentTarget.select()}
            onKeyDown={(e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    finish(e.currentTarget.value);
                } else if (e.key === 'Escape') {
                    e.preventDefault();
                    e.stopPropagation();
                    finish(null);
                }
            }}
            onBlur={(e) => finish(e.currentTarget.value)}
        />
    );
}

/* What a right-click on a node offers: its label, its tone and the way back to where the layout puts it. */
function NodeMenuPopup({ id, onRename }: { id: string; onRename: () => void }) {
    const { t } = useTranslation('drawing');
    const store = useDiagramStore();
    const node = useDiagram((s) => s.content.nodes.find((candidate) => candidate.id === id) ?? null);
    if (node === null) {
        return null;
    }
    const run = <Name extends 'diagram.updateNode' | 'diagram.resetPosition'>(name: Name, input: Omit<ActionInput<Name>, 'viewId'>): void => {
        const viewId = store.getState().viewId;
        if (viewId !== null) {
            void runAsPerson(name, { ...input, viewId } as ActionInput<Name>);
        }
    };
    return (
        <ContextMenu.Portal>
            <ContextMenu.Positioner className="z-(--z-popup)">
                <ContextMenu.Popup className="menu-popup">
                    <ContextMenu.Item className="menu-item" onClick={onRename}>
                        <Icon icon={Pencil} size={14} /> {t('common:action.rename')}
                    </ContextMenu.Item>
                    <ContextMenu.Separator className={MENU_SEPARATOR} />
                    <div className={MENU_LABEL}>{t('diagram.tone')}</div>
                    <Swatches
                        value={node.tone ?? DEFAULT_NODE_TONE}
                        onPick={(tone) => run('diagram.updateNode', { diagramNodeId: id, label: null, tone })}
                        paper
                    />
                    <ContextMenu.Separator className={MENU_SEPARATOR} />
                    <ContextMenu.Item className="menu-item" disabled={!node.pos} onClick={() => run('diagram.resetPosition', { diagramNodeId: id })}>
                        <Icon icon={RotateCcw} size={14} /> {t('diagram.resetPosition')}
                    </ContextMenu.Item>
                </ContextMenu.Popup>
            </ContextMenu.Positioner>
        </ContextMenu.Portal>
    );
}

/*
 * What an empty diagram offers: an agent to write it, its file to write it by hand, or an example to
 * start from. It stands over the paper outside the gestures (`data-diagram-chrome`), so a press on a
 * tile is a click and not the start of a pan, and it goes the moment the diagram has a node.
 */
function EmptyDiagram({ viewId }: { viewId: string }) {
    const { t } = useTranslation('drawing');
    const store = useDiagramStore();
    const written = useDiagram((s) => s.rev > 0);
    const hasFolder = useProject((s) => s.current?.folder != null);
    return (
        <div className="pointer-events-none absolute inset-0 grid place-items-center px-6 pt-6 pb-20">
            <div data-diagram-chrome className="pointer-events-auto flex w-full max-w-md flex-col gap-2">
                <p className="pb-2 text-center text-sm text-text-muted">{t('diagram.empty.description')}</p>
                <Tile
                    icon={<Icon icon={Bot} size={16} />}
                    title={t('diagram.empty.agent.title')}
                    description={t('diagram.empty.agent.description')}
                    primary
                    onClick={() => askAgentAboutDiagram(viewId)}
                />
                {hasFolder && written && (
                    <Tile
                        icon={<Icon icon={FileJson} size={16} />}
                        title={t('diagram.empty.json.title')}
                        description={t('diagram.empty.json.description')}
                        onClick={() => openDiagramJson(viewId)}
                    />
                )}
                <Tile
                    icon={<Icon icon={Sparkles} size={16} />}
                    title={t('diagram.empty.example.title')}
                    description={t('diagram.empty.example.description')}
                    onClick={() =>
                        void runAsPerson('diagram.replaceContent', { viewId, document: JSON.stringify(exampleDiagram(store.getState().content.meta.title)) })
                    }
                />
            </div>
        </div>
    );
}

/*
 * A diagram on screen, as SVG in the DOM rather than on a canvas: a few dozen boxes with text in
 * them, where the DOM gives text rendering and selection for nothing. A person pans, zooms, drags a
 * node to where it should stand, renames it and gives it a tone; the graph itself is written, by hand
 * in its file or by an agent.
 */
export function DiagramView({ id }: { id: string }) {
    const { t } = useTranslation('drawing');
    /* The editor of this cell, never the focused one: two diagrams can stand side by side. */
    const store = useDiagramStore();
    const rootRef = useRef<HTMLDivElement>(null);
    const panFrom = useRef<Point | null>(null);
    const drag = useRef<NodeDrag | null>(null);
    const [gesture, setGesture] = useState<'pan' | 'drag' | null>(null);
    const [renaming, setRenaming] = useState<string | null>(null);
    const [menuNode, setMenuNode] = useState<string | null>(null);
    const camera = useDiagram(useShallow((s) => s.camera));
    const content = useDiagram((s) => s.content);
    const layout = useDiagram((s) => s.layout);
    const viewId = useDiagram((s) => s.viewId);
    const { host } = useFileToolbarSlot();

    useLayoutEffect(() => {
        const root = rootRef.current;
        if (!root) {
            return;
        }
        const observer = new ResizeObserver(([entry]) => {
            store.getState().setViewport({ w: entry!.contentRect.width, h: entry!.contentRect.height });
        });
        observer.observe(root);
        return () => observer.disconnect();
    }, [store]);

    useWheelCamera(rootRef, store);

    const onPointerDown = (e: React.PointerEvent<HTMLDivElement>): void => {
        // Portaled controls still bubble here; capturing their pointer would consume the click.
        if ((e.button !== 0 && e.button !== 1) || !e.currentTarget.contains(e.target as Node) || isChrome(e.target)) {
            return;
        }
        const nodeId = e.button === 0 ? nodeIdAt(e.target) : null;
        const box = nodeId === null ? undefined : store.getState().layout.nodes.find((candidate) => candidate.id === nodeId);
        e.currentTarget.setPointerCapture(e.pointerId);
        if (nodeId !== null && box) {
            drag.current = { id: nodeId, from: { x: e.clientX, y: e.clientY }, origin: { x: box.x, y: box.y }, moved: false };
            setGesture('drag');
            return;
        }
        panFrom.current = { x: e.clientX, y: e.clientY };
        setGesture('pan');
    };

    const onPointerMove = (e: React.PointerEvent<HTMLDivElement>): void => {
        const moving = drag.current;
        if (moving !== null) {
            const dx = e.clientX - moving.from.x;
            const dy = e.clientY - moving.from.y;
            if (!moving.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) {
                return;
            }
            const { zoom } = store.getState().camera;
            // The node leaves its layer the moment it moves; the rest of the layout closes up behind it.
            store.getState().moveNode(moving.id, [moving.origin.x + dx / zoom, moving.origin.y + dy / zoom], !moving.moved);
            moving.moved = true;
            return;
        }
        const from = panFrom.current;
        if (from === null) {
            return;
        }
        store.getState().panBy(e.clientX - from.x, e.clientY - from.y);
        panFrom.current = { x: e.clientX, y: e.clientY };
    };

    const onPointerUp = (): void => {
        panFrom.current = null;
        drag.current = null;
        setGesture(null);
    };

    const onDoubleClick = (e: React.MouseEvent<HTMLDivElement>): void => {
        const nodeId = isChrome(e.target) ? null : nodeIdAt(e.target);
        if (nodeId !== null) {
            setRenaming(nodeId);
        }
    };

    const gridStep = GRID * 3 * camera.zoom;
    // Nothing to say until the file has been read, or an empty diagram would flash before a full one.
    const empty = viewId === id && content.nodes.length === 0;
    return (
        <div
            ref={rootRef}
            className="relative h-full w-full touch-none overflow-hidden bg-canvas-bg bg-[image:radial-gradient(circle,var(--canvas-dot)_1px,transparent_1px)]"
            style={{
                backgroundSize: `${gridStep}px ${gridStep}px`,
                backgroundPosition: `${camera.x}px ${camera.y}px`,
                cursor: gesture === 'pan' ? 'grabbing' : gesture === 'drag' ? 'move' : 'grab'
            }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onDoubleClick={onDoubleClick}
        >
            <ContextMenu.Root>
                <ContextMenu.Trigger
                    className="absolute inset-0"
                    onContextMenu={(e) => {
                        const nodeId = nodeIdAt(e.target);
                        // Only a node has a menu; a right-click on the paper opens nothing.
                        if (nodeId === null) {
                            e.preventDefault();
                            e.stopPropagation();
                            return;
                        }
                        setMenuNode(nodeId);
                    }}
                >
                    <svg
                        className="h-full w-full select-none"
                        role="img"
                        aria-label={content.meta.title || t('diagram.title')}
                        style={{ fontFamily: 'var(--font-sans)' }}
                    >
                        <g transform={`translate(${camera.x} ${camera.y}) scale(${camera.zoom})`}>
                            <DiagramScene content={content} layout={layout} interactive />
                        </g>
                    </svg>
                </ContextMenu.Trigger>
                {menuNode !== null && <NodeMenuPopup id={menuNode} onRename={() => setRenaming(menuNode)} />}
            </ContextMenu.Root>
            {empty && <EmptyDiagram viewId={id} />}
            {renaming !== null && <RenameField key={renaming} id={renaming} onDone={() => setRenaming(null)} />}
            <DiagramDock />
            {host !== null && createPortal(<DiagramControls viewId={id} />, host)}
        </div>
    );
}

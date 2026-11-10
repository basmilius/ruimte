import { DEFAULT_NODE_TONE } from '@adecore/diagram';
import { Button, EmptyState, isInFloatingLayer, Icon, IconButton, Input, ContextMenu, Menu } from '@adecore/ui';
import type { ActionInput } from '@ruimte/actions';
import { Bot, Braces, FileJson, MoreHorizontal, Pencil, RotateCcw } from 'lucide-react';
import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import { ignoreRefusal, perform } from '@/action-port/perform';
import { groundPlacement, type Point } from '@/canvas-model/math';
import { copyDiagram, openDiagramJson } from '@/diagram/diagram-actions';
import { DiagramDock } from '@/diagram/DiagramDock';
import { DiagramScene } from '@/diagram/DiagramScene';
import { Swatches } from '@/drawing/DrawingDock';
import { useViewportSize } from '@/drawing/use-viewport-size';
import { askAgentAboutDiagram } from '@/project/views';
import { useDiagram, useDiagramStore } from '@/state/diagram';
import { useProject } from '@/state/project';
import { useWheelCamera } from '@/surface/canvas/use-wheel-camera';
import { useFileToolbarSlot } from '@/surface/panels/file-toolbar-slot';
import { EmptyDiagramScene } from '@/ui/EmptyScenes';

function isChrome(target: EventTarget | null): boolean {
    return isInFloatingLayer(target) || (target instanceof Element && target.closest('[data-diagram-chrome]') !== null);
}

/* Screen pixels a press on a node may travel before it is a drag rather than a click. */
const DRAG_THRESHOLD = 3;

/* The node a pointer event landed on, by the mark `DiagramScene` puts on every node. */
function nodeIdAt(target: EventTarget | null): string | null {
    return target instanceof Element ? (target.closest('[data-diagram-node]')?.getAttribute('data-diagram-node') ?? null) : null;
}

/* A press on a node: where it started on screen and where the node stood, so a drag moves it by the difference. */
interface NodeDrag {
    id: string;
    from: Point;
    origin: Point;
    moved: boolean;
}

/* Portaled into the bar of the view or the cell, so it reads the store of the cell it belongs to. */
function DiagramControls({ viewId }: { viewId: string }) {
    const { t } = useTranslation('drawing');
    const store = useDiagramStore();
    // A diagram nobody wrote has no file yet, so there is nothing to open.
    const written = useDiagram((s) => s.rev > 0);
    const hasFolder = useProject((s) => s.current?.folder != null);
    return (
        <Menu.Root>
            <IconButton render={<Menu.Trigger />} icon={MoreHorizontal} size="sm" label={t('common:action.more')} />
            <Menu.Popup align="end" className="min-w-52">
                <Menu.Item disabled={!hasFolder || !written} onClick={() => openDiagramJson(viewId)}>
                    <Icon icon={FileJson} size={14} /> {t('diagram.openJson')}
                </Menu.Item>
                <Menu.Item onClick={() => copyDiagram(store, 'json')}>
                    <Icon icon={Braces} size={14} /> {t('diagram.copyJson')}
                </Menu.Item>
            </Menu.Popup>
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
            void perform('diagram.updateNode', { viewId, diagramNodeId: id, label: value, tone: null }).catch(ignoreRefusal);
        }
        onDone();
    };
    const width = Math.max(Math.round(box.w * camera.zoom), 120);
    return (
        <Input
            data-diagram-chrome
            autoFocus
            defaultValue={label}
            aria-label={t('diagram.nodeLabel')}
            size="sm"
            className="absolute text-center text-sm font-medium"
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
            void perform(name, { ...input, viewId } as ActionInput<Name>).catch(ignoreRefusal);
        }
    };
    return (
        <ContextMenu.Popup>
            <ContextMenu.Item onClick={onRename}>
                <Icon icon={Pencil} size={14} /> {t('common:action.rename')}
            </ContextMenu.Item>
            <ContextMenu.Separator />
            <ContextMenu.Label>{t('diagram.tone')}</ContextMenu.Label>
            <Swatches value={node.tone ?? DEFAULT_NODE_TONE} onPick={(tone) => run('diagram.updateNode', { diagramNodeId: id, label: null, tone })} paper />
            <ContextMenu.Separator />
            <ContextMenu.Item disabled={!node.pos} onClick={() => run('diagram.resetPosition', { diagramNodeId: id })}>
                <Icon icon={RotateCcw} size={14} /> {t('diagram.resetPosition')}
            </ContextMenu.Item>
        </ContextMenu.Popup>
    );
}

/*
 * What an empty diagram offers: an agent to write it. It stands over the paper outside the gestures
 * (`data-diagram-chrome`), so a press on the button is a click and not the start of a pan, and it goes
 * the moment the diagram has a node.
 */
function EmptyDiagram({ viewId }: { viewId: string }) {
    const { t } = useTranslation('drawing');
    return (
        <div className="pointer-events-none absolute inset-0 grid place-items-center px-6 pt-6 pb-20">
            <div data-diagram-chrome className="pointer-events-auto">
                <EmptyState
                    scene={<EmptyDiagramScene />}
                    title={t('diagram.empty.title')}
                    action={
                        <Button size="sm" variant="secondary" onClick={() => askAgentAboutDiagram(viewId)}>
                            <Icon icon={Bot} size={14} /> {t('diagram.empty.agent')}
                        </Button>
                    }
                >
                    {t('diagram.empty.description')}
                </EmptyState>
            </div>
        </div>
    );
}

/*
 * SVG in the DOM rather than a canvas: a few dozen boxes with text, where the DOM gives text rendering
 * and selection for nothing. A person only moves, renames and tones nodes; the graph itself is written
 * in its file, by hand or by an agent.
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

    useViewportSize(rootRef, store);
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

    // Nothing to say until the file has been read, or an empty diagram would flash before a full one.
    const empty = viewId === id && content.nodes.length === 0;
    return (
        <div
            ref={rootRef}
            className="canvas-ground relative h-full w-full touch-none overflow-hidden"
            style={{
                ...groundPlacement(camera),
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

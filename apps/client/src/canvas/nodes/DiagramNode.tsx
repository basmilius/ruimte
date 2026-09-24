import { useMemo } from 'react';
import { Workflow } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { layoutOf } from '@ruimte/diagram';
import { DiagramScene } from '@/diagram/DiagramScene';
import { useDiagramMirror } from '@/diagram/mirror';
import { showView } from '@/project/views';
import { useCanvas } from '@/state/canvas';
import { EmptyState } from '@/ui/EmptyState';
import { Icon } from '@/ui/Icon';

/* World units of air around a mirrored diagram, so nothing touches the frame. */
const PADDING = 24;

/* What a diagram node draws far out or under the readable zoom: its mark and its name, and no read. */
export function DiagramPlate({ id }: { id: string }) {
    const title = useCanvas((s) => s.nodes[id]?.title ?? '');
    return (
        <div className="flex h-full w-full items-center justify-center gap-2 px-4 text-text-faint" aria-hidden="true">
            <Icon icon={Workflow} size={20} />
            <span className="truncate text-sm">{title}</span>
        </div>
    );
}

/*
 * A diagram view on a canvas: the same file, laid out and scaled to fit, never edited here. The SVG
 * takes no pointer, so a press drags the node; a double-click opens the view, where a diagram is edited.
 */
export function DiagramNode({ id }: { id: string }) {
    const { t } = useTranslation('canvas');
    const viewId = useCanvas((s) => s.nodes[id]?.viewId ?? null);
    const mirror = useDiagramMirror(viewId);
    const content = mirror?.snapshot ?? null;
    const layout = useMemo(() => (content === null ? null : layoutOf(content)), [content]);
    const drawn = content !== null && layout !== null && content.nodes.length > 0;
    const box = layout?.bounds;

    return (
        <div className="h-full w-full" onDoubleClick={() => viewId && showView(viewId)}>
            {mirror?.gone && (
                <EmptyState icon={Workflow} className="h-full">
                    {t('diagram.gone')}
                </EmptyState>
            )}
            {/* No "being written" state: the daemon cannot know an agent is about to write one. */}
            {!mirror?.gone && !drawn && !mirror?.loading && (
                <EmptyState icon={Workflow} className="h-full">
                    {t('diagram.empty')}
                </EmptyState>
            )}
            {drawn && box && (
                <svg
                    className="pointer-events-none h-full w-full select-none"
                    viewBox={`${box.x - PADDING} ${box.y - PADDING} ${box.w + PADDING * 2} ${box.h + PADDING * 2}`}
                    preserveAspectRatio="xMidYMid meet"
                    role="img"
                    aria-label={content.meta.title || t('diagram.label')}
                    style={{ fontFamily: 'var(--font-sans)' }}
                >
                    <DiagramScene content={content} layout={layout} />
                </svg>
            )}
        </div>
    );
}

import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { X } from 'lucide-react';
import { hasOverlayControls } from '@/desktop/bridge';
import { FlowInspector } from '@/flow/FlowInspector';
import { FlowRuns } from '@/flow/FlowRuns';
import { cardLabel } from '@/flow/labels';
import { toggleFlowRuns } from '@/flow/panel-watch';
import { useFlowState } from '@/flow/use-flow-state';
import { SlidingColumn } from '@/shell/SlidingColumn';
import { clampColumnSize } from '@/shell/useColumnResize';
import { useFlow, useFlowStore } from '@/state/flow';
import { useUi } from '@/state/ui';
import { ErrorBoundary } from '@/ui/ErrorBoundary';
import { Icon } from '@/ui/Icon';
import { Tooltip } from '@/ui/Tooltip';

/* A card is 320 wide, so a column that shows what is on one starts there. */
const MIN_WIDTH = 320;
const DEFAULT_WIDTH = 380;

// The grid beside the column keeps at least this much, the same floor the preview keeps.
const MIN_GRID_WIDTH = 360;

/*
 * The column beside a worksheet: what the card you picked holds, or what the flow has done. It is a
 * column and not a card floating over the canvas, because the fields of a card are a form and a form
 * wants the room a column gives it, and because the runs underneath it are a list with no end.
 *
 * Whether it is open is not its own business: `flow/panel-watch.ts` decides that from what is picked
 * on the worksheet, the same way the file tabs decide over the preview.
 */
export function FlowPanel() {
    const { t } = useTranslation('flow');
    const open = useUi((s) => s.flowPanel.open);
    const stored = useUi((s) => s.flowWidth);
    const rightOfIt = useUi((s) => s.preview.open || s.panel.open);
    const store = useFlowStore();
    const viewId = useFlow((s) => s.viewId);
    const content = useFlow((s) => s.content);
    const selection = useFlow((s) => s.selection);
    const flow = useFlowState(viewId ?? '');

    const cardId = selection.length === 1 ? (selection[0] as string) : null;
    const card = cardId === null ? undefined : content.cards[cardId];
    const bounds = { min: MIN_WIDTH, max: (): number => window.innerWidth - MIN_GRID_WIDTH };
    // The project may have been on a wider window than this one, so its width is clamped on the way in.
    const width = clampColumnSize(bounds, stored ?? DEFAULT_WIDTH);

    return (
        <SlidingColumn open={open} width={width} bounds={bounds} onWidth={(next) => useUi.getState().setFlowWidth(next)}>
            <header
                className={clsx(
                    'app-drag flex h-12 shrink-0 items-center gap-2 border-b border-border pr-2 pl-3',
                    open && !rightOfIt && hasOverlayControls() && 'toolbar-overlay-inset'
                )}
            >
                <span className="min-w-0 grow truncate text-xs font-medium text-text-muted">{card === undefined ? t('runs.title') : cardLabel(t, card)}</span>
                <Tooltip label={t('panel.close')} name>
                    <button
                        type="button"
                        className="icon-btn shrink-0"
                        onClick={() => {
                            /* A card is let go rather than the column closed: the worksheet owns whether
                               the column is there, and letting the card go is what a person means. */
                            if (cardId !== null) {
                                store.getState().select([]);
                            } else {
                                toggleFlowRuns();
                            }
                        }}
                    >
                        <Icon icon={X} size={16} />
                    </button>
                </Tooltip>
            </header>
            {/* The header stays, so the column can still be closed when what is in it fails to draw. */}
            <ErrorBoundary label={t('panel.failed')} resetKeys={[viewId, cardId]} className="min-h-0 grow overflow-y-auto">
                {cardId !== null && card !== undefined ? (
                    <FlowInspector id={cardId} card={card} content={content} flow={flow} />
                ) : (
                    <FlowRuns
                        content={content}
                        runs={flow.runs}
                        onRunAgain={(run) => void flow.test({ from: run.trigger as string, scope: 'graph', dry: true, tokens: run.tokens })}
                    />
                )}
            </ErrorBoundary>
        </SlidingColumn>
    );
}

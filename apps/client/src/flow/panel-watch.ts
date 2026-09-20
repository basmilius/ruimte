import { defaultFlows, subscribeFlows } from '@/state/flow';
import { useUi, type FlowPanelState } from '@/state/ui';

/*
 * What the column beside a worksheet comes to. The same rule the file tabs keep over the preview: the
 * surface a person works in decides whether its column is there, so nothing else ever has to remember
 * to close it. One card picked is about filling that card in, so the column opens on it. Two picked is
 * about moving them and none is about the worksheet as a whole, so it falls back to whoever asked to
 * see the runs, and closes when nobody did.
 */
export const flowPanelFor = (current: FlowPanelState, picked: number, onFlow: boolean): FlowPanelState => {
    if (!onFlow) {
        return { open: false, runs: current.runs };
    }
    return { open: picked === 1 || current.runs, runs: current.runs };
};

const settle = (): void => {
    const viewId = defaultFlows.focused();
    const flow = viewId === null ? null : (defaultFlows.peek(viewId)?.getState() ?? null);
    const onFlow = flow !== null && flow.viewId !== null;
    useUi.getState().setFlowPanel(flowPanelFor(useUi.getState().flowPanel, flow?.selection.length ?? 0, onFlow));
};

/* The runs are a standing wish: with a card picked the column still shows the card, and letting the
   card go comes back to the runs. */
export const toggleFlowRuns = (): void => {
    const ui = useUi.getState();
    const viewId = defaultFlows.focused();
    const flow = viewId === null ? null : (defaultFlows.peek(viewId)?.getState() ?? null);
    const onFlow = flow !== null && flow.viewId !== null;
    ui.setFlowPanel(flowPanelFor({ ...ui.flowPanel, runs: !ui.flowPanel.runs }, flow?.selection.length ?? 0, onFlow));
};

export const startFlowPanelWatch = (): (() => void) => {
    const offShape = defaultFlows.subscribeShape(settle);
    const offChange = subscribeFlows(settle);
    settle();
    return () => {
        offShape();
        offChange();
    };
};

import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useChatRow } from '@adecore/agents-react/state';
import { ErrorBoundary, LazyBoundary, lazyNamed } from '@adecore/ui';
import { useRemoteNodeState } from '@/canvas/remote-node-state';
import { useUntakenTask } from '@/canvas/remote-wait';
import { workflowCandidates } from '@/chat/workflow/beside-workflows';
import { forgetWorkflowBeside } from '@/chat/workflow/workflow-beside-state';
import { useCanvas, type CanvasNode } from '@/state/canvas';
import { useEndpoints } from '@/state/endpoints';
import { useWorkspace } from '@/transport/connections';
import { NodeMachineScope } from '@/transport/node-machine';

const RoutineBeside = lazyNamed(() => import('@/routines/RoutineBeside'), 'RoutineBeside');
const WorkflowBeside = lazyNamed(() => import('@/chat/workflow/WorkflowBeside'), 'WorkflowBeside');

/*
 * What the canvas draws beside a node from that node's data, never stored and never a node in the
 * store: a routine's runs and its Output, and the workflow a chat runs. They follow the node, so
 * selection, lines a person draws and layouts never see them (`DerivedSet`, `derivedOwnerOf`); the
 * minimap, the resize handles and the keys know them only through `derivedCards`.
 */
export function DerivedCards({ stacking }: { stacking: Readonly<Record<string, number>> }) {
    const { t } = useTranslation('canvas');
    const nodes = useCanvas((s) => s.nodes);
    const hidden = useCanvas((s) => s.hidden);
    const viewId = useCanvas((s) => s.viewId);
    const owners = Object.values(nodes).filter((node) => (node.kind === 'routine' || node.kind === 'chat') && !hidden.has(node.id));
    // What a window chose beside a chat node goes with the node; a hidden one keeps it for when its group opens.
    useEffect(() => {
        forgetWorkflowBeside((key) => {
            const [, view, node] = key.split('\n');
            return view === viewId && nodes[node ?? ''] === undefined;
        });
    }, [nodes, viewId]);
    return owners.map((node) => (
        <ErrorBoundary key={node.id} label={t('node.failed')} compact>
            <LazyBoundary>
                {node.kind === 'routine' ? (
                    <RoutineBeside id={node.id} z={stacking[node.id] ?? 1} />
                ) : (
                    <NodeMachineScope machine={node.machine}>
                        <ChatBeside node={node} z={stacking[node.id] ?? 1} />
                    </NodeMachineScope>
                )}
            </LazyBoundary>
        </ErrorBoundary>
    ));
}

/*
 * A chat node's workflow, read from the machine the node runs on. `NodeMachineScope` falls back to the
 * workspace's own machine for one this client does not know, so such a node, one whose machine refuses
 * it and one whose chat was not started there draw nothing rather than another machine's chat. A known
 * machine that is only away keeps the cards, which then say they are not up to date.
 */
function ChatBeside({ node, z }: { node: CanvasNode; z: number }) {
    const machine = node.machine;
    const workspaceId = useWorkspace()?.connection.endpointId;
    const remote = useRemoteNodeState(machine, workspaceId);
    const known = useEndpoints((s) => machine === undefined || s.endpoints.some((row) => row.id === machine || row.daemonId === machine));
    const unstarted = useUntakenTask(node.id, machine);
    // Asked here, before the cards' chunk, so a canvas whose chats run no workflow never loads it.
    const runsWorkflow = useChatRow(node.id, (row) => row !== undefined && workflowCandidates(row).length > 0);
    if (!runsWorkflow) {
        return null;
    }
    if (machine !== undefined && (!known || remote === 'unlinked' || remote === 'too-old' || unstarted !== null)) {
        return null;
    }
    return <WorkflowBeside id={node.id} z={z} />;
}

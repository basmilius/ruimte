import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Dialog, FieldHint, FormError, Select, messageOf } from '@adecore/ui';
import type { AgentBridge, RemoteLink, RequestMap } from '@ruimte/contracts';
import { ensureMachine } from '@/endpoint/reach';
import { linkToPeer } from '@/project/peer-linker';
import { endpointById } from '@/state/endpoints';
import { useProject } from '@/state/project';
import { useUi } from '@/state/ui';
import { machineIdOf } from '@/shell/settings/machine-list';
import { transportFor } from '@/transport';
import { machineAnswers } from '@/transport/features';

type Candidate = RequestMap['bridge.candidates']['result']['agents'][number];
type Request = NonNullable<ReturnType<typeof useUi.getState>['agentBridgeDialog']>;

export function AgentBridgeDialog() {
    const request = useUi((s) => s.agentBridgeDialog);
    const close = (): void => useUi.getState().setAgentBridgeDialog(null);
    return (
        <Dialog.Root
            open={request !== null}
            onOpenChange={(open) => {
                if (!open) {
                    close();
                }
            }}
        >
            <Dialog.Popup size="sm">
                {request !== null && <BridgeForm key={`${request.endpointId}:${request.nodeId}`} request={request} onDone={close} />}
            </Dialog.Popup>
        </Dialog.Root>
    );
}

function BridgeForm({ request, onDone }: { request: Request; onDone(): void }) {
    const { t } = useTranslation('canvas');
    const project = useProject((s) => s.current);
    const [machines, setMachines] = useState<RemoteLink[]>([]);
    const [bridges, setBridges] = useState<AgentBridge[]>([]);
    const [machineId, setMachineId] = useState('');
    const [agents, setAgents] = useState<Candidate[]>([]);
    const [nodeId, setNodeId] = useState('');
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [failure, setFailure] = useState('');
    const machine = machines.find((row) => row.machineId === machineId) ?? null;
    const here = transportFor(request.endpointId);

    useEffect(() => {
        let active = true;
        if (here === null || project === null) {
            return;
        }
        if (!machineAnswers(here.connection, 'bridge.bind')) {
            return;
        }
        Promise.all([here.request('remote.list', { projectId: project.projectId }), here.request('bridge.list', { nodeId: request.nodeId })]).then(
            ([remote, connections]) => {
                if (!active) {
                    return;
                }
                setMachines(remote.links);
                setMachineId(remote.links[0]?.machineId ?? '');
                setBridges(connections.bridges);
                setLoading(remote.links.length > 0);
            },
            (error: unknown) => {
                if (active) {
                    setFailure(messageOf(error));
                    setLoading(false);
                }
            }
        );
        return () => {
            active = false;
        };
    }, [here, project, request.nodeId, t]);

    useEffect(() => {
        if (machine === null) {
            return;
        }
        const controller = new AbortController();
        const load = async (): Promise<void> => {
            try {
                const endpointId = await ensureMachine(machine.machineId, controller.signal);
                const there = transportFor(endpointId)!;
                if (!machineAnswers(there.connection, 'bridge.bind')) {
                    throw new Error(t('agentBridge.update'));
                }
                const result = await there.request('bridge.candidates', { projectId: machine.remoteProjectId });
                if (!controller.signal.aborted) {
                    setAgents(result.agents);
                    setNodeId(result.agents[0]?.nodeId ?? '');
                }
            } catch (error) {
                if (!controller.signal.aborted) {
                    setFailure(messageOf(error));
                }
            } finally {
                if (!controller.signal.aborted) {
                    setLoading(false);
                }
            }
        };
        void load();
        return () => controller.abort();
    }, [machine, t]);

    const connect = async (): Promise<void> => {
        if (here === null || project === null || machine === null || nodeId === '') {
            return;
        }
        setBusy(true);
        setFailure('');
        const id = crypto.randomUUID();
        let remoteBound = false;
        let there: ReturnType<typeof transportFor> = null;
        try {
            there = transportFor(await ensureMachine(machine.machineId));
            if (there === null) {
                throw new Error(t('agentBridge.unreachable'));
            }
            const self = endpointById(request.endpointId)!;
            // Both daemons obtain peer admission through the person's account; neither receives the account token.
            await linkToPeer(machine.machineId, here);
            await linkToPeer(machineIdOf(self), there);
            await there.request('bridge.bind', {
                id,
                projectId: machine.remoteProjectId,
                nodeId,
                machineId: machineIdOf(self),
                remoteNodeId: request.nodeId,
                label: `${request.title} (${self.label})`.slice(0, 240)
            });
            remoteBound = true;
            const bridge: AgentBridge = {
                id,
                projectId: project.projectId,
                nodeId: request.nodeId,
                machineId: machine.machineId,
                remoteNodeId: nodeId,
                label: `${agents.find((agent) => agent.nodeId === nodeId)?.title ?? ''} (${machine.label})`.slice(0, 240)
            };
            await here.request('bridge.bind', bridge);
            setBridges((before) => [...before, bridge]);
        } catch (error) {
            if (remoteBound && there !== null) {
                await there.request('bridge.remove', { id }).catch(() => undefined);
            }
            setFailure(messageOf(error));
        } finally {
            setBusy(false);
        }
    };

    const disconnect = async (bridge: AgentBridge): Promise<void> => {
        if (here === null) {
            return;
        }
        setBusy(true);
        setFailure('');
        try {
            await here.request('bridge.remove', { id: bridge.id });
            setBridges((before) => before.filter((row) => row.id !== bridge.id));
            // Revocation here is immediate even while the other machine is offline.
            const there = transportFor(await ensureMachine(bridge.machineId));
            await there?.request('bridge.remove', { id: bridge.id });
        } catch (error) {
            setFailure(messageOf(error));
        } finally {
            setBusy(false);
        }
    };

    return (
        <>
            <Dialog.Title>{t('agentBridge.title')}</Dialog.Title>
            <Dialog.Text className="mt-2">{t('agentBridge.description', { agent: request.title })}</Dialog.Text>
            <div className="mt-4 flex flex-col gap-3">
                {bridges.map((bridge) => (
                    <div key={bridge.id} className="flex items-center justify-between gap-3">
                        <span className="text-sm">{bridge.label}</span>
                        <Button variant="secondary" disabled={busy} onClick={() => void disconnect(bridge)}>
                            {t('agentBridge.disconnect')}
                        </Button>
                    </div>
                ))}
                {machines.length > 0 ? (
                    <>
                        <Select
                            label={t('agentBridge.machine')}
                            value={machineId}
                            onValueChange={(value) => {
                                setMachineId(value);
                                setAgents([]);
                                setNodeId('');
                                setLoading(true);
                                setFailure('');
                            }}
                            disabled={busy}
                            items={machines.map((row) => ({ value: row.machineId, label: row.label }))}
                        />
                        {agents.length > 0 && (
                            <Select
                                label={t('agentBridge.agent')}
                                value={nodeId}
                                onValueChange={setNodeId}
                                disabled={busy}
                                items={agents.map((agent) => ({ value: agent.nodeId, label: `${agent.title} — ${agent.canvas}` }))}
                            />
                        )}
                        {!loading && agents.length === 0 && <FieldHint>{t('agentBridge.noAgents')}</FieldHint>}
                    </>
                ) : (
                    !loading && <FieldHint>{t('agentBridge.noMachines')}</FieldHint>
                )}
                <FieldHint>{t('agentBridge.rule')}</FieldHint>
                {failure !== '' && <FormError>{failure}</FormError>}
                {here !== null && !machineAnswers(here.connection, 'bridge.bind') && <FormError>{t('agentBridge.update')}</FormError>}
            </div>
            <Dialog.Footer>
                <Button variant="secondary" disabled={busy} onClick={onDone}>
                    {t('common:action.close')}
                </Button>
                <Button disabled={busy || loading || nodeId === ''} onClick={() => void connect()}>
                    {t('agentBridge.connect')}
                </Button>
            </Dialog.Footer>
        </>
    );
}

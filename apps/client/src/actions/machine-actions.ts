import { ActionRefusal, type ActionHandlers, type ActionOutput } from '@ruimte/actions';
import {
    totalTokensOf,
    type ComputerUseStatus,
    type DeviceOperated,
    type EndpointInfo,
    type ProcessAlert,
    type ProjectIconChoice,
    type ProcessesSampleEvent,
    type ProcessGroup,
    type UsageLimitsSnapshot,
    type UsageSummaryPayload,
    type UsageSummaryResult
} from '@ruimte/contracts';
import { asRefusal } from '@/actions/developer-actions';
import { localTimeZone } from '@adecore/ui/format';
import { useDeviceOperated } from '@/devices/operated';
import { projectNodes } from '@/project/view-nodes';
import { useComputer } from '@/state/computer';
import { currentEndpointId } from '@/state/keys';
import { useProcesses, useProcessWarnings } from '@/state/processes';
import { serverInfoOf } from '@/state/server';
import { dayOf, useUsageStore } from '@adecore/agents-react/state';
import { evenPace } from '@adecore/agents-react/usage';
import type { Transport } from '@/transport/transport';
import { transportFor } from '@/transport';
import { machineFor } from '@/transport/connections';
import { adoptEndpointInfo } from '@/transport/server-info';

type Requester = Pick<Transport, 'request'>;

/* What the process and usage actions reach outside the document; a test hands in a fake of each. */
export interface MachineReach {
    transport(): Requester | null;
    /* The last sample of the machine, which exists only while its processes panel measures. */
    sample(): ProcessesSampleEvent | null;
    alerts(): readonly ProcessAlert[];
    /* The plan windows this window already holds for the machine, or null before any read. */
    limits(): UsageLimitsSnapshot | null;
    /* Node titles by id, for a group or a warning that names a node. */
    titles(): ReadonlyMap<string, string>;
    now(): Date;
    timeZone(): string;
    /* Any machine this window has a link to, for what is set on that machine itself. */
    linkTo(endpointId: string): Requester | null;
    /* The name a person gave the machine, null for its own default name, and its icon. */
    identity(endpointId: string): { name: string | null; icon: ProjectIconChoice | null };
    adoptInfo(endpointId: string, info: EndpointInfo): void;
    adoptComputer(endpointId: string, status: ComputerUseStatus): void;
    adoptDevice(endpointId: string, operated: DeviceOperated): void;
}

const LIVE_MACHINE: MachineReach = {
    transport: () => machineFor(currentEndpointId())?.transport ?? null,
    sample: () => useProcesses.getState().byEndpoint[currentEndpointId()]?.sample ?? null,
    alerts: () => useProcessWarnings.getState().byEndpoint[currentEndpointId()] ?? [],
    limits: () => useUsageStore.getState().byScope[currentEndpointId()]?.limits ?? null,
    titles: () => new Map(projectNodes().map((node) => [node.id, node.title])),
    now: () => new Date(),
    timeZone: () => localTimeZone() ?? 'UTC',
    linkTo: transportFor,
    identity: (endpointId) => {
        const info = serverInfoOf(endpointId);
        // A machine nobody named answers to its own default, and sending that name back would make it chosen.
        return { name: info.nameSource === 'chosen' ? info.label : null, icon: info.icon };
    },
    adoptInfo: adoptEndpointInfo,
    adoptComputer: (endpointId, status) => useComputer.getState().setStatus(endpointId, status),
    adoptDevice: (endpointId, operated) => useDeviceOperated.getState().receive(endpointId, operated)
};

const DEFAULT_PROCESSES = 5;
const DEFAULT_DAYS = 7;
const TOP_ROWS = 8;

const GROUP_NAMES: Record<ProcessGroup['kind'], string> = {
    terminal: 'Terminal',
    chat: 'AI Chat',
    app: 'Ruimte',
    daemon: 'Ruimte machine',
    other: 'Everything else'
};

type UsageOutput = ActionOutput<'usage.summary'>;

/* Cost adds up only over what has a price, so a sum of unknowns stays unknown rather than zero. */
function addCost(total: number | null, cost: number | null): number | null {
    return cost === null ? total : (total ?? 0) + cost;
}

function usageOf(summary: UsageSummaryResult): UsageOutput {
    const providers = new Map<string, { tokens: number; costUsd: number | null }>();
    for (const model of summary.models) {
        const known = providers.get(model.provider) ?? { tokens: 0, costUsd: null };
        providers.set(model.provider, { tokens: known.tokens + totalTokensOf(model.totals), costUsd: addCost(known.costUsd, model.costUsd) });
    }
    const models = summary.models
        .map((model) => ({ provider: model.provider, model: model.model, tokens: totalTokensOf(model.totals), costUsd: model.costUsd }))
        .sort((left, right) => right.tokens - left.tokens);
    return {
        from: summary.from,
        to: summary.to,
        tokens: models.reduce((sum, model) => sum + model.tokens, 0),
        costUsd: models.reduce<number | null>((sum, model) => addCost(sum, model.costUsd), null),
        sessions: summary.sessions,
        providers: [...providers].map(([provider, totals]) => ({ provider: provider as UsageOutput['providers'][number]['provider'], ...totals })),
        models: models.slice(0, TOP_ROWS),
        projects: [...summary.projects]
            .sort((left, right) => right.costUsd - left.costUsd)
            .slice(0, TOP_ROWS)
            .map((project) => ({ name: project.name, tokens: totalTokensOf(project.totals), costUsd: project.costUsd }))
    };
}

function limitsOf(snapshot: UsageLimitsSnapshot, now: number): ActionOutput<'usage.limits'> {
    return {
        providers: snapshot.providers.map((provider) => ({
            provider: provider.kind,
            account: provider.account?.label ?? null,
            plan: provider.plan,
            checkedAt: provider.checkedAt,
            unavailable: provider.unavailable === null ? null : (provider.unavailable.message ?? provider.unavailable.reason),
            windows: provider.windows.map((window) => ({
                label: window.label,
                kind: window.kind,
                usedPercent: Math.round(window.used * 100),
                resetsAt: window.resetsAt,
                evenPacePercent: evenPace(window, now)?.percent ?? null
            }))
        }))
    };
}

/*
 * What a person reads and does in the processes panel and the usage page, as actions. Reading is
 * everyone's who runs this window. A signal is only a person's, with the panel's own question before
 * SIGKILL: a stuck process gets a warning, never a signal a person did not press. Plan windows come
 * from the CLIs on the machine; nothing here reads a vendor credential.
 */
export function machineActions(overrides: Partial<MachineReach> = {}): ActionHandlers<void> {
    const machine: MachineReach = { ...LIVE_MACHINE, ...overrides };

    const reached = async <Result>(transport: Requester | null, send: (transport: Requester) => Promise<Result>): Promise<Result> => {
        if (transport === null) {
            throw new ActionRefusal('no-machine', 'The machine is not connected.');
        }
        try {
            return await send(transport);
        } catch (error: unknown) {
            throw asRefusal(error);
        }
    };
    const ask = <Result>(send: (transport: Requester) => Promise<Result>): Promise<Result> => reached(machine.transport(), send);
    const askOn = <Result>(endpointId: string, send: (transport: Requester) => Promise<Result>): Promise<Result> => reached(machine.linkTo(endpointId), send);

    const alertNamed = (alertId: string): ProcessAlert => {
        const alert = machine.alerts().find((candidate) => candidate.id === alertId);
        if (!alert) {
            throw new ActionRefusal('unknown-alert', `No warning with id “${alertId}” stands on this machine.`);
        }
        return alert;
    };

    return {
        'process.list': ({ limit }) => {
            const sample = machine.sample();
            if (sample === null) {
                throw new ActionRefusal('not-measured', 'The machine measures its processes only while the processes panel is open. Ask the user to open it.');
            }
            const titles = machine.titles();
            const shown = limit ?? DEFAULT_PROCESSES;
            return {
                output: {
                    at: sample.at,
                    cpu: sample.machine.cpu,
                    memoryUsed: sample.machine.memoryUsed,
                    memoryTotal: sample.machine.memoryTotal,
                    groups: sample.groups.map((group) => ({
                        kind: group.kind,
                        nodeId: group.nodeId,
                        name: (group.nodeId === null ? undefined : titles.get(group.nodeId)) ?? GROUP_NAMES[group.kind],
                        cpu: group.cpu,
                        memory: group.memory,
                        processes: [...group.processes]
                            .sort((left, right) => (right.cpu ?? 0) - (left.cpu ?? 0))
                            .slice(0, shown)
                            .map((row) => ({ pid: row.pid, name: row.name, cpu: row.cpu, memory: row.memory })),
                        more: Math.max(0, group.processes.length - shown) + group.hidden
                    }))
                }
            };
        },
        'process.alerts': () => {
            const titles = machine.titles();
            return {
                output: {
                    alerts: machine.alerts().map((alert) => ({
                        alertId: alert.id,
                        kind: alert.kind,
                        nodeId: alert.nodeId,
                        node: alert.nodeId === null ? null : (titles.get(alert.nodeId) ?? null),
                        process: alert.name,
                        since: alert.since,
                        value: alert.value
                    }))
                }
            };
        },
        'process.dismissAlert': async ({ alertId }) => {
            const alert = alertNamed(alertId);
            await ask((transport) => transport.request('processes.dismiss', { id: alert.id }));
            return { output: { alertId, kind: alert.kind } };
        },
        'process.signal': async ({ pid, startTime, name, signal }, { confirmed }) => {
            if (signal === 'SIGKILL' && !confirmed) {
                return {
                    confirmation: {
                        title: `Force quit “${name}”?`,
                        consequences: ['It ends at once, without a chance to save or clean up.']
                    }
                };
            }
            await ask((transport) => transport.request('processes.signal', { pid, startTime, signal }));
            return { output: { pid, name, signal } };
        },
        'machine.setIdentity': async ({ endpointId, name, icon, ...switches }) => {
            // The wire takes name and icon on every call, so what is left out goes back as the machine has it.
            const known = machine.identity(endpointId);
            const payload = { name: name === undefined ? known.name : name, icon: icon === undefined ? known.icon : icon, ...switches };
            const answer = await askOn(endpointId, (link) => link.request('endpoint.setIdentity', payload));
            machine.adoptInfo(endpointId, answer);
            return { output: { endpointId, machine: answer.label } };
        },
        'machine.setNodeSize': async ({ endpointId, kind, size }) => {
            machine.adoptInfo(endpointId, await askOn(endpointId, (link) => link.request('endpoint.setNodeSize', { kind, size })));
            return { output: { endpointId, kind, size } };
        },
        'machine.revokeAccess': async ({ endpointId, sessionId }) => {
            await askOn(endpointId, (link) => link.request('auth.revoke', { id: sessionId }));
            return { output: { endpointId, sessionId } };
        },
        'computer.control': async ({ endpointId, action }) => {
            machine.adoptComputer(endpointId, await askOn(endpointId, (link) => link.request('computer.control', { action })));
            return { output: { endpointId, action } };
        },
        'device.control': async ({ endpointId, ...device }) => {
            machine.adoptDevice(endpointId, await askOn(endpointId, (link) => link.request('device.control', device)));
            return { output: { endpointId, deviceId: device.deviceId, mode: device.mode } };
        },
        'usage.summary': async ({ from, to }) => {
            const now = machine.now();
            const payload: UsageSummaryPayload = {
                from: from ?? dayOf(new Date(now.getFullYear(), now.getMonth(), now.getDate() - (DEFAULT_DAYS - 1))),
                to: to ?? dayOf(now),
                resolution: 'day',
                timeZone: machine.timeZone()
            };
            if (payload.from > payload.to) {
                throw new ActionRefusal('backwards', `${payload.from} comes after ${payload.to}.`);
            }
            return { output: usageOf(await ask((transport) => transport.request('usage.summary', payload))) };
        },
        'usage.limits': async () => ({
            output: limitsOf(machine.limits() ?? (await ask((transport) => transport.request('usage.limits', {}))), machine.now().getTime())
        })
    };
}

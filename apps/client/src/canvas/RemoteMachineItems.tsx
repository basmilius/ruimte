import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Monitor, MonitorUp } from 'lucide-react';
import type { RemoteLink } from '@ruimte/contracts';
import { MachineGlyph } from '@/endpoint/MachineGlyph';
import type { Point } from '@/canvas/math';
import { iconOfEntry } from '@/shell/settings/machine-icon';
import { nameOf, type MachineEntry } from '@/shell/settings/machine-list';
import { useOtherMachines } from '@/canvas/use-other-machines';
import { useCanvas } from '@/state/canvas';
import { useDocument } from '@/state/document';
import { useProjectList } from '@/state/project-list';
import { useProject } from '@/state/project';
import { useServers } from '@/state/server';
import { useUi } from '@/state/ui';
import { useWorkspace } from '@/transport/connections';
import { machineAnswers } from '@/transport/features';
import { useEndpointConnection } from '@/transport/status';
import { machineLost } from '@/shell/machine-lost';
import { ContextMenu, DisabledReason, Icon } from '@adecore/ui';

/* The checkouts this project is linked to on the machines, so a row can say which one it would work in. */
function useLinks(): RemoteLink[] {
    const workspace = useWorkspace();
    const projectId = useProject((s) => s.current?.projectId ?? null);
    const [links, setLinks] = useState<RemoteLink[]>([]);
    useEffect(() => {
        if (workspace === null || projectId === null || !machineAnswers(workspace.connection.transport.connection, 'remote.list')) {
            return;
        }
        let current = true;
        workspace.connection.transport.request('remote.list', { projectId }).then(
            (answer) => current && setLinks(answer.links),
            () => undefined
        );
        return () => {
            current = false;
        };
    }, [workspace, projectId]);
    return links;
}

/*
 * "On another machine": one row per machine of the account, in a submenu below the node kinds, so the
 * menu does not grow with every machine, and the way to put this project on a machine that has no
 * checkout of it yet. A node of another machine goes on a canvas only you have, so on a shared canvas
 * each row says why it is off.
 */
export function RemoteMachineItems({ at }: { at: () => Point }) {
    const { t } = useTranslation('canvas');
    const viewId = useCanvas((s) => s.viewId);
    const shared = useDocument((s) => viewId !== null && s.shared.includes(viewId));
    const machines = useOtherMachines();
    const links = useLinks();
    if (machines.length === 0 || viewId === null) {
        return null;
    }
    return (
        <ContextMenu.SubmenuRoot>
            <ContextMenu.SubmenuTrigger>
                <Icon icon={Monitor} size={14} /> {t('otherMachine.group')}
            </ContextMenu.SubmenuTrigger>
            <ContextMenu.Popup className="min-w-52">
                {machines.map((entry) => (
                    <MachineRow
                        key={entry.id}
                        entry={entry}
                        shared={shared}
                        link={links.find((known) => known.machineId === entry.id) ?? null}
                        onPick={() => {
                            useUi.getState().setRemoteNodeDialog({ machineId: entry.id, kind: 'chat', viewId, at: at(), relink: false });
                        }}
                    />
                ))}
                <ContextMenu.Separator />
                <ContextMenu.Item onClick={() => useUi.getState().setAddToMachineDialog({ machineId: null })}>
                    <Icon icon={MonitorUp} size={14} /> {t('otherMachine.addProject')}
                </ContextMenu.Item>
            </ContextMenu.Popup>
        </ContextMenu.SubmenuRoot>
    );
}

function MachineRow({ entry, shared, link, onPick }: { entry: MachineEntry; shared: boolean; link: RemoteLink | null; onPick(): void }) {
    const { t } = useTranslation('canvas');
    const endpointId = entry.endpoint?.id ?? entry.id;
    const connection = useEndpointConnection(endpointId);
    const answered = useServers((s) => s.byEndpoint[endpointId]?.icon ?? null);
    const remoteName = useProjectList((s) =>
        link === null ? null : (s.projects.find((row) => row.endpointId === endpointId && row.summary.projectId === link.remoteProjectId)?.summary.name ?? null)
    );
    const name = nameOf(entry);
    const tooOld = connection.status === 'open' && !machineAnswers(connection, 'peer.placeNodes');
    const reason = shared ? t('otherMachine.shared') : tooOld ? t('otherMachine.needsUpdateTip', { machine: name }) : null;
    const second = tooOld ? t('otherMachine.needsUpdate') : machineLost(connection) ? t('otherMachine.notAnswering') : remoteName;
    return (
        <DisabledReason reason={reason}>
            <ContextMenu.Item disabled={shared || tooOld} onClick={onPick}>
                <MachineGlyph icon={iconOfEntry(entry, answered)} size={14} />
                <span className="flex min-w-0 flex-col">
                    <span className="truncate">{name}</span>
                    {second !== null && <span className="truncate text-xs text-text-muted">{second}</span>}
                </span>
            </ContextMenu.Item>
        </DisabledReason>
    );
}

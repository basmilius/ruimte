import { ContextMenu, Icon, messageOf } from '@adecore/ui';
import type { ProjectNode } from '@ruimte/contracts';
import { GitPullRequestArrow } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { nameOf } from '@/machines/machine-list';
import { useMachineEntry } from '@/machines/use-machine-entry';
import { bringBack } from '@/project/bring-back';
import { endpointOfNode } from '@/state/keys';
import { useProject } from '@/state/project';
import { useToasts } from '@/state/toasts';
import { useUi } from '@/state/ui';
import { useWorkspace } from '@/workspace/connections';
import { useTransport } from '@/workspace/context';

/*
 * "Bring back to this machine" in the menu of a node that works on another machine: its branch comes
 * here as a remote branch and a worktree, and the toast offers to merge it. Drawn inside the node's
 * machine scope, so the transport it reads from is that machine's.
 */
export function BringBackItem({ node }: { node: ProjectNode }) {
    const { t } = useTranslation('canvas');
    const workspace = useWorkspace();
    const there = useTransport();
    const project = useProject((s) => s.current);
    const entry = useMachineEntry(endpointOfNode(node, ''));
    const [busy, setBusy] = useState(false);
    const machine = nameOf(entry);
    if (
        workspace === null ||
        project === null ||
        node.machine === undefined ||
        node.cwd === undefined ||
        endpointOfNode(node, '') === workspace.connection.endpointId
    ) {
        return null;
    }
    const { cwd } = node;

    const run = async (): Promise<void> => {
        setBusy(true);
        const toast = useToasts.getState().show({ kind: 'progress', title: t('bringBack.working', { what: node.title, machine }) });
        try {
            const result = await bringBack({
                there,
                here: workspace.connection.transport,
                cwd,
                folder: project.folder,
                projectId: project.projectId,
                machine,
                title: node.title
            });
            useToasts.getState().show({
                id: toast,
                kind: 'success',
                title: t('bringBack.done', { branch: result.name, machine }),
                ...(result.path === undefined
                    ? {}
                    : {
                          action: {
                              label: t('bringBack.merge'),
                              run: () => useUi.getState().setWorktreeMerge({ folder: project.folder, paths: [result.path!] })
                          }
                      })
            });
        } catch (e) {
            useToasts.getState().show({
                id: toast,
                kind: 'error',
                title: t('bringBack.failed', { what: node.title }),
                description: messageOf(e, t('bringBack.failedDescription', { machine }))
            });
        } finally {
            setBusy(false);
        }
    };

    return (
        <ContextMenu.Item disabled={busy} onClick={() => void run()}>
            <Icon icon={GitPullRequestArrow} size={14} /> {t('bringBack.item')}
        </ContextMenu.Item>
    );
}

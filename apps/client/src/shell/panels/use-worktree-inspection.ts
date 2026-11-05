import { messageOf } from '@adecore/ui';
import type { Worktree } from '@ruimte/contracts';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { worktreeLists } from '@/controllers/worktrees';
import { useEndpointId } from '@/state/current-endpoint';
import { useTransport } from '@/transport/context';
import { removeVerdict, type RemoveVerdict } from '@/worktree-rules/worktree-rows';

export interface Inspection {
    worktree: Worktree;
    verdict: RemoveVerdict | null;
}

/* Counts the work of one worktree again and says whether it can go, so a person knows before the question. */
export function useWorktreeInspection(folder: string | null) {
    const { t } = useTranslation('panels');
    const endpointId = useEndpointId();
    const transport = useTransport();
    const [inspected, setInspected] = useState<Inspection | null>(null);
    // Goes up on every start and on close, so an answer that lands after the dialog was left is dropped.
    const inspection = useRef(0);

    const close = (): void => {
        inspection.current++;
        setInspected(null);
    };

    const inspect = (worktree: Worktree, agentWorking: boolean): void => {
        if (folder === null) {
            return;
        }
        worktreeLists.refreshCounts(endpointId, folder);
        const attempt = ++inspection.current;
        setInspected({ worktree, verdict: null });
        transport
            .request('git.worktree-list', { repo: folder, inspect: true })
            .then((answer) => {
                if (attempt === inspection.current) {
                    const fresh = answer.worktrees.find((entry) => entry.path === worktree.path) ?? worktree;
                    setInspected({ worktree: fresh, verdict: removeVerdict(fresh, agentWorking) });
                }
            })
            .catch((error: unknown) => {
                if (attempt === inspection.current) {
                    setInspected({ worktree, verdict: { removable: false, reason: messageOf(error, t('worktree.verdict.failed')) } });
                }
            });
    };

    return { inspected, inspect, close };
}

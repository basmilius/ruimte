import { GitFork } from 'lucide-react';
import { forkPointOf } from '@/chat/logic/fork';
import { useCanvas, useCanvasStore } from '@/state/canvas';
import { useChatRow } from '@/state/chats';
import { Icon } from '@/ui/Icon';
import { Pill } from '@/ui/Pill';
import { Tooltip } from '@/ui/Tooltip';

const WHEN = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

/* Where a forked chat came from, in its node's header; pressing it brings the camera to the original. */
export function ForkPill({ chatId }: { chatId: string }) {
    const forkOf = useChatRow(chatId, (row) => row?.info.forkOf);
    const turn = useChatRow(chatId, (row) => (row && forkOf ? (forkPointOf(row.structure, row.order, forkOf.turnId)?.number ?? null) : null));
    const originalTitle = useCanvas((s) => (forkOf ? s.nodes[forkOf.chatId]?.title : undefined));
    const canvasStore = useCanvasStore();
    if (!forkOf) {
        return null;
    }
    const when = `${turn === null ? 'Forked' : `Forked after turn ${turn}`}, ${WHEN.format(forkOf.at)}`;
    const icon = <Icon icon={GitFork} size={12} />;
    if (originalTitle === undefined) {
        return (
            <Tooltip label={`${when}. The original is not on this canvas.`}>
                <Pill icon={icon}>Fork</Pill>
            </Tooltip>
        );
    }
    return (
        <Tooltip label={when}>
            <Pill icon={icon} className="max-w-48" onClick={() => canvasStore.getState().goToNode(forkOf.chatId)}>
                <span className="truncate">Fork of {originalTitle}</span>
            </Pill>
        </Tooltip>
    );
}

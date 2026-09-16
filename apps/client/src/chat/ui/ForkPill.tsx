import { GitFork } from 'lucide-react';
import { forkOriginIn, forkPointOf } from '@/chat/logic/fork';
import { revealNode, showView } from '@/project/views';
import { useCanvas, useCanvasStore } from '@/state/canvas';
import { useChatRow } from '@/state/chats';
import { useDocument } from '@/state/document';
import { Icon } from '@/ui/Icon';
import { Pill } from '@/ui/Pill';
import { Tooltip } from '@/ui/Tooltip';

const WHEN = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

/*
 * Where a forked chat came from, in its node's header or its view's toolbar. Pressing it leads back
 * to the original: the camera to a node on this canvas, over to the canvas of a node elsewhere, or
 * the original's own view.
 */
export function ForkPill({ chatId }: { chatId: string }) {
    const forkOf = useChatRow(chatId, (row) => row?.info.forkOf);
    const turn = useChatRow(chatId, (row) => (row && forkOf ? (forkPointOf(row.structure, row.order, forkOf.turnId)?.number ?? null) : null));
    const originId = forkOf?.chatId ?? '';
    const shape = useDocument((s) => forkOriginIn(s.views, originId)?.shape ?? null);
    const documentTitle = useDocument((s) => forkOriginIn(s.views, originId)?.title ?? null);
    // A node on this canvas carries its title live; the document catches up with the next save.
    const liveTitle = useCanvas((s) => s.nodes[originId]?.title ?? null);
    const canvasStore = useCanvasStore();
    if (!forkOf) {
        return null;
    }
    const when = `${turn === null ? 'Forked' : `Forked after turn ${turn}`}, ${WHEN.format(forkOf.at)}`;
    const icon = <Icon icon={GitFork} size={12} />;
    const title = liveTitle ?? documentTitle;
    if (title === null) {
        return (
            <Tooltip label={`${when}. The original is no longer in this project.`}>
                <Pill icon={icon}>Fork</Pill>
            </Tooltip>
        );
    }
    const goBack = (): void => {
        if (liveTitle !== null) {
            canvasStore.getState().goToNode(originId);
        } else if (shape === 'view') {
            showView(originId);
        } else {
            revealNode(originId);
        }
    };
    return (
        <Tooltip label={when}>
            <Pill icon={icon} className="max-w-48" onClick={goBack}>
                <span className="truncate">Fork of {title}</span>
            </Pill>
        </Tooltip>
    );
}

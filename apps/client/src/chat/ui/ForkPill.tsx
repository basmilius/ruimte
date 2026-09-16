import { GitFork } from 'lucide-react';
import { forkPointOf } from '@/chat/logic/fork';
import { useChatPlace } from '@/chat/ui/use-chat-place';
import { useChatRow } from '@/state/chats';
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
    const original = useChatPlace(forkOf?.chatId ?? '');
    if (!forkOf) {
        return null;
    }
    const when = `${turn === null ? 'Forked' : `Forked after turn ${turn}`}, ${WHEN.format(forkOf.at)}`;
    const icon = <Icon icon={GitFork} size={12} />;
    if (original.title === null) {
        return (
            <Tooltip label={`${when}. The original is no longer in this project.`}>
                <Pill icon={icon}>Fork</Pill>
            </Tooltip>
        );
    }
    return (
        <Tooltip label={when}>
            <Pill icon={icon} className="max-w-48" onClick={original.go}>
                <span className="truncate">Fork of {original.title}</span>
            </Pill>
        </Tooltip>
    );
}

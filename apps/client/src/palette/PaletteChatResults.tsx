import { CliMark } from '@adecore/agents-react/providers';
import { CommandPalette, Icon, RelativeTime } from '@adecore/ui';
import type { ChatExternalSession, ChatSearchHit } from '@ruimte/contracts';
import { MessageSquare, Terminal } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { PaletteRow } from '@/palette/palette-entries';

/* A hit in a chat of Ruimte, or a session a CLI started outside it. */
export type ChatRow = PaletteRow & ({ hit: ChatSearchHit; session?: undefined } | { hit?: undefined; session: ChatExternalSession });

/* The snippet with the match picked out. */
function Snippet({ hit }: { hit: ChatSearchHit }) {
    const end = hit.matchStart + hit.matchLength;
    return (
        <>
            {hit.snippet.slice(0, hit.matchStart)}
            <mark className="rounded-xs bg-accent-soft text-text">{hit.snippet.slice(hit.matchStart, end)}</mark>
            {hit.snippet.slice(end)}
        </>
    );
}

function HitItem({ row, hit, onRun }: { row: ChatRow; hit: ChatSearchHit; onRun(row: ChatRow): void }) {
    const { t } = useTranslation('shell');
    return (
        <CommandPalette.Item
            value={row}
            icon={<span className="w-14 truncate text-xs">{t(hit.author === 'person' ? 'palette.authorPerson' : 'palette.authorAgent')}</span>}
            onClick={() => onRun(row)}
        >
            <Snippet hit={hit} />
        </CommandPalette.Item>
    );
}

function ExternalItem({ row, session, onRun }: { row: ChatRow; session: ChatExternalSession; onRun(row: ChatRow): void }) {
    const { t } = useTranslation('shell');
    return (
        <CommandPalette.Item
            value={row}
            icon={<CliMark kind={session.provider} size={14} />}
            trailing={<RelativeTime at={session.updatedAt} tooltip={false} className="text-xs text-text-faint" />}
            onClick={() => onRun(row)}
        >
            {session.title === '' ? t('palette.untitledChat') : session.title}
        </CommandPalette.Item>
    );
}

export function ChatItem({ row, onRun }: { row: ChatRow; onRun(row: ChatRow): void }) {
    return row.hit !== undefined ? <HitItem row={row} hit={row.hit} onRun={onRun} /> : <ExternalItem row={row} session={row.session} onRun={onRun} />;
}

/* The chat a group of hits was found in. The arrows move from hit to hit, so a chat with ten of them is not ten steps to the next chat. */
export function ChatGroupLabel({ title, count }: { title: string; count: number }) {
    return (
        <span className="flex items-center gap-1.5">
            <Icon icon={MessageSquare} size={14} className="shrink-0" />
            <span className="min-w-0 truncate">{title}</span>
            <span className="shrink-0">{count}</span>
        </span>
    );
}

export function ExternalLabel() {
    const { t } = useTranslation('shell');
    return (
        <span className="flex items-center gap-1.5">
            <Icon icon={Terminal} size={14} className="shrink-0" />
            <span>{t('palette.externalSessions')}</span>
        </span>
    );
}

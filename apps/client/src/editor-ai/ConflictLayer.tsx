import { useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useStore } from 'zustand';
import { Button } from '@adecore/ui';
import type { Editor } from '@adecore/editor';
import { colorOfChat } from './agent-runs';
import { ChatMark } from './ChatMark';
import type { ConflictAuthor, ConflictBlockState, ConflictResolution } from './conflict-resolution';
import { useProviderName } from './use-chat-identity';

/* The gutter's width keeps a row's words in line with the code beside it. */
const INDENT = { paddingLeft: 'var(--se-gutter-width)' };

function Heading({ author, note }: { author: ConflictAuthor | null; note?: string }) {
    const { t } = useTranslation('panels');
    const name = useProviderName(author?.provider);
    return (
        <span className="flex min-w-0 items-center gap-1.5">
            <ChatMark provider={author?.provider} color={author === null ? '--status-needs-you' : colorOfChat(author.chatId)} size={12} />
            <span className="truncate font-medium text-text">{author === null ? t('file.conflict.other') : name || t('file.conflict.agent')}</span>
            {author?.turn !== undefined && <span className="shrink-0 text-text-muted">· {t('file.agent.turn', { turn: author.turn })}</span>}
            {note !== undefined && <span className="shrink-0 text-text-muted">· {note}</span>}
        </span>
    );
}

function Yours({ conflict, block }: { conflict: ConflictResolution; block: ConflictBlockState }) {
    const { t } = useTranslation('panels');
    return (
        <div className="flex h-6 items-center gap-2 text-xs" style={INDENT}>
            <span className="font-medium text-text">{t('file.conflict.yours')}</span>
            <span className="text-text-muted">· {block.oursEmpty ? t('file.conflict.yoursRemoved') : t('file.conflict.unsaved')}</span>
            <Button size="xs" className="text-accent" onClick={() => conflict.keepYours(block.id)}>
                {t('file.conflict.keepYours')}
            </Button>
        </div>
    );
}

/* The other side's lines in the editor's own face, tinted in the color of whoever wrote them. */
function Theirs({ conflict, editor, block }: { conflict: ConflictResolution; editor: Editor; block: ConflictBlockState }) {
    const { t } = useTranslation('panels');
    const code = useRef<HTMLDivElement>(null);
    const name = useProviderName(block.author?.provider);
    const color = block.author === null ? '--status-needs-you' : colorOfChat(block.author.chatId);
    const removed = block.theirs.length === 0;

    useLayoutEffect(() => {
        const element = code.current;
        if (element === null) {
            return;
        }
        element.replaceChildren();
        if (!removed) {
            editor.renderCode(element, block.theirs.join('\n'), { color });
        }
    }, [editor, block.theirs, color, removed]);

    return (
        <div className="flex flex-col text-xs">
            <div className="flex h-6 items-center gap-2" style={INDENT}>
                <Heading author={block.author} note={removed ? t('file.conflict.theirsRemoved') : undefined} />
                <Button size="xs" className="text-accent" onClick={() => conflict.keepTheirs(block.id)}>
                    {block.author === null || name === '' ? t('file.conflict.keepOther') : t('file.conflict.keepTheirs', { name })}
                </Button>
            </div>
            <div ref={code} />
            <div className="flex h-6 items-center" style={INDENT}>
                <Button size="xs" className="text-accent" onClick={() => conflict.keepBoth(block.id)}>
                    {t('file.conflict.keepBoth')}
                </Button>
            </div>
        </div>
    );
}

/* The rows of a conflict in the editor: portals into the elements it hands out, so the editor owns where they stand. */
export function ConflictLayer({ conflict, editor }: { conflict: ConflictResolution; editor: Editor }) {
    const { blocks } = useStore(conflict.store);
    useSyncExternalStore(conflict.rows.subscribe, conflict.rows.getVersion);

    return (
        <>
            {blocks.map((block) => {
                const yours = conflict.rows.container(`${block.id}:yours`);
                const theirs = conflict.rows.container(`${block.id}:theirs`);
                return (
                    <span key={block.id}>
                        {yours !== undefined && createPortal(<Yours conflict={conflict} block={block} />, yours)}
                        {theirs !== undefined && createPortal(<Theirs conflict={conflict} editor={editor} block={block} />, theirs)}
                    </span>
                );
            })}
        </>
    );
}

import type { Editor, EditorCodeBlockOptions } from '@adecore/editor';
import { AnchoredPopup } from '@adecore/editor-react';
import { Button, Tooltip } from '@adecore/ui';
import { formatNumber } from '@adecore/ui/format';
import { useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AgentHover } from '@/editor-ai/agent-changes';
import { ProvenanceCard } from '@/editor-ai/ProvenanceCard';
import { useChatIdentity, useProviderName } from '@/editor-ai/use-chat-identity';
import { useCodeTheme } from '@/state/code-theme';
import { boundedLines, type ChangePreview } from './change-preview';
import './change-preview.css';

function PreviewCode({
    editor,
    lines,
    firstLine,
    removed,
    plain
}: {
    editor: Editor;
    lines: readonly string[];
    firstLine: number;
    removed: boolean;
    plain: boolean;
}) {
    const { t } = useTranslation('panels');
    const element = useRef<HTMLDivElement>(null);
    const theme = useCodeTheme();
    const shown = boundedLines(lines);

    useLayoutEffect(() => {
        const container = element.current;

        if (container === null) {
            return;
        }

        const options: EditorCodeBlockOptions = {
            firstLine,
            sign: removed ? '-' : '+',
            color: removed ? '--editor-deleted' : '--editor-added',
            faded: removed,
            ...(plain ? { tokens: null } : {})
        };

        container.replaceChildren();
        editor.renderCode(container, shown.text, options);
    }, [editor, shown.text, firstLine, removed, plain, theme]);

    return (
        <>
            <div ref={element} />
            {shown.truncated && <p className="px-3 py-2 text-xs text-text-muted">{t('file.changePreview.truncated')}</p>}
        </>
    );
}

function AttributionLink({ hover, onOpen }: { hover: AgentHover; onOpen(): void }) {
    const { t } = useTranslation('panels');
    const chat = useChatIdentity(hover.run.chatId);
    const provider = useProviderName(hover.run.provider);
    return (
        <Button size="xs" className="max-w-full truncate" onClick={onOpen}>
            {t(hover.run.turn === undefined ? 'file.changePreview.author' : 'file.changePreview.authorTurn', {
                chat: chat.title ?? provider,
                turn: hover.run.turn === undefined ? undefined : formatNumber(hover.run.turn)
            })}
        </Button>
    );
}

export function ChangePreviewCard({
    preview,
    editor,
    plain,
    readOnly,
    attribution,
    onHold,
    onRevert
}: {
    preview: ChangePreview;
    editor: Editor;
    plain: boolean;
    readOnly: string | null;
    attribution: AgentHover | null;
    onHold(inside: boolean): void;
    onRevert(): void;
}) {
    const { t } = useTranslation('panels');
    // Attribution outlives its own hover timer while this card is being read.
    const [author, setAuthor] = useState(attribution);
    const [showAuthor, setShowAuthor] = useState(false);
    if (author === null && attribution !== null) {
        setAuthor(attribution);
    }
    if (showAuthor && author !== null) {
        return <ProvenanceCard hover={{ ...author, rect: preview.rect }} onHold={onHold} />;
    }
    return (
        <AnchoredPopup
            rect={preview.rect}
            className="flex w-140 max-w-[calc(100vw-24px)] flex-col"
            overflow="clip"
            onPointerEnter={() => onHold(true)}
            onPointerLeave={() => onHold(false)}
        >
            <div role="dialog" className="flex min-h-0 flex-col" aria-label={t('file.changePreview.title')}>
                <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-3 py-2">
                    <span className="text-xs font-semibold">{t('file.changePreview.title')}</span>
                    <Tooltip label={readOnly} disabled={readOnly === null}>
                        <span className="inline-flex shrink-0">
                            <Button size="xs" disabled={readOnly !== null} onClick={onRevert}>
                                {t('file.changePreview.revert')}
                            </Button>
                        </span>
                    </Tooltip>
                </div>
                <div className="change-preview-code min-h-0 max-h-72 overflow-auto select-text">
                    {preview.before.length > 0 && (
                        <PreviewCode editor={editor} lines={preview.before} firstLine={preview.change.baseStart + 1} removed plain={plain} />
                    )}
                    {preview.after.length > 0 && (
                        <PreviewCode editor={editor} lines={preview.after} firstLine={preview.change.otherStart + 1} removed={false} plain={plain} />
                    )}
                </div>
                {author !== null && (
                    <div className="shrink-0 border-t border-border px-1.5 py-1.25">
                        <AttributionLink hover={author} onOpen={() => setShowAuthor(true)} />
                    </div>
                )}
            </div>
        </AnchoredPopup>
    );
}

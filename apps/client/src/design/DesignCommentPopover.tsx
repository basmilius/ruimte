import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ListPlus } from 'lucide-react';
import { Button, Icon, TextArea } from '@adecore/ui';
import type { DesignElement } from '@/design/design-protocol';

const WIDTH = 300;

/*
 * Where a person writes a comment on the element they picked: just under it, kept inside the stage. A
 * comment waits with the others of the round until they go to the chat together, the way a reviewer
 * marks up a page before handing it back.
 */
export function DesignCommentPopover({ element, onQueue, onCancel }: { element: DesignElement; onQueue(text: string): void; onCancel(): void }) {
    const { t } = useTranslation('shell');
    const [text, setText] = useState('');
    const queue = (): void => {
        if (text.trim() !== '') {
            onQueue(text);
        }
    };

    return (
        <div
            className="menu-popup absolute z-10 flex flex-col gap-2 p-3"
            style={{
                width: WIDTH,
                left: `clamp(8px, ${Math.round(element.rect.x)}px, calc(100% - ${WIDTH + 8}px))`,
                top: Math.max(8, Math.round(element.rect.y + element.rect.height + 8))
            }}
        >
            <span className="truncate font-mono text-xs text-text-muted">
                {element.option === null ? '' : `${element.option} · `}
                {element.name}
            </span>
            <TextArea
                autoFocus
                rows={3}
                value={text}
                placeholder={t('design.comment.placeholder')}
                onChange={(event) => setText(event.target.value)}
                onKeyDown={(event) => {
                    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                        event.preventDefault();
                        queue();
                    } else if (event.key === 'Escape') {
                        onCancel();
                    }
                }}
            />
            <div className="flex justify-end gap-1">
                <Button size="sm" variant="ghost" onClick={onCancel}>
                    {t('design.comment.cancel')}
                </Button>
                <Button size="sm" variant="secondary" disabled={text.trim() === ''} onClick={queue}>
                    <Icon icon={ListPlus} size={14} />
                    {t('design.comment.queue')}
                </Button>
            </div>
        </div>
    );
}

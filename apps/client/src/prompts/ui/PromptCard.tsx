import type { KeyboardEvent, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Hand, MessageCircleQuestionMark, type LucideIcon } from 'lucide-react';
import { isApplePlatform } from '@/desktop/bridge';
import { headingKey, isPrimaryKey, staysInCard, stepIndex, toolbarKey } from '@/prompts/logic/keys';
import { Icon } from '@/ui/Icon';

/* The raised glass a chat's composer is made of, for a card that stands on its own over a canvas. */
export const PROMPT_SURFACE =
    'flex flex-col overflow-hidden rounded-2xl border border-border bg-[color-mix(in_srgb,var(--surface-raised)_92%,transparent)] shadow-float backdrop-blur-[14px]';

export type PromptCardKind = 'approval' | 'question' | 'waiting';

const ICONS: Record<PromptCardKind, LucideIcon> = { approval: Hand, question: MessageCircleQuestionMark, waiting: MessageCircleQuestionMark };

interface PromptCardProps {
    kind: PromptCardKind;
    heading: ReactNode;
    /* The muted line under the heading; left out when there is nothing to say. */
    meta?: ReactNode;
    /* The stack's source row, drawn above the card and outside `.prompt-card`, so paging is never mistaken for an answer. */
    top?: ReactNode;
    actions: ReactNode;
    busy: boolean;
    disabled: boolean;
    error: string | null;
    children?: ReactNode;
}

/*
 * The keys every card shares: Mod+Enter, entering from the heading and the action row. The body handles
 * its own keys first and says so with `preventDefault`.
 */
function onCardKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const card = event.currentTarget;
    const target = event.target instanceof HTMLElement ? event.target : null;
    if (!event.defaultPrevented) {
        if (isPrimaryKey(event.nativeEvent, isApplePlatform())) {
            event.preventDefault();
            // A click on the button itself, so a disabled Next or Answer stays as disabled as it looks.
            card.querySelector<HTMLButtonElement>('[data-prompt-primary]:not(:disabled)')?.click();
        } else if (target?.classList.contains('prompt-heading') && headingKey(event.nativeEvent)) {
            event.preventDefault();
            card.querySelector<HTMLElement>('[data-prompt-entry]:not(:disabled), [data-prompt-primary]:not(:disabled)')?.focus();
        } else {
            const toolbar = target?.closest('[role="toolbar"]');
            const step = toolbar ? toolbarKey(event.nativeEvent) : null;
            if (toolbar && step !== null) {
                event.preventDefault();
                const buttons = [...toolbar.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
                const current = buttons.findIndex((button) => button.contains(target));
                buttons[stepIndex(current, buttons.length, step)]?.focus();
            }
        }
    }
    if (event.defaultPrevented || staysInCard(event.nativeEvent)) {
        event.stopPropagation();
    }
}

/* What every prompt looks like, whatever asked it: in a chat's composer and in a canvas's stack. */
export function PromptCard({ kind, heading, meta, top, actions, busy, disabled, error, children }: PromptCardProps) {
    const { t } = useTranslation('prompts');
    const card = (
        <div className="prompt-card flex min-h-0 flex-col gap-2 p-3" role="group" aria-label={t(`card.${kind}`)} aria-busy={busy} onKeyDown={onCardKeyDown}>
            {/* The scroll box would clip the focus ring of whatever sits against its edge, so it carries the
                room that ring needs and gives the same amount back to the card's own padding. */}
            <div className="-m-1.5 max-h-[min(50dvh,480px)] overflow-auto overscroll-contain p-1.5">
                <div className="flex flex-col gap-2">
                    <div className="flex items-start gap-2">
                        <Icon icon={ICONS[kind]} size={18} className="mt-0.5 shrink-0 text-status-needs-you" />
                        <h3 tabIndex={-1} className="prompt-heading min-w-0 break-words text-sm font-semibold text-text outline-offset-4">
                            {heading}
                        </h3>
                    </div>
                    {meta && <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-text-muted">{meta}</div>}
                    {children}
                    {disabled && <p className="text-xs text-text-muted">{t('error.notConnected')}</p>}
                    {error && (
                        <p role="alert" className="text-xs text-status-error">
                            {error}
                        </p>
                    )}
                </div>
            </div>
            <div role="toolbar" aria-label={t('toolbar')} className="flex flex-wrap items-center gap-1.5">
                {actions}
            </div>
        </div>
    );
    if (top === undefined) {
        return card;
    }
    return (
        <div className="flex min-h-0 flex-col">
            {top}
            {card}
        </div>
    );
}

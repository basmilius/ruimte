import type { ReactNode } from 'react';
import { Hand, MessageCircleQuestionMark, type LucideIcon } from 'lucide-react';
import { Icon } from '@/ui/Icon';

export type PromptCardKind = 'approval' | 'question' | 'waiting';

const ICONS: Record<PromptCardKind, LucideIcon> = { approval: Hand, question: MessageCircleQuestionMark, waiting: MessageCircleQuestionMark };
const LABELS: Record<PromptCardKind, string> = { approval: 'Permission request', question: 'Question', waiting: 'Waiting in the terminal' };

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

/* What every prompt looks like, whatever asked it: in a chat's composer and in a canvas's stack. */
export function PromptCard({ kind, heading, meta, top, actions, busy, disabled, error, children }: PromptCardProps) {
    const card = (
        <div className="prompt-card flex min-h-0 flex-col gap-2 p-3" role="group" aria-label={LABELS[kind]} aria-busy={busy}>
            <div className="max-h-[min(50dvh,480px)] overflow-auto overscroll-contain">
                <div className="flex flex-col gap-2">
                    <div className="flex items-start gap-2">
                        <Icon icon={ICONS[kind]} size={18} className="mt-0.5 shrink-0 text-status-needs-you" />
                        <h3 tabIndex={-1} className="prompt-heading min-w-0 break-words text-sm font-semibold text-text outline-offset-4">
                            {heading}
                        </h3>
                    </div>
                    {meta && <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-text-muted">{meta}</div>}
                    {children}
                    {disabled && <p className="text-xs text-text-muted">Not connected to the machine</p>}
                    {error && (
                        <p role="alert" className="text-xs text-status-error">
                            {error}
                        </p>
                    )}
                </div>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">{actions}</div>
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

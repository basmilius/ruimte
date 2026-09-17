import type { ButtonHTMLAttributes } from 'react';
import { ArrowUp, CircleCheck } from 'lucide-react';
import { Button } from '@/ui/Button';
import { Icon } from '@/ui/Icon';

/* The one button Mod+Enter presses and ArrowDown from the heading lands on, when the body has nothing to choose. */
export function PromptPrimary(props: ButtonHTMLAttributes<HTMLButtonElement>) {
    return (
        <button
            type="button"
            data-prompt-primary
            className="inline-flex h-7 shrink-0 items-center justify-center gap-1.5 rounded-full bg-text px-2.5 text-xs font-medium text-bg hover:opacity-90 disabled:opacity-50"
            {...props}
        />
    );
}

export interface ApprovalButton {
    id: string;
    label: string;
    description?: string;
    /* The Allow: drawn last, filled, and the one that says it is sending. */
    primary: boolean;
    onPress(): void;
}

/* The buttons of a permission request, in the order a chat draws them: the quieter ones first, Allow last. */
export function ApprovalActions({
    buttons,
    onAddReason,
    locked,
    sending
}: {
    buttons: readonly ApprovalButton[];
    /* Only where a Deny can carry a reason, and only until the field is open. */
    onAddReason?: () => void;
    locked: boolean;
    sending: boolean;
}) {
    return (
        <>
            {onAddReason && (
                <Button size="sm" className="rounded-full!" disabled={locked} onClick={onAddReason}>
                    Add a reason
                </Button>
            )}
            <div className="ml-auto flex flex-wrap items-center justify-end gap-1.5">
                {buttons.map((button) =>
                    button.primary ? (
                        <PromptPrimary key={button.id} disabled={locked} onClick={button.onPress}>
                            <Icon icon={CircleCheck} size={16} />
                            {sending ? 'Sending…' : button.label}
                        </PromptPrimary>
                    ) : (
                        <Button
                            key={button.id}
                            size="sm"
                            className="rounded-full!"
                            disabled={locked}
                            aria-description={button.description}
                            onClick={button.onPress}
                        >
                            {button.label}
                        </Button>
                    )
                )}
            </div>
        </>
    );
}

/* The buttons of a question: back through its questions, dismissing an optional one, and Next until the last becomes Answer. */
export function QuestionActions({
    index,
    dismissable,
    last,
    ready,
    locked,
    sending,
    onPrevious,
    onDismiss,
    onCommit
}: {
    index: number;
    dismissable: boolean;
    last: boolean;
    ready: boolean;
    locked: boolean;
    sending: boolean;
    onPrevious(): void;
    onDismiss(): void;
    onCommit(): void;
}) {
    return (
        <>
            {index > 0 && (
                <Button size="sm" className="rounded-full!" disabled={sending} onClick={onPrevious}>
                    Previous
                </Button>
            )}
            {dismissable && index === 0 && (
                <Button size="sm" className="rounded-full!" disabled={locked} onClick={onDismiss}>
                    Dismiss
                </Button>
            )}
            <span className="grow" />
            <PromptPrimary disabled={locked || !ready} onClick={onCommit}>
                {sending ? 'Sending…' : last ? 'Answer' : 'Next'}
                <Icon icon={ArrowUp} size={16} />
            </PromptPrimary>
        </>
    );
}

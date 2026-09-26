import type { ButtonHTMLAttributes } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowUp, CircleCheck } from 'lucide-react';
import { Button } from '@ruimte/ui/Button';
import { Icon } from '@ruimte/ui/Icon';

/* The one button Mod+Enter presses and ArrowDown from the heading lands on, when the body has nothing to choose. */
export function PromptPrimary(props: ButtonHTMLAttributes<HTMLButtonElement>) {
    return <Button variant="inverse" size="sm" data-prompt-primary {...props} />;
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
    const { t } = useTranslation('agent-prompts');
    return (
        <>
            {onAddReason && (
                <Button size="sm" disabled={locked} onClick={onAddReason}>
                    {t('approval.addReason')}
                </Button>
            )}
            <div className="ml-auto flex flex-wrap items-center justify-end gap-1.5">
                {buttons.map((button) =>
                    button.primary ? (
                        <PromptPrimary key={button.id} disabled={locked} onClick={button.onPress}>
                            <Icon icon={CircleCheck} size={16} />
                            {sending ? t('sending') : button.label}
                        </PromptPrimary>
                    ) : (
                        <Button key={button.id} size="sm" disabled={locked} aria-description={button.description} onClick={button.onPress}>
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
    const { t } = useTranslation(['agent-prompts', 'agent-chat']);
    return (
        <>
            {index > 0 && (
                <Button size="sm" disabled={sending} onClick={onPrevious}>
                    {t('question.previous')}
                </Button>
            )}
            {dismissable && index === 0 && (
                <Button size="sm" disabled={locked} onClick={onDismiss}>
                    {t('agent-chat:common.action.dismiss')}
                </Button>
            )}
            <span className="grow" />
            <PromptPrimary disabled={locked || !ready} onClick={onCommit}>
                {sending ? t('sending') : last ? t('question.answer') : t('question.next')}
                <Icon icon={ArrowUp} size={16} />
            </PromptPrimary>
        </>
    );
}

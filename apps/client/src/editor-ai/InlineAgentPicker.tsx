import { useState, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown } from 'lucide-react';
import type { AgentKind } from '@ruimte/contracts';
import { AccountDot } from '@adecore/agents-react/agents/AccountDot';
import { useAccountChoice, type AccountChoice } from '@adecore/agents-react/chat/account-choice';
import { ModelPicker } from '@adecore/agents-react/chat/ui/Pickers';
import { useProviders } from '@adecore/agents-react/state/providers';
import { Icon, Menu } from '@adecore/ui';
import { availableAgents } from '@/agents/creation';

export interface InlineAgent {
    readonly provider: AgentKind;
    /* Null is the CLI's own default model. */
    readonly model: string | null;
    /* Absent is the CLI's default account. */
    readonly account?: string;
}

const CHIP_CLASS =
    'flex h-6 min-w-0 shrink items-center gap-1.5 whitespace-nowrap rounded-md bg-surface-hover px-2 text-xs text-text hover:bg-surface-active data-[popup-open]:bg-surface-active';

/* The accounts of the agent's CLI, only while the person has more than one of it. Picking the CLI's own account takes the pick away. */
function AccountChip({
    choice,
    provider,
    onPick,
    finalFocus
}: {
    choice: AccountChoice;
    provider: AgentKind;
    onPick(account: string | undefined): void;
    finalFocus?: RefObject<HTMLElement | null>;
}) {
    const { t } = useTranslation('inline-edit');
    const name = choice.current === null ? choice.currentId : choice.nameOf(choice.current);
    return (
        <Menu.Root>
            <Menu.Trigger className={CHIP_CLASS} aria-label={t('prompt.account', { provider: choice.providerName })}>
                <AccountDot color={choice.current?.account.color} className="size-1.75" />
                <span className="max-w-32 truncate">{name}</span>
                <Icon icon={ChevronDown} size={12} className="shrink-0 text-text-faint" />
            </Menu.Trigger>
            <Menu.Popup className="min-w-48" {...(finalFocus === undefined ? {} : { finalFocus })}>
                <Menu.RadioGroup value={choice.currentId} onValueChange={(id: string) => onPick(id === provider ? undefined : id)}>
                    {choice.offered.map((entry) => (
                        <Menu.RadioItem key={entry.id} value={entry.id} closeOnClick>
                            <AccountDot color={entry.account.color} />
                            <span className="truncate">{choice.nameOf(entry)}</span>
                        </Menu.RadioItem>
                    ))}
                </Menu.RadioGroup>
            </Menu.Popup>
        </Menu.Root>
    );
}

/* Which agent answers an inline edit, and its account while the CLI has more than one. The card and the AI settings both draw it. */
export function InlineAgentPicker({
    agent,
    onChange,
    finalFocus
}: {
    agent: InlineAgent;
    onChange(agent: InlineAgent): void;
    finalFocus?: RefObject<HTMLElement | null>;
}) {
    const { t } = useTranslation('inline-edit');
    const providers = useProviders((row) => row.providers);
    const [open, setOpen] = useState(false);
    const choice = useAccountChoice(agent.provider, agent.account);
    const offered = availableAgents(providers, 'chat');
    const owner = providers.find((provider) => provider.kind === agent.provider);

    if (offered.length === 0) {
        return <span className="text-xs text-text-muted">{t('prompt.noAgent')}</span>;
    }
    return (
        <>
            <ModelPicker
                providers={offered}
                provider={agent.provider}
                selection={{ model: agent.model ?? owner?.defaultModel ?? '', options: {} }}
                open={open}
                onOpenChange={setOpen}
                onChange={(provider, model) => onChange(provider === agent.provider ? { ...agent, model } : { provider, model })}
                kbd={null}
                side="bottom"
                trigger="chip"
                footer={t('prompt.note')}
                {...(finalFocus === undefined ? {} : { finalFocus })}
            />
            {choice !== null && (
                <AccountChip
                    choice={choice}
                    provider={agent.provider}
                    onPick={(account) => onChange({ provider: agent.provider, model: agent.model, ...(account === undefined ? {} : { account }) })}
                    {...(finalFocus === undefined ? {} : { finalFocus })}
                />
            )}
        </>
    );
}

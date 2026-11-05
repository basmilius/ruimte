import { useAccountChoice, type AccountChoice } from '@adecore/agents-react/chat';
import { ModelPicker } from '@adecore/agents-react/chat/ui';
import { AccountDot } from '@adecore/agents-react/providers';
import { useProviders } from '@adecore/agents-react/state';
import { Button, Icon, Menu } from '@adecore/ui';
import type { AgentKind } from '@ruimte/contracts';
import { ChevronDown } from 'lucide-react';
import { useState, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { availableAgents } from '@/agents/creation';
import { editorAgentOn, inlineEditAgentOn } from '@/state/ai-settings';

interface InlineAgent {
    readonly provider: AgentKind;
    /* Null is the CLI's own default model for an inline edit, and the cheapest available one for the editor model. */
    readonly model: string | null;
    /* Absent is the CLI's default account. */
    readonly account?: string;
}

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
            <Menu.Trigger
                render={<Button variant="secondary" size="sm" className="min-w-0 shrink gap-1.5" />}
                aria-label={t('prompt.account', { provider: choice.providerName })}
            >
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
    finalFocus,
    kinds,
    footer,
    capability = 'chat'
}: {
    agent: InlineAgent;
    onChange(agent: InlineAgent): void;
    kinds?: readonly AgentKind[];
    capability?: 'chat' | 'terminal';
    footer?: string;
    finalFocus?: RefObject<HTMLElement | null>;
}) {
    const { t } = useTranslation('inline-edit');
    const providers = useProviders((row) => row.providers);
    const [open, setOpen] = useState(false);
    // An inline edit is no chat of its own yet; the project in view gives the rule.
    // The editor model names the kinds it offers; an inline edit offers every chat agent.
    const resolved = kinds === undefined ? inlineEditAgentOn(providers, agent) : editorAgentOn(providers, agent, capability);
    const owner = providers.find((provider) => provider.kind === resolved.provider);
    const choice = useAccountChoice(resolved.provider, resolved.account, '');
    const offered = availableAgents(providers, capability).filter((provider) => kinds === undefined || kinds.includes(provider.kind));

    if (offered.length === 0) {
        return <span className="text-xs text-text-muted">{t('prompt.noAgent')}</span>;
    }
    return (
        <>
            <ModelPicker
                providers={offered}
                provider={resolved.provider}
                selection={{ model: resolved.model ?? owner?.defaultModel ?? '', options: {} }}
                open={open}
                onOpenChange={setOpen}
                onChange={(provider, model) => onChange(provider === agent.provider ? { ...agent, model } : { provider, model })}
                kbd={null}
                side="bottom"
                trigger="chip"
                footer={footer ?? t('prompt.note')}
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

import { Fragment, type ReactNode } from 'react';
import { Bot, MessageSquare } from 'lucide-react';
import type { ProviderInfo } from '@ruimte/contracts';
import { useTranslation } from 'react-i18next';
import { AccountDot, AgentIcon, accountsOfKind } from '@adecore/agents-react/providers';
import { agentTargetLabel, type AgentTarget } from '@/agents/nodes';
import { runtimeModeLabel, useAccountChoice, useChatPreferences } from '@adecore/agents-react/chat';
import { useProviderAccounts, useProviders } from '@adecore/agents-react/state';
import { availableAgents } from './creation';
import { useUi } from '@/state/ui';
import { useDetectProviders } from '@/transport/provider-detection';
import { Icon, Menu } from '@adecore/ui';

function Submenu({ label, icon, children }: { label: string; icon: ReactNode; children: ReactNode }) {
    return (
        <Menu.SubmenuRoot>
            <Menu.SubmenuTrigger>
                {icon} {label}
            </Menu.SubmenuTrigger>
            <Menu.Popup className="min-w-48">{children}</Menu.Popup>
        </Menu.SubmenuRoot>
    );
}

type PickAgent = (target: AgentTarget, provider: ProviderInfo, account?: string) => void;

/*
 * A CLI with a choice of accounts is a group under its own name, so a person starts on the account
 * they mean instead of switching in the composer afterwards; the composer still switches.
 */
function ProviderItems({ target, provider, hint, onPick }: { target: AgentTarget; provider: ProviderInfo; hint: string | null; onPick: PickAgent }) {
    const choice = useAccountChoice(provider.kind, undefined);
    if (choice === null) {
        return (
            <Menu.Item onClick={() => onPick(target, provider)}>
                <AgentIcon kind={provider.kind} />
                {provider.name}
                <Menu.Hint>{hint}</Menu.Hint>
            </Menu.Item>
        );
    }
    return (
        <Menu.Group>
            <Menu.GroupLabel className="flex items-center gap-2">
                <AgentIcon kind={provider.kind} />
                {provider.name}
            </Menu.GroupLabel>
            {choice.offered.map((entry) => (
                // The id goes along even for the CLI's own account: absent would mean the account picked for new agents.
                <Menu.Item key={entry.id} onClick={() => onPick(target, provider, entry.id)}>
                    <AccountDot color={entry.account.color} />
                    <span className="truncate">{choice.nameOf(entry)}</span>
                    <Menu.Hint>{hint}</Menu.Hint>
                </Menu.Item>
            ))}
        </Menu.Group>
    );
}

/*
 * The agent rows of one submenu, straight from the daemon's catalog so the dock, the canvas menu
 * and the palette can never drift apart. A CLI the daemon did not find is left out entirely: the
 * Agents settings pane is where "where did Copilot go" gets answered, not a disabled row here.
 */
function AgentRows({ target, onPick }: { target: AgentTarget; onPick: PickAgent }) {
    const { t } = useTranslation('agents');
    const providers = useProviders((s) => s.providers);
    const loaded = useProviders((s) => s.loaded);
    const accounts = useProviderAccounts((row) => row.accounts);
    const runtimeMode = useChatPreferences((s) => s.terminalRuntimeMode);
    const rows = availableAgents(providers, target);
    useDetectProviders();
    const hint = target === 'terminal' ? runtimeModeLabel(runtimeMode) : null;
    // Mirrors the choice `useAccountChoice` makes, so a separator sets each group apart from its neighbors.
    const grouped = rows.map((provider) => accountsOfKind(accounts, provider.kind).filter((entry) => entry.account.enabled !== false).length >= 2);

    if (rows.length === 0) {
        return loaded ? (
            <Menu.Item onClick={() => useUi.getState().setSettings({ open: true, section: 'agents' })}>
                <Icon icon={Bot} size={14} />
                {t('menu.setup')}
            </Menu.Item>
        ) : (
            <Menu.Item disabled>{t('menu.connecting')}</Menu.Item>
        );
    }
    return (
        <>
            {rows.map((provider, index) => (
                <Fragment key={provider.kind}>
                    {index > 0 && (grouped[index] || grouped[index - 1]) && <Menu.Separator />}
                    <ProviderItems target={target} provider={provider} hint={hint} onPick={onPick} />
                </Fragment>
            ))}
        </>
    );
}

export function ChatAgentSubmenu({ label, icon, onPick }: { label: string; icon: ReactNode; onPick(provider: ProviderInfo, account?: string): void }) {
    return (
        <Submenu label={label} icon={icon}>
            <AgentRows target="chat" onPick={(_target, provider, account) => onPick(provider, account)} />
        </Submenu>
    );
}

/* One target on its own, for a menu that puts its rows in an order of its own. */
export function AgentSubmenu({ target, onPick }: { target: AgentTarget; onPick: PickAgent }) {
    return (
        <Submenu label={agentTargetLabel(target)} icon={<Icon icon={target === 'chat' ? MessageSquare : Bot} size={14} />}>
            <AgentRows target={target} onPick={onPick} />
        </Submenu>
    );
}

export function AgentSubmenus({ onPick }: { onPick: PickAgent }) {
    return (
        <>
            <AgentSubmenu target="chat" onPick={onPick} />
            <AgentSubmenu target="terminal" onPick={onPick} />
        </>
    );
}

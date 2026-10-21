import type { ReactNode } from 'react';
import { Bot, MessageSquare } from 'lucide-react';
import type { ProviderInfo } from '@ruimte/contracts';
import { useTranslation } from 'react-i18next';
import { AccountDot, AgentIcon } from '@adecore/agents-react/providers';
import { agentTargetLabel, type AgentTarget } from '@/agents/nodes';
import { runtimeModeLabel, useChatPreferences, useNewAccountChoice } from '@adecore/agents-react/chat';
import { useProviders } from '@adecore/agents-react/state';
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

/* What the CLIs before one drew, which decides whether a separator sets it apart from them. */
type Drawn = 'nothing' | 'row' | 'group';

interface ChainProps {
    target: AgentTarget;
    provider: ProviderInfo;
    /* The CLIs after this one, in the order the menu lists them. */
    rest: ProviderInfo[];
    hint: string | null;
    onPick: PickAgent;
    drawn: Drawn;
    /* Whether a CLI before this one still waits for the accounts of the machine. */
    waiting: boolean;
}

/*
 * The rows of one CLI, then those of the CLIs after it. Each CLI's account choice is a hook,
 * and a separator and the empty state depend on the choices of the others, so every CLI hands what it
 * drew on to the next one rather than the menu working the choices out again beside the rows.
 *
 * A CLI with a choice of accounts is a group under its own name, so a person starts on the account they
 * mean instead of switching in the composer afterwards; the composer still switches. A known account
 * always goes along, also the CLI's own: absent would mean the account picked for new agents, which may
 * be one that is turned off.
 */
function ProviderChain({ target, provider, rest, hint, onPick, drawn, waiting }: ChainProps) {
    const { t } = useTranslation('agents');
    const choice = useNewAccountChoice(provider.kind);
    let own: ReactNode = null;
    let mine: Drawn = 'nothing';
    if (choice.status === 'unsupported') {
        // A machine without accounts for this CLI starts it under the CLI's own login.
        mine = 'row';
        own = (
            <Menu.Item onClick={() => onPick(target, provider)}>
                <AgentIcon kind={provider.kind} />
                {provider.name}
                <Menu.Hint>{hint}</Menu.Hint>
            </Menu.Item>
        );
    } else if (choice.status === 'ready' && choice.offered.length === 1) {
        const entry = choice.offered[0]!;
        mine = 'row';
        own = (
            <Menu.Item onClick={() => onPick(target, provider, entry.id)}>
                <AgentIcon kind={provider.kind} />
                <span className="truncate">
                    {entry.isDefault ? provider.name : t('menu.onAccount', { provider: provider.name, account: choice.nameOf(entry) })}
                </span>
                <Menu.Hint>{hint}</Menu.Hint>
            </Menu.Item>
        );
    } else if (choice.status === 'ready' && choice.offered.length > 1) {
        mine = 'group';
        own = (
            <Menu.Group>
                <Menu.GroupLabel className="flex items-center gap-2">
                    <AgentIcon kind={provider.kind} />
                    {provider.name}
                </Menu.GroupLabel>
                {choice.offered.map((entry) => (
                    <Menu.Item key={entry.id} onClick={() => onPick(target, provider, entry.id)}>
                        <AccountDot color={entry.account.color} />
                        <span className="truncate">{choice.nameOf(entry)}</span>
                        <Menu.Hint>{hint}</Menu.Hint>
                    </Menu.Item>
                ))}
            </Menu.Group>
        );
    }
    // While the accounts load nothing is offered: a start without one could land on an account that is off.
    const nextWaiting = waiting || choice.status === 'loading';
    const nextDrawn = mine === 'nothing' ? drawn : mine;
    const [next, ...after] = rest;
    return (
        <>
            {mine !== 'nothing' && drawn !== 'nothing' && (mine === 'group' || drawn === 'group') && <Menu.Separator />}
            {own}
            {next === undefined ? (
                nextDrawn === 'nothing' && <NoAgentRow connecting={nextWaiting} />
            ) : (
                <ProviderChain
                    key={next.kind}
                    target={target}
                    provider={next}
                    rest={after}
                    hint={hint}
                    onPick={onPick}
                    drawn={nextDrawn}
                    waiting={nextWaiting}
                />
            )}
        </>
    );
}

/* What the submenu says when it has no agent to start: it is still connecting, or there is none to set up yet. */
function NoAgentRow({ connecting }: { connecting: boolean }) {
    const { t } = useTranslation('agents');
    if (connecting) {
        return <Menu.Item disabled>{t('menu.connecting')}</Menu.Item>;
    }
    return (
        <Menu.Item onClick={() => useUi.getState().setSettings({ open: true, section: 'agents' })}>
            <Icon icon={Bot} size={14} />
            {t('menu.setup')}
        </Menu.Item>
    );
}

/*
 * The agent rows of one submenu, straight from the daemon's catalog so the dock, the canvas menu
 * and the palette can never drift apart. A CLI the daemon did not find is left out entirely: the
 * Agents settings pane is where "where did Copilot go" gets answered, not a disabled row here.
 * So is a CLI whose accounts are all turned off.
 */
function AgentRows({ target, onPick }: { target: AgentTarget; onPick: PickAgent }) {
    const providers = useProviders((s) => s.providers);
    const loaded = useProviders((s) => s.loaded);
    const runtimeMode = useChatPreferences((s) => s.terminalRuntimeMode);
    const rows = availableAgents(providers, target);
    useDetectProviders();
    const hint = target === 'terminal' ? runtimeModeLabel(runtimeMode) : null;

    const [first, ...rest] = rows;
    if (first === undefined) {
        return <NoAgentRow connecting={!loaded} />;
    }
    return <ProviderChain key={first.kind} target={target} provider={first} rest={rest} hint={hint} onPick={onPick} drawn="nothing" waiting={false} />;
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

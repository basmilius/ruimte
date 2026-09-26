import type { ReactNode } from 'react';
import { Menu } from '@base-ui-components/react/menu';
import { Bot, ChevronRight, MessageSquare } from 'lucide-react';
import type { ProviderInfo } from '@ruimte/contracts';
import { useTranslation } from 'react-i18next';
import { AgentIcon } from '@ruimte/agents-react/agents/AgentIcon';
import { agentTargetLabel, type AgentTarget } from '@/agents/nodes';
import { runtimeModeLabel } from '@/chat/runtime-modes';
import { useChatPreferences } from '@ruimte/agents-react/chat/preferences';
import { useProviders } from '@ruimte/agents-react/state/providers';
import { MENU_HINT } from '@ruimte/ui/classes';
import { Icon } from '@ruimte/ui/Icon';

function Submenu({ label, icon, children }: { label: string; icon: ReactNode; children: ReactNode }) {
    return (
        <Menu.SubmenuRoot>
            <Menu.SubmenuTrigger className="menu-item">
                {icon} {label}
                <Icon icon={ChevronRight} size={14} className="ml-auto text-text-faint" />
            </Menu.SubmenuTrigger>
            <Menu.Portal>
                <Menu.Positioner className="z-(--z-popup)" sideOffset={4} alignOffset={-4}>
                    <Menu.Popup className="menu-popup min-w-48">{children}</Menu.Popup>
                </Menu.Positioner>
            </Menu.Portal>
        </Menu.SubmenuRoot>
    );
}

/*
 * The agent rows of one submenu, straight from the daemon's catalog so the dock, the canvas menu
 * and the palette can never drift apart. A CLI the daemon did not find is left out entirely: the
 * Agents settings pane is where "where did Gemini go" gets answered, not a disabled row here.
 */
function AgentRows({ target, onPick }: { target: AgentTarget; onPick(target: AgentTarget, provider: ProviderInfo): void }) {
    const { t } = useTranslation('agents');
    const providers = useProviders((s) => s.providers);
    const loaded = useProviders((s) => s.loaded);
    const runtimeMode = useChatPreferences((s) => s.terminalRuntimeMode);
    const rows = providers.filter((provider) => provider.installed && provider.capabilities[target]);
    const modeLabel = runtimeModeLabel(runtimeMode);

    if (rows.length === 0) {
        return (
            <Menu.Item className="menu-item" disabled>
                {loaded ? t('menu.none') : t('menu.connecting')}
            </Menu.Item>
        );
    }
    return (
        <>
            {rows.map((provider) => (
                <Menu.Item key={provider.kind} className="menu-item" onClick={() => onPick(target, provider)}>
                    <AgentIcon kind={provider.kind} />
                    {provider.name}
                    <span className={MENU_HINT}>{target === 'terminal' ? modeLabel : null}</span>
                </Menu.Item>
            ))}
        </>
    );
}

export function ChatAgentSubmenu({ label, icon, onPick }: { label: string; icon: ReactNode; onPick(provider: ProviderInfo): void }) {
    return (
        <Submenu label={label} icon={icon}>
            <AgentRows target="chat" onPick={(_target, provider) => onPick(provider)} />
        </Submenu>
    );
}

/* One target on its own, for a menu that puts its rows in an order of its own. */
export function AgentSubmenu({ target, onPick }: { target: AgentTarget; onPick(target: AgentTarget, provider: ProviderInfo): void }) {
    return (
        <Submenu label={agentTargetLabel(target)} icon={<Icon icon={target === 'chat' ? MessageSquare : Bot} size={14} />}>
            <AgentRows target={target} onPick={onPick} />
        </Submenu>
    );
}

export function AgentSubmenus({ onPick }: { onPick(target: AgentTarget, provider: ProviderInfo): void }) {
    return (
        <>
            <AgentSubmenu target="chat" onPick={onPick} />
            <AgentSubmenu target="terminal" onPick={onPick} />
        </>
    );
}

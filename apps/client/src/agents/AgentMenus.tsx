import type { ReactNode } from 'react';
import { Menu } from '@base-ui-components/react/menu';
import { faChevronRight, faMessage, faRobot } from '@fortawesome/pro-regular-svg-icons';
import type { ProviderInfo } from '@ruimte/contracts';
import { AgentIcon } from '@/agents/AgentIcon';
import { AGENT_TARGET_LABEL, type AgentTarget } from '@/agents/nodes';
import { RUNTIME_MODES } from '@/chat/runtime-modes';
import { useChatPreferences } from '@/chat/preferences';
import { useProviders } from '@/state/providers';
import { Icon } from '@/ui/Icon';

/* A nested menu, in the popup of the dock as well as in the canvas's context menu: the parts are the same. */
function Submenu({ label, icon, children }: { label: string; icon: ReactNode; children: ReactNode }) {
    return (
        <Menu.SubmenuRoot>
            <Menu.SubmenuTrigger className="menu-item">
                {icon} {label}
                <Icon icon={faChevronRight} size={16} className="ml-auto text-text-faint" />
            </Menu.SubmenuTrigger>
            <Menu.Portal>
                <Menu.Positioner className="z-50" sideOffset={4} alignOffset={-4}>
                    <Menu.Popup className="menu-popup min-w-48">{children}</Menu.Popup>
                </Menu.Positioner>
            </Menu.Portal>
        </Menu.SubmenuRoot>
    );
}

/*
 * The agent rows of one submenu, straight from the daemon's catalog so the dock, the canvas menu
 * and the palette can never drift apart. A CLI the daemon did not find is disabled with a hint
 * instead of hidden, so "where did Gemini go" answers itself.
 */
function AgentRows({ target, onPick }: { target: AgentTarget; onPick(target: AgentTarget, provider: ProviderInfo): void }) {
    const providers = useProviders((s) => s.providers);
    const loaded = useProviders((s) => s.loaded);
    const runtimeMode = useChatPreferences((s) => s.terminalRuntimeMode);
    const rows = providers.filter((provider) => provider.capabilities[target]);
    const modeLabel = RUNTIME_MODES.find((mode) => mode.id === runtimeMode)?.label;

    if (rows.length === 0) {
        return (
            <Menu.Item className="menu-item" disabled>
                {loaded ? 'No agent CLI found' : 'Connecting'}
            </Menu.Item>
        );
    }
    return (
        <>
            {rows.map((provider) => (
                <Menu.Item key={provider.kind} className="menu-item" disabled={!provider.installed} onClick={() => onPick(target, provider)}>
                    <AgentIcon kind={provider.kind} />
                    {provider.name}
                    <span className="ml-auto pl-3 text-xs text-text-faint">
                        {!provider.installed ? 'Not installed' : target === 'terminal' ? modeLabel : null}
                    </span>
                </Menu.Item>
            ))}
        </>
    );
}

/* The two agent submenus, "Agent (Chat)" and "Agent (Terminal)", for every menu that adds nodes. */
export function AgentSubmenus({ onPick }: { onPick(target: AgentTarget, provider: ProviderInfo): void }) {
    return (
        <>
            <Submenu label={AGENT_TARGET_LABEL.chat} icon={<Icon icon={faMessage} size={16} />}>
                <AgentRows target="chat" onPick={onPick} />
            </Submenu>
            <Submenu label={AGENT_TARGET_LABEL.terminal} icon={<Icon icon={faRobot} size={16} />}>
                <AgentRows target="terminal" onPick={onPick} />
            </Submenu>
        </>
    );
}

import type { ProviderInfo } from '@ruimte/contracts';
import { useTranslation } from 'react-i18next';
import { Icon, Tile } from '@adecore/ui';
import { AgentSubmenu, ChatAgentPicker } from '@/agents/AgentMenus';
import type { Point } from '@/canvas/math';
import { NODE_KIND_ICONS } from '@/canvas/node-icons';
import { addDesignNode, useDesignOffered } from '@/design/design-create';
import { useCanvasStore } from '@/state/canvas';

function useAddDesign(at: () => Point): (provider: ProviderInfo, account?: string) => void {
    const canvasStore = useCanvasStore();
    return (provider, account) => void addDesignNode(canvasStore, provider, at(), account === undefined ? {} : { account });
}

/* A design node on the CLI a person picks, in every menu that adds to a canvas. */
export function DesignAddItem({ at }: { at: () => Point }) {
    const { t } = useTranslation('canvas');
    const offered = useDesignOffered();
    const add = useAddDesign(at);
    if (!offered) {
        return null;
    }
    return (
        <AgentSubmenu
            target="chat"
            label={t('canvasMenu.design')}
            icon={NODE_KIND_ICONS.design}
            onPick={(_target, provider, account) => add(provider, account)}
        />
    );
}

/* The same offer as a tile on an empty canvas, which asks for the CLI in a menu of its own; the canvas checks `useDesignOffered`. */
export function DesignTile({ at }: { at: () => Point }) {
    const { t } = useTranslation('canvas');
    const add = useAddDesign(at);
    return (
        <ChatAgentPicker
            trigger={<Tile icon={<Icon icon={NODE_KIND_ICONS.design} size={16} />} title={t('canvasMenu.design')} description={t('empty.design')} />}
            onPick={add}
        />
    );
}

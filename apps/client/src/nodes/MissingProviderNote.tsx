import { lastSettledTurn } from '@adecore/agents-react/chat';
import { useChatRow, useProvidersStore } from '@adecore/agents-react/state';
import type { AgentKind } from '@ruimte/contracts';
import { useTranslation } from 'react-i18next';
import { openForkDialog } from '@/chat/open-fork';
import { missingProvider } from '@/nodes/missing-provider';
import { NodeNotice } from '@/nodes/NodeNotice';
import { useUi } from '@/state/ui';

interface MissingProviderNoteProps {
    endpointId: string;
    kind: AgentKind | undefined;
    /* The chat this note stands in, which can go on with another provider once it holds a finished turn. */
    chatId?: string;
}

/* What a terminal or a chat says when its machine has no CLI of its kind. */
export function MissingProviderNote({ endpointId, kind, chatId = '' }: MissingProviderNoteProps) {
    const { t } = useTranslation('canvas');
    const row = useProvidersStore((s) => s.byScope[endpointId]);
    const turnId = useChatRow(chatId, (chat) => (chat ? lastSettledTurn(chat.structure, chat.order) : null));
    const missing = missingProvider(row, kind);
    if (missing === null) {
        return null;
    }
    const install = {
        label: t('missingProvider.install'),
        onClick: () => useUi.getState().setSettings({ open: true, section: 'providers', target: `providers.install.${kind}` })
    };
    const goOn = turnId === null ? undefined : { label: t('missingProvider.continueElsewhere'), onClick: () => openForkDialog(chatId, turnId) };
    return (
        <NodeNotice action={missing.installable ? install : goOn}>
            {missing.installable ? t('missingProvider.notInstalled', { name: missing.name }) : t('missingProvider.notOffered', { name: missing.name })}
        </NodeNotice>
    );
}

import { useChatHost } from '@adecore/agents-react';
import { lastSettledTurn } from '@adecore/agents-react/chat';
import { useChatRow, useProvidersStore } from '@adecore/agents-react/state';
import type { AgentKind } from '@ruimte/contracts';
import { useTranslation } from 'react-i18next';
import { missingProvider } from '@/nodes/missing-provider';
import { useUi } from '@/state/ui';
import { NodeNotice } from '@/surface/nodes/NodeNotice';

interface MissingProviderNoteProps {
    endpointId: string;
    kind: AgentKind | undefined;
    /* The chat this note stands in, which can go on with another provider once it holds a finished turn. */
    chatId?: string;
}

export function MissingProviderNote({ endpointId, kind, chatId = '' }: MissingProviderNoteProps) {
    const { t } = useTranslation('canvas');
    // The fork dialog is the chat feature's, which the host hands to whatever shows a chat.
    const fork = useChatHost().fork;
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
    const goOn = turnId === null || fork === null ? undefined : { label: t('missingProvider.continueElsewhere'), onClick: () => fork(chatId, turnId) };
    return (
        <NodeNotice action={missing.installable ? install : goOn}>
            {missing.installable ? t('missingProvider.notInstalled', { name: missing.name }) : t('missingProvider.notOffered', { name: missing.name })}
        </NodeNotice>
    );
}

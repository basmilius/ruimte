import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { AgentKind } from '@ruimte/contracts';
import { useProvidersStore } from '@adecore/agents-react/state';
import { missingProvider } from '@/nodes/missing-provider';
import { NodeNotice } from '@/nodes/NodeNotice';
import { useUi } from '@/state/ui';

/* What a terminal or a chat says when its machine has no CLI of its kind. */
export function MissingProviderNote({ endpointId, kind }: { endpointId: string; kind: AgentKind | undefined }) {
    const { t } = useTranslation('canvas');
    const row = useProvidersStore((s) => s.byScope[endpointId]);
    const missing = useMemo(() => missingProvider(row, kind), [row, kind]);
    if (missing === null) {
        return null;
    }
    return (
        <NodeNotice
            action={
                missing.installable
                    ? {
                          label: t('missingProvider.install'),
                          onClick: () => useUi.getState().setSettings({ open: true, section: 'providers', target: `providers.install.${kind}` })
                      }
                    : undefined
            }
        >
            {missing.installable ? t('missingProvider.notInstalled', { name: missing.name }) : t('missingProvider.notOffered', { name: missing.name })}
        </NodeNotice>
    );
}

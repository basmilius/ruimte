import { useProvidersStore } from '@adecore/agents-react/state';
import type { AgentKind } from '@ruimte/contracts';
import { useTranslation } from 'react-i18next';
import { missingProvider } from '@/nodes/missing-provider';
import { useUi } from '@/state/ui';
import { NodeNotice } from '@/surface/nodes/NodeNotice';

/* What a terminal or a chat says when its machine has no CLI of its kind. */
export function MissingProviderNote({ endpointId, kind }: { endpointId: string; kind: AgentKind | undefined }) {
    const { t } = useTranslation('canvas');
    const row = useProvidersStore((s) => s.byScope[endpointId]);
    const missing = missingProvider(row, kind);
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

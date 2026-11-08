import { Button, IconButton, useNow } from '@adecore/ui';
import { formatAgo } from '@adecore/ui/format';
import { ConfirmDialog, SettingsRow } from '@adecore/ui/settings';
import type { Credential, TunnelState } from '@ruimte/contracts';
import { Trash } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SettingsSection } from '@/shell/settings/SettingsSection';
import { NewCredentialDialog } from '@/shell/settings/tunnels/NewCredentialDialog';
import { transportFor } from '@/transport';

const MINUTE_MS = 60_000;

/* The text under a credential: its tier, the projects it reaches, the widest mode it starts agents in, and when it was last used. */
function describeCredential(credential: Credential, t: (key: string, options?: Record<string, unknown>) => string, now: number): string {
    const { grant } = credential;
    const parts = [
        t(`tunnels.credentials.tier.${grant.tier}`),
        grant.projects === null ? t('tunnels.credentials.allProjects') : t('tunnels.credentials.someProjects', { count: grant.projects.length }),
        t('tunnels.credentials.ceilingIs', { mode: grant.ceiling }),
        t(credential.kind === 'oauth' ? 'tunnels.credentials.oauth' : 'tunnels.credentials.bearer')
    ];

    if (grant.approvals) {
        parts.push(t('tunnels.credentials.approvalsOn'));
    }

    if (credential.expiresAt !== null) {
        parts.push(t('tunnels.credentials.expires'));
    }

    parts.push(
        credential.lastUsedAt === null ? t('tunnels.credentials.neverUsed') : t('tunnels.credentials.lastUsed', { ago: formatAgo(now - credential.lastUsedAt) })
    );

    return parts.join(' · ');
}

/*
 * The clients elsewhere that hold a credential, each with one Revoke. A credential has no end date unless its person set one, so
 * noticing a client is the way to stop one: the list shows its label, what it reaches and when it last asked.
 */
export function CredentialsSection({
    endpointId,
    state,
    credentials,
    reload
}: {
    endpointId: string;
    state: TunnelState;
    credentials: Credential[] | null;
    reload: () => void;
}) {
    const { t } = useTranslation('settings');
    const now = useNow(MINUTE_MS);
    const [creating, setCreating] = useState(false);
    const [target, setTarget] = useState<Credential | null>(null);

    const revoke = async (): Promise<void> => {
        if (target) {
            await transportFor(endpointId)?.request('credential.revoke', { id: target.id });
            reload();
        }
    };

    return (
        <SettingsSection title={t('tunnels.credentials.title')} description={t('tunnels.credentials.description')} scope="machine" machine="picked">
            <SettingsRow
                label={t('tunnels.credentials.address')}
                description={state.mcp.enabled && state.mcp.port !== null ? undefined : t('tunnels.credentials.addressOff')}
                control={
                    state.mcp.enabled && state.mcp.port !== null ? (
                        <code className="text-xs text-text-muted select-all">{`http://127.0.0.1:${state.mcp.port}/mcp`}</code>
                    ) : undefined
                }
            />
            <SettingsRow
                label={t('tunnels.credentials.clients', { count: state.clients })}
                control={
                    <Button disabled={!state.mcp.enabled} onClick={() => setCreating(true)}>
                        {t('tunnels.credentials.create')}
                    </Button>
                }
            />
            {credentials?.map((credential) => (
                <SettingsRow
                    key={credential.id}
                    label={credential.label}
                    description={describeCredential(credential, t, now)}
                    control={
                        <IconButton
                            icon={Trash}
                            label={t('tunnels.credentials.revokeOne', { label: credential.label })}
                            tooltip={t('tunnels.credentials.revoke')}
                            onClick={() => setTarget(credential)}
                        />
                    }
                />
            ))}
            <NewCredentialDialog open={creating} endpointId={endpointId} port={state.mcp.port} onOpenChange={setCreating} onCreated={reload} />
            <ConfirmDialog
                open={target !== null}
                onOpenChange={(next) => (next ? undefined : setTarget(null))}
                title={t('tunnels.credentials.confirm.title', { label: target?.label ?? '' })}
                description={t('tunnels.credentials.confirm.text')}
                confirmLabel={t('tunnels.credentials.revoke')}
                onConfirm={revoke}
            />
        </SettingsSection>
    );
}

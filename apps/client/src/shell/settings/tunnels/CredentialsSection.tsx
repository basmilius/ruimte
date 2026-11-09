import { Button, Icon, IconButton, Menu, Pill, RelativeTime, Switch, Table, useNow } from '@adecore/ui';
import { ConfirmDialog, useSettingsTarget } from '@adecore/ui/settings';
import type { Credential, TunnelState } from '@ruimte/contracts';
import { MoreHorizontal, Trash } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SettingsSection } from '@/shell/settings/SettingsSection';
import { NewCredentialDialog } from '@/shell/settings/tunnels/NewCredentialDialog';
import type { TunnelChange } from '@/shell/settings/tunnels/use-tunnels';
import { transportFor } from '@/transport';

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 3_600_000;

/* How long the switch a search result jumped to stays lit, as long as a settings row does. */
const TARGET_MS = 1600;

const COLUMNS = [
    { width: 'minmax(0,2fr)' },
    { width: 'auto', hideBelow: 'sm' },
    { width: 'minmax(0,2fr)', hideBelow: 'lg' },
    { width: 'auto', hideBelow: 'md' },
    { width: 'auto', align: 'end' }
] as const;

/*
 * The clients elsewhere that hold a credential, each with Revoke in its menu. A credential has no end date unless its
 * person set one, so noticing a client is the way to stop one.
 */
export function CredentialsSection({
    endpointId,
    state,
    credentials,
    reload,
    change
}: {
    endpointId: string;
    state: TunnelState;
    credentials: Credential[] | null;
    reload: () => void;
    change: TunnelChange;
}) {
    const { t } = useTranslation('settings');
    const [creating, setCreating] = useState(false);
    // The credential stays after Revoke closes, so the title holds its label through the closing transition.
    const [target, setTarget] = useState<Credential | null>(null);
    const [revoking, setRevoking] = useState(false);
    const address = state.mcp.enabled && state.mcp.port !== null ? `http://127.0.0.1:${state.mcp.port}/mcp` : null;

    const revoke = async (): Promise<void> => {
        if (target) {
            await transportFor(endpointId)?.request('credential.revoke', { id: target.id });
            reload();
        }
    };

    return (
        <SettingsSection
            title={t('tunnels.clients.title')}
            description={
                address !== null ? (
                    <>
                        {t('tunnels.clients.address')} <code className="font-mono select-all">{address}</code>
                    </>
                ) : state.mcp.enabled && state.mcp.failure !== undefined ? (
                    <span className="flex flex-wrap items-center gap-2">
                        <span className="text-status-error">{t('tunnels.clients.notListening')}</span>
                        {/* Without a tunnel the Cloudflare rows offer no Try again, and the machine starts the listener without a token. */}
                        {(state.stage === 'no-token' || state.stage === 'no-tunnel') && (
                            <Button size="sm" variant="ghost" onClick={() => void change('tunnel.retry')}>
                                {t('tunnels.retry')}
                            </Button>
                        )}
                    </span>
                ) : undefined
            }
            action={
                <div className="flex items-center gap-3">
                    <McpSwitch enabled={state.mcp.enabled} onChange={(enabled) => void change('tunnel.setMcp', { enabled })} />
                    <Button size="sm" disabled={!state.mcp.enabled} onClick={() => setCreating(true)}>
                        {t('tunnels.clients.create')}
                    </Button>
                </div>
            }
            scope="machine"
            machine="picked"
        >
            <Table.Root label={t('tunnels.clients.title')} columns={COLUMNS}>
                <Table.Head>
                    <Table.Column>{t('tunnels.clients.client')}</Table.Column>
                    <Table.Column>{t('tunnels.clients.kind')}</Table.Column>
                    <Table.Column>{t('tunnels.clients.reach')}</Table.Column>
                    <Table.Column>{t('tunnels.clients.lastUsed')}</Table.Column>
                    <Table.Column />
                </Table.Head>
                {credentials === null || credentials.length === 0 ? (
                    <Table.Empty>{t('tunnels.clients.empty')}</Table.Empty>
                ) : (
                    credentials.map((credential) => (
                        <CredentialRow
                            key={credential.id}
                            credential={credential}
                            onRevoke={() => {
                                setTarget(credential);
                                setRevoking(true);
                            }}
                        />
                    ))
                )}
            </Table.Root>
            <NewCredentialDialog open={creating} endpointId={endpointId} port={state.mcp.port} onOpenChange={setCreating} onCreated={reload} />
            <ConfirmDialog
                open={revoking}
                onOpenChange={setRevoking}
                title={t('tunnels.clients.revokeTitle', { label: target?.label ?? '' })}
                description={t('tunnels.clients.revokeText')}
                confirmLabel={t('tunnels.clients.revoke')}
                onConfirm={revoke}
            />
        </SettingsSection>
    );
}

/* The switch of the external MCP, on the section's header line, and where a search for it leads. */
function McpSwitch({ enabled, onChange }: { enabled: boolean; onChange: (enabled: boolean) => void }) {
    const { t } = useTranslation('settings');
    const box = useRef<HTMLSpanElement>(null);
    const { target, shown } = useSettingsTarget();
    const targeted = target === 'tunnels.mcp';

    useEffect(() => {
        if (!targeted) {
            return;
        }

        box.current?.scrollIntoView({ block: 'center' });
        const timer = window.setTimeout(shown, TARGET_MS);

        return () => window.clearTimeout(timer);
    }, [targeted, shown]);

    return (
        <span ref={box} data-settings-row="tunnels.mcp" className="flex items-center gap-2 text-xs text-text-muted">
            <span aria-hidden>{t('tunnels.clients.mcp')}</span>
            <Switch checked={enabled} label={t('tunnels.clients.mcp')} onCheckedChange={onChange} />
        </span>
    );
}

function CredentialRow({ credential, onRevoke }: { credential: Credential; onRevoke: () => void }) {
    const { t } = useTranslation('settings');
    const now = useNow(MINUTE_MS);
    const { grant, expiresAt } = credential;
    const expired = expiresAt !== null && expiresAt <= now;
    const reach = [
        t(`tunnels.tier.${grant.tier}`),
        grant.projects === null ? t('tunnels.clients.allProjects') : t('tunnels.clients.projects', { count: grant.projects.length })
    ];

    if (grant.approvals) {
        reach.push(t('tunnels.clients.approves'));
    }

    const expiry =
        expiresAt === null
            ? t('tunnels.clients.neverExpires')
            : expired
              ? t('tunnels.clients.expired')
              : t('tunnels.clients.expiresIn', { count: Math.ceil((expiresAt - now) / DAY_MS) });

    return (
        <Table.Row>
            <Table.Cell>
                <div className="min-w-0">
                    <div className="truncate">{credential.label}</div>
                    <div className="truncate text-xs text-text-muted">{expiry}</div>
                </div>
            </Table.Cell>
            <Table.Cell>
                <Pill size="sm" tone={expired ? 'error' : 'muted'}>
                    {t(credential.kind === 'oauth' ? 'tunnels.clients.oauth' : 'tunnels.clients.bearer')}
                </Pill>
            </Table.Cell>
            <Table.Cell>{reach.join(' · ')}</Table.Cell>
            <Table.Cell className="text-text-muted">
                {credential.lastUsedAt === null ? t('tunnels.clients.never') : <RelativeTime at={credential.lastUsedAt} />}
            </Table.Cell>
            <Table.Cell>
                <Menu.Root>
                    <IconButton icon={MoreHorizontal} size="sm" label={t('tunnels.clients.more', { label: credential.label })} render={<Menu.Trigger />} />
                    <Menu.Popup align="end">
                        <Menu.Item onClick={onRevoke}>
                            <Icon icon={Trash} size={14} /> {t('tunnels.clients.revoke')}
                        </Menu.Item>
                    </Menu.Popup>
                </Menu.Root>
            </Table.Cell>
        </Table.Row>
    );
}

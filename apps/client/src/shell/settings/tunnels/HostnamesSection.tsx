import { Button, copyText, Icon, IconButton, Menu, Switch, Table } from '@adecore/ui';
import type { TunnelOtherRule, TunnelRow, TunnelState } from '@ruimte/contracts';
import { Copy, ExternalLink, MoreHorizontal, Trash } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { openInSystemBrowser } from '@/desktop/bridge';
import { SettingsSection } from '@/shell/settings/SettingsSection';
import { AddHostnameDialog } from '@/shell/settings/tunnels/AddHostnameDialog';
import type { TunnelChange, TunnelChangeType } from '@/shell/settings/tunnels/use-tunnels';

const COLUMNS = [{ width: 'minmax(0,3fr)' }, { width: 'minmax(0,2fr)', hideBelow: 'md' }, { width: 'auto', align: 'end' }] as const;

/* Where a row's address goes: the MCP answers on `/mcp`, a dev server at its root. */
function addressOf(row: TunnelRow): string {
    return row.kind === 'mcp' ? `https://${row.hostname}/mcp` : `https://${row.hostname}`;
}

function ruleName(rule: TunnelOtherRule): string {
    return `${rule.hostname ?? '*'}${rule.path ?? ''}`;
}

/* The hostnames of the tunnel: Ruimte's own, each with a switch and a menu, and the ones someone else put there, read-only. */
export function HostnamesSection({
    state,
    endpointId,
    change,
    attempt
}: {
    state: TunnelState;
    endpointId: string;
    change: TunnelChange;
    attempt: (type: TunnelChangeType, payload?: object) => Promise<string | null>;
}) {
    const { t } = useTranslation('settings');
    const [adding, setAdding] = useState(false);
    const others = state.tunnel?.others ?? [];

    return (
        <SettingsSection
            title={t('tunnels.hostnames.title')}
            description={t('tunnels.hostnames.description')}
            action={<Button onClick={() => setAdding(true)}>{t('tunnels.hostnames.add')}</Button>}
            scope="machine"
            machine="picked"
        >
            <Table.Root label={t('tunnels.hostnames.title')} columns={COLUMNS}>
                <Table.Head>
                    <Table.Column>{t('tunnels.hostnames.hostname')}</Table.Column>
                    <Table.Column>{t('tunnels.hostnames.target')}</Table.Column>
                    <Table.Column />
                </Table.Head>
                {state.rows.length === 0 && others.length === 0 && <Table.Empty>{t('tunnels.hostnames.empty')}</Table.Empty>}
                {state.rows.length > 0 && (
                    <Table.Group label={t('tunnels.hostnames.ruimte')}>
                        {state.rows.map((row) => (
                            <HostnameRow key={row.id} row={row} change={change} />
                        ))}
                    </Table.Group>
                )}
                {others.length > 0 && (
                    <Table.Group label={t('tunnels.hostnames.others')}>
                        {others.map((rule) => (
                            <Table.Row key={ruleName(rule)} muted>
                                <Table.Cell>{ruleName(rule)}</Table.Cell>
                                <Table.Cell mono>{rule.service.replace(/^https?:\/\//, '')}</Table.Cell>
                                <Table.Cell />
                            </Table.Row>
                        ))}
                    </Table.Group>
                )}
            </Table.Root>
            {adding && <AddHostnameDialog state={state} endpointId={endpointId} attempt={attempt} onClose={() => setAdding(false)} />}
        </SettingsSection>
    );
}

function HostnameRow({ row, change }: { row: TunnelRow; change: TunnelChange }) {
    const { t } = useTranslation('settings');

    return (
        <Table.Row>
            <Table.Cell>{row.hostname}</Table.Cell>
            {row.kind === 'mcp' ? <Table.Cell>{t('tunnels.hostnames.mcp')}</Table.Cell> : <Table.Cell mono>{`localhost:${row.port ?? 0}`}</Table.Cell>}
            <Table.Cell>
                <Switch
                    checked={row.enabled}
                    label={t('tunnels.hostnames.on', { hostname: row.hostname })}
                    onCheckedChange={(enabled) => void change('tunnel.update', { id: row.id, enabled })}
                />
                <Menu.Root>
                    <IconButton icon={MoreHorizontal} size="sm" label={t('tunnels.hostnames.more', { hostname: row.hostname })} render={<Menu.Trigger />} />
                    <Menu.Popup align="end">
                        <Menu.Item onClick={() => void copyText(addressOf(row))}>
                            <Icon icon={Copy} size={14} /> {t('tunnels.hostnames.copy')}
                        </Menu.Item>
                        {row.kind === 'dev' && (
                            <Menu.Item onClick={() => openInSystemBrowser(addressOf(row))}>
                                <Icon icon={ExternalLink} size={14} /> {t('tunnels.hostnames.open')}
                            </Menu.Item>
                        )}
                        <Menu.CheckboxItem checked={row.comeBack} onCheckedChange={(comeBack) => void change('tunnel.update', { id: row.id, comeBack })}>
                            {t('tunnels.hostnames.comeBack')}
                        </Menu.CheckboxItem>
                        <Menu.Separator />
                        <Menu.Item onClick={() => void change('tunnel.remove', { id: row.id })}>
                            <Icon icon={Trash} size={14} /> {t('tunnels.hostnames.remove')}
                        </Menu.Item>
                    </Menu.Popup>
                </Menu.Root>
            </Table.Cell>
        </Table.Row>
    );
}

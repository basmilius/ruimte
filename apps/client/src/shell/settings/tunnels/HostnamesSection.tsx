import { Button, copyText, Icon, IconButton, Menu, Spinner, Switch, Table, Tooltip } from '@adecore/ui';
import type { TunnelOtherRule, TunnelRow, TunnelState } from '@ruimte/contracts';
import { Copy, ExternalLink, MoreHorizontal, Pencil, Trash, TriangleAlert } from 'lucide-react';
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

/* Where a hostname points, with the `Host` header after it when one is set, as in `localhost:80 · passly.test`. */
function targetOf(target: string, hostHeader: string | undefined): string {
    return hostHeader === undefined ? target : `${target} · ${hostHeader}`;
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
    // The row stays after the dialog closes, so an edit keeps its fields through the closing transition.
    const [dialog, setDialog] = useState<{ open: boolean; row: TunnelRow | null }>({ open: false, row: null });
    // The rows with a change on its way to Cloudflare, which takes seconds.
    const [busy, setBusy] = useState<ReadonlySet<string>>(() => new Set());
    const others = state.tunnel?.others ?? [];
    // Before Cloudflare answered, the rules of someone else are unknown, so the table waits instead of saying it is empty.
    const checking = state.stage === 'checking' && others.length === 0;
    const editing = dialog.row;

    const busyWhile = async <T,>(id: string, work: () => Promise<T>): Promise<T> => {
        setBusy((current) => new Set(current).add(id));

        try {
            return await work();
        } finally {
            setBusy((current) => {
                const next = new Set(current);

                next.delete(id);

                return next;
            });
        }
    };

    const attemptRow: typeof attempt = (type, payload) => (editing === null ? attempt(type, payload) : busyWhile(editing.id, () => attempt(type, payload)));

    return (
        <SettingsSection
            title={t('tunnels.hostnames.title')}
            description={t('tunnels.hostnames.description')}
            action={
                <Button size="sm" onClick={() => setDialog({ open: true, row: null })}>
                    {t('tunnels.hostnames.add')}
                </Button>
            }
            scope="machine"
            machine="picked"
        >
            <Table.Root label={t('tunnels.hostnames.title')} columns={COLUMNS}>
                <Table.Head>
                    <Table.Column>{t('tunnels.hostnames.hostname')}</Table.Column>
                    <Table.Column>{t('tunnels.hostnames.target')}</Table.Column>
                    <Table.Column />
                </Table.Head>
                {state.rows.length === 0 && others.length === 0 && !checking && <Table.Empty>{t('tunnels.hostnames.empty')}</Table.Empty>}
                {state.rows.length > 0 && (
                    <Table.Group label={t('tunnels.hostnames.ruimte')}>
                        {state.rows.map((row) => (
                            <HostnameRow
                                key={row.id}
                                row={row}
                                busy={busy.has(row.id)}
                                change={(type, payload) => busyWhile(row.id, () => change(type, payload))}
                                onEdit={() => setDialog({ open: true, row })}
                            />
                        ))}
                    </Table.Group>
                )}
                {checking && <Table.Loading rows={2} />}
                {others.length > 0 && (
                    <Table.Group label={t('tunnels.hostnames.others')}>
                        {others.map((rule) => (
                            <Table.Row key={ruleName(rule)} muted>
                                <Table.Cell>{ruleName(rule)}</Table.Cell>
                                <Table.Cell mono>{targetOf(rule.service.replace(/^https?:\/\//, ''), rule.hostHeader)}</Table.Cell>
                                <Table.Cell />
                            </Table.Row>
                        ))}
                    </Table.Group>
                )}
            </Table.Root>
            <AddHostnameDialog
                open={dialog.open}
                row={dialog.row}
                state={state}
                endpointId={endpointId}
                attempt={attemptRow}
                onOpenChange={(open) => setDialog({ ...dialog, open })}
            />
        </SettingsSection>
    );
}

function HostnameRow({ row, busy, change, onEdit }: { row: TunnelRow; busy: boolean; change: TunnelChange; onEdit: () => void }) {
    const { t } = useTranslation('settings');

    return (
        <Table.Row aria-busy={busy || undefined}>
            <Table.Cell>
                <div className="flex min-w-0 flex-col">
                    <span>{row.hostname}</span>
                    {row.reason !== undefined && (
                        <>
                            <span className="flex items-center gap-1 text-xs text-status-needs-you">
                                <Icon icon={TriangleAlert} size={12} className="shrink-0" />
                                {t('tunnels.hostnames.unreachable')}
                            </span>
                            {/* Focusable, so the keyboard reaches the whole reason a narrow column cuts off. */}
                            <Tooltip label={row.reason}>
                                <span
                                    tabIndex={0}
                                    className="truncate rounded-sm text-xs text-text-muted focus-visible:outline-2 focus-visible:outline-accent-on-surface"
                                >
                                    {row.reason}
                                </span>
                            </Tooltip>
                        </>
                    )}
                </div>
            </Table.Cell>
            {row.kind === 'mcp' ? (
                <Table.Cell>{t('tunnels.hostnames.mcp')}</Table.Cell>
            ) : (
                <Table.Cell mono>{targetOf(`localhost:${row.port ?? 0}`, row.origin?.hostHeader)}</Table.Cell>
            )}
            <Table.Cell>
                {busy && <Spinner size={14} label={t('tunnels.hostnames.busy', { hostname: row.hostname })} />}
                {/* Named by its hostname alone: whether it is on is the switch's own state. */}
                <Switch
                    checked={row.enabled}
                    label={row.hostname}
                    disabled={busy}
                    onCheckedChange={(enabled) => void change('tunnel.update', { id: row.id, enabled })}
                />
                <Menu.Root>
                    <IconButton
                        icon={MoreHorizontal}
                        size="sm"
                        label={t('tunnels.hostnames.more', { hostname: row.hostname })}
                        disabled={busy}
                        render={<Menu.Trigger />}
                    />
                    <Menu.Popup align="end">
                        <Menu.Item onClick={() => void copyText(addressOf(row))}>
                            <Icon icon={Copy} size={14} /> {t('tunnels.hostnames.copy')}
                        </Menu.Item>
                        {row.kind === 'dev' && (
                            <>
                                <Menu.Item onClick={() => openInSystemBrowser(addressOf(row))}>
                                    <Icon icon={ExternalLink} size={14} /> {t('tunnels.hostnames.open')}
                                </Menu.Item>
                                <Menu.Item onClick={onEdit}>
                                    <Icon icon={Pencil} size={14} /> {t('tunnels.hostnames.edit')}
                                </Menu.Item>
                            </>
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

import { Button, Dialog, Field, FormError, Icon, Input, Segmented, Select, Spinner } from '@adecore/ui';
import type { TunnelRow, TunnelRowKind, TunnelState } from '@ruimte/contracts';
import { TriangleAlert } from 'lucide-react';
import { useEffect, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { transportFor } from '@/transport';
import { originDraftOf, originOf } from '@/tunnels/origin-draft';
import { OriginFields } from '@/tunnels/OriginFields';
import type { TunnelChangeType } from '@/tunnels/use-tunnels';
import { ZoneField } from '@/tunnels/ZoneField';

const OTHER_PORT = 'other';

/*
 * A dev server or Ruimte's MCP on a hostname, or a dev row to edit. Nothing stands in front of a dev server, so the dialog
 * says so, and Add is the confirmation. The MCP starts from a long random label, so scanners do not find it; a credential
 * guards it. An edited row keeps its hostname: its DNS record is made for that name.
 */
export function AddHostnameDialog({
    open,
    row,
    state,
    endpointId,
    attempt,
    onOpenChange
}: {
    open: boolean;
    /* The dev row to edit; null to add one. */
    row: TunnelRow | null;
    state: TunnelState;
    endpointId: string;
    attempt: (type: TunnelChangeType, payload?: object) => Promise<string | null>;
    onOpenChange: (open: boolean) => void;
}) {
    // The dialog stays until Cloudflare answered, so a refusal has a place to show.
    const [busy, setBusy] = useState(false);

    return (
        <Dialog.Root open={open} onOpenChange={(next) => (next || !busy) && onOpenChange(next)}>
            <Dialog.Popup size="sm">
                <HostnameForm
                    key={row?.id ?? ''}
                    row={row}
                    state={state}
                    endpointId={endpointId}
                    attempt={attempt}
                    busy={busy}
                    onBusy={setBusy}
                    onClose={() => onOpenChange(false)}
                />
            </Dialog.Popup>
        </Dialog.Root>
    );
}

/* Inside the popup, so what a person typed lasts through the closing transition and is gone once the popup unmounts. */
function HostnameForm({
    row,
    state,
    endpointId,
    attempt,
    busy,
    onBusy,
    onClose
}: {
    row: TunnelRow | null;
    state: TunnelState;
    endpointId: string;
    attempt: (type: TunnelChangeType, payload?: object) => Promise<string | null>;
    busy: boolean;
    onBusy: (busy: boolean) => void;
    onClose: () => void;
}) {
    const { t } = useTranslation('settings');
    const hasMcp = state.rows.some((entry) => entry.kind === 'mcp');
    const [kind, setKind] = useState<TunnelRowKind>('dev');
    const [ports, setPorts] = useState<Array<{ port: number; session: string | null }>>([]);
    const editing = row !== null;
    const [port, setPort] = useState(row === null || row.port === null ? '' : String(row.port));
    const [typing, setTyping] = useState(editing);
    const [zone, setZone] = useState('');
    // What the person typed as the label; until then the label follows the port, or is the MCP's long random one.
    const [ownLabel, setOwnLabel] = useState<string | null>(null);
    const [origin, setOrigin] = useState(() => originDraftOf(row?.origin));
    const [failure, setFailure] = useState<string | null>(null);
    const chosenZone = state.zones.find((entry) => entry.id === zone) ?? state.zones[0];
    // A hostname points at loopback of whatever computer runs the tunnel, so this machine's ports mean nothing then.
    const elsewhere = state.tunnel?.runner === 'other';

    useEffect(() => {
        if (editing || elsewhere) {
            return;
        }

        transportFor(endpointId)
            ?.request('tunnel.discover', {})
            .then((found) => setPorts(found.ports))
            .catch(() => setPorts([]));
    }, [endpointId, editing, elsewhere]);

    const suggestedLabel = kind === 'mcp' ? (state.suggestedMcpLabel ?? '') : port === '' ? '' : `dev-${port}`;
    const label = ownLabel ?? suggestedLabel;
    const chosenPort = Number(port);
    const portReady = Number.isInteger(chosenPort) && chosenPort > 0;
    const ready = row === null ? chosenZone !== undefined && label.trim() !== '' && (kind === 'mcp' || portReady) : portReady;

    const switchKind = (next: TunnelRowKind): void => {
        setKind(next);
        setOwnLabel(null);
    };

    const pick = (next: string): void => {
        if (next === OTHER_PORT) {
            setTyping(true);
            setPort('');

            return;
        }

        setPort(next);
    };

    const payload = (): [TunnelChangeType, object] => {
        if (row !== null) {
            return ['tunnel.update', { id: row.id, port: chosenPort, origin: originOf(origin) }];
        }

        if (kind === 'mcp') {
            return ['tunnel.add', { kind, zone: chosenZone?.id, label }];
        }

        const settings = originOf(origin);

        return ['tunnel.add', { kind, zone: chosenZone?.id, label, port: chosenPort, ...(Object.keys(settings).length === 0 ? {} : { origin: settings }) }];
    };

    const submit = async (): Promise<void> => {
        if (!ready || busy) {
            return;
        }

        onBusy(true);
        setFailure(null);

        const refused = await attempt(...payload());

        onBusy(false);

        if (refused !== null) {
            setFailure(refused);

            return;
        }

        onClose();
    };

    // Enter in a field adds or saves. The portaled search of a list stays out: its Enter picks a row.
    const submitOnEnter = (event: KeyboardEvent<HTMLFormElement>): void => {
        const target = event.target;

        if (event.key !== 'Enter' || event.nativeEvent.isComposing || !(target instanceof HTMLInputElement) || !event.currentTarget.contains(target)) {
            return;
        }

        event.preventDefault();
        void submit();
    };

    return (
        <>
            <Dialog.Title>{t(row === null ? 'tunnels.add.title' : 'tunnels.add.editTitle')}</Dialog.Title>
            <form
                aria-busy={busy || undefined}
                onKeyDown={submitOnEnter}
                onSubmit={(event) => {
                    event.preventDefault();
                    void submit();
                }}
            >
                <fieldset disabled={busy} className="flex min-w-0 flex-col gap-3 py-3">
                    {row === null && !hasMcp && (
                        <Segmented<TunnelRowKind>
                            value={kind}
                            label={t('tunnels.add.kind')}
                            options={[
                                { id: 'dev', label: t('tunnels.add.dev') },
                                { id: 'mcp', label: t('tunnels.add.mcp') }
                            ]}
                            disabled={busy}
                            onValueChange={switchKind}
                        />
                    )}
                    {kind === 'dev' && (
                        <Field orientation="horizontal" label={t('tunnels.add.port')}>
                            {ports.length > 0 && !typing && !elsewhere ? (
                                <Select<string>
                                    label={t('tunnels.add.port')}
                                    variant="outlined"
                                    value={ports.some((entry) => String(entry.port) === port) ? port : ''}
                                    placeholder={t('tunnels.add.pickPort')}
                                    items={[
                                        ...ports.map((entry) => ({
                                            value: String(entry.port),
                                            label: entry.session === null ? String(entry.port) : `${entry.port} · ${entry.session}`
                                        })),
                                        { value: OTHER_PORT, label: t('tunnels.add.otherPort') }
                                    ]}
                                    disabled={busy}
                                    onValueChange={pick}
                                />
                            ) : (
                                <Input
                                    aria-label={t('tunnels.add.port')}
                                    className="w-24"
                                    inputMode="numeric"
                                    value={port}
                                    onChange={(e) => setPort(e.target.value.replace(/\D/g, ''))}
                                />
                            )}
                        </Field>
                    )}
                    {row === null ? (
                        <Field orientation="horizontal" group label={t('tunnels.add.hostname')}>
                            <ZoneField zones={state.zones} zone={zone} label={label} disabled={busy} onZone={setZone} onLabel={setOwnLabel} />
                        </Field>
                    ) : (
                        <Field orientation="horizontal" group label={t('tunnels.add.hostname')}>
                            {/* As tall as a field, so the name sits on the line of its label. */}
                            <span className="block py-1.5 text-sm break-all text-text">{row.hostname}</span>
                        </Field>
                    )}
                    {kind === 'dev' && <OriginFields draft={origin} initiallyOpen={row?.origin !== undefined} disabled={busy} onChange={setOrigin} />}
                    {row === null && kind === 'dev' && (
                        <p className="flex items-center gap-2 text-xs text-status-needs-you">
                            <Icon icon={TriangleAlert} size={14} className="shrink-0" />
                            {t('tunnels.add.devWarning')}
                        </p>
                    )}
                    {elsewhere && kind === 'dev' && portReady && (
                        <p className="flex items-center gap-2 text-xs text-status-needs-you">
                            <Icon icon={TriangleAlert} size={14} className="shrink-0" />
                            {t('tunnels.add.otherRunner', { port: String(chosenPort) })}
                        </p>
                    )}
                    {failure !== null && <FormError>{failure}</FormError>}
                </fieldset>
                <Dialog.Footer>
                    <Button disabled={busy} onClick={onClose}>
                        {t('common:action.cancel')}
                    </Button>
                    <Button type="submit" variant="primary" disabled={!ready || busy}>
                        {busy && <Spinner size={14} />}
                        {row === null ? t('tunnels.add.action') : t('common:action.save')}
                    </Button>
                </Dialog.Footer>
            </form>
        </>
    );
}

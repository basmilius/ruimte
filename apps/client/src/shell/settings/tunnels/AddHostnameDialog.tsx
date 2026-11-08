import { Button, Dialog, Field, FormError, Icon, Input, Segmented, Select } from '@adecore/ui';
import type { TunnelRow, TunnelRowKind, TunnelState } from '@ruimte/contracts';
import { TriangleAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { originDraftOf, originOf } from '@/shell/settings/tunnels/origin-draft';
import { OriginFields } from '@/shell/settings/tunnels/OriginFields';
import type { TunnelChangeType } from '@/shell/settings/tunnels/use-tunnels';
import { ZoneField } from '@/shell/settings/tunnels/ZoneField';
import { transportFor } from '@/transport';

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
    return (
        <Dialog.Root open={open} onOpenChange={onOpenChange}>
            <Dialog.Popup size="sm">
                <HostnameForm key={row?.id ?? ''} row={row} state={state} endpointId={endpointId} attempt={attempt} onClose={() => onOpenChange(false)} />
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
    onClose
}: {
    row: TunnelRow | null;
    state: TunnelState;
    endpointId: string;
    attempt: (type: TunnelChangeType, payload?: object) => Promise<string | null>;
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
    const [label, setLabel] = useState('');
    const [origin, setOrigin] = useState(() => originDraftOf(row?.origin));
    const [failure, setFailure] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const chosenZone = state.zones.find((entry) => entry.id === zone) ?? state.zones[0];

    useEffect(() => {
        if (editing) {
            return;
        }

        transportFor(endpointId)
            ?.request('tunnel.discover', {})
            .then((found) => setPorts(found.ports))
            .catch(() => setPorts([]));
    }, [endpointId, editing]);

    const chosenPort = Number(port);
    const portReady = Number.isInteger(chosenPort) && chosenPort > 0;
    const ready = row === null ? chosenZone !== undefined && label.trim() !== '' && (kind === 'mcp' || portReady) : portReady;

    const switchKind = (next: TunnelRowKind): void => {
        setKind(next);
        setLabel(next === 'mcp' ? (state.suggestedMcpLabel ?? '') : port === '' ? '' : `dev-${port}`);
    };

    const suggest = (next: string): void => {
        setPort(next);

        if (row === null && label === '' && next !== '') {
            setLabel(`dev-${next}`);
        }
    };

    const pick = (next: string): void => {
        if (next === OTHER_PORT) {
            setTyping(true);
            setPort('');

            return;
        }

        suggest(next);
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
        setBusy(true);

        const refused = await attempt(...payload());

        setBusy(false);

        if (refused !== null) {
            setFailure(refused);

            return;
        }

        onClose();
    };

    return (
        <>
            <Dialog.Title>{t(row === null ? 'tunnels.add.title' : 'tunnels.add.editTitle')}</Dialog.Title>
            <div className="flex flex-col gap-3 py-3">
                {row === null && !hasMcp && (
                    <Segmented<TunnelRowKind>
                        value={kind}
                        label={t('tunnels.add.kind')}
                        options={[
                            { id: 'dev', label: t('tunnels.add.dev') },
                            { id: 'mcp', label: t('tunnels.add.mcp') }
                        ]}
                        onValueChange={switchKind}
                    />
                )}
                {kind === 'dev' && (
                    <Field orientation="horizontal" label={t('tunnels.add.port')}>
                        {ports.length > 0 && !typing ? (
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
                                onValueChange={pick}
                            />
                        ) : (
                            <Input
                                aria-label={t('tunnels.add.port')}
                                className="w-24"
                                inputMode="numeric"
                                value={port}
                                onChange={(e) => suggest(e.target.value.replace(/\D/g, ''))}
                            />
                        )}
                    </Field>
                )}
                {row === null ? (
                    <Field orientation="horizontal" group label={t('tunnels.add.hostname')}>
                        <ZoneField zones={state.zones} zone={zone} label={label} onZone={setZone} onLabel={setLabel} />
                    </Field>
                ) : (
                    <Field orientation="horizontal" group label={t('tunnels.add.hostname')}>
                        <span className="min-w-0 text-sm break-all text-text">{row.hostname}</span>
                    </Field>
                )}
                {kind === 'dev' && <OriginFields draft={origin} initiallyOpen={row?.origin !== undefined} onChange={setOrigin} />}
                {row === null && kind === 'dev' && (
                    <p className="flex items-center gap-2 text-xs text-status-needs-you">
                        <Icon icon={TriangleAlert} size={14} className="shrink-0" />
                        {t('tunnels.add.devWarning')}
                    </p>
                )}
                {failure !== null && <FormError>{failure}</FormError>}
            </div>
            <Dialog.Footer>
                <Button onClick={onClose}>{t('common:action.cancel')}</Button>
                <Button variant="primary" disabled={!ready || busy} onClick={() => void submit()}>
                    {row === null ? t('tunnels.add.action') : t('common:action.save')}
                </Button>
            </Dialog.Footer>
        </>
    );
}

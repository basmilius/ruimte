import { Button, Dialog, Field, FormError, Icon, Input, Segmented, Select } from '@adecore/ui';
import type { TunnelRowKind, TunnelState } from '@ruimte/contracts';
import { TriangleAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TunnelChangeType } from '@/shell/settings/tunnels/use-tunnels';
import { ZoneField } from '@/shell/settings/tunnels/ZoneField';
import { transportFor } from '@/transport';

const OTHER_PORT = 'other';

/*
 * A dev server or Ruimte's MCP on a hostname. Nothing stands in front of a dev server, so the dialog says so, and Add is
 * the confirmation. The MCP starts from a long random label, so scanners do not find it; a credential guards it.
 */
export function AddHostnameDialog({
    open,
    state,
    endpointId,
    attempt,
    onOpenChange
}: {
    open: boolean;
    state: TunnelState;
    endpointId: string;
    attempt: (type: TunnelChangeType, payload?: object) => Promise<string | null>;
    onOpenChange: (open: boolean) => void;
}) {
    return (
        <Dialog.Root open={open} onOpenChange={onOpenChange}>
            <Dialog.Popup size="sm">
                <HostnameForm state={state} endpointId={endpointId} attempt={attempt} onClose={() => onOpenChange(false)} />
            </Dialog.Popup>
        </Dialog.Root>
    );
}

/* Inside the popup, so what a person typed lasts through the closing transition and is gone once the popup unmounts. */
function HostnameForm({
    state,
    endpointId,
    attempt,
    onClose
}: {
    state: TunnelState;
    endpointId: string;
    attempt: (type: TunnelChangeType, payload?: object) => Promise<string | null>;
    onClose: () => void;
}) {
    const { t } = useTranslation('settings');
    const hasMcp = state.rows.some((row) => row.kind === 'mcp');
    const [kind, setKind] = useState<TunnelRowKind>('dev');
    const [ports, setPorts] = useState<Array<{ port: number; session: string | null }>>([]);
    const [port, setPort] = useState('');
    const [typing, setTyping] = useState(false);
    const [zone, setZone] = useState('');
    const [label, setLabel] = useState('');
    const [failure, setFailure] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const chosenZone = state.zones.find((entry) => entry.id === zone) ?? state.zones[0];

    useEffect(() => {
        transportFor(endpointId)
            ?.request('tunnel.discover', {})
            .then((found) => setPorts(found.ports))
            .catch(() => setPorts([]));
    }, [endpointId]);

    const chosenPort = Number(port);
    const ready = chosenZone !== undefined && label.trim() !== '' && (kind === 'mcp' || (Number.isInteger(chosenPort) && chosenPort > 0));

    const switchKind = (next: TunnelRowKind): void => {
        setKind(next);
        setLabel(next === 'mcp' ? (state.suggestedMcpLabel ?? '') : port === '' ? '' : `dev-${port}`);
    };

    const suggest = (next: string): void => {
        setPort(next);

        if (label === '' && next !== '') {
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

    const add = async (): Promise<void> => {
        setBusy(true);

        const refused = await attempt(
            'tunnel.add',
            kind === 'mcp' ? { kind, zone: chosenZone?.id, label } : { kind, zone: chosenZone?.id, label, port: chosenPort }
        );

        setBusy(false);

        if (refused !== null) {
            setFailure(refused);

            return;
        }

        onClose();
    };

    return (
        <>
            <Dialog.Title>{t('tunnels.add.title')}</Dialog.Title>
            <div className="flex flex-col gap-3 py-3">
                {!hasMcp && (
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
                <Field orientation="horizontal" group label={t('tunnels.add.hostname')}>
                    <ZoneField zones={state.zones} zone={zone} label={label} onZone={setZone} onLabel={setLabel} />
                </Field>
                {kind === 'dev' && (
                    <p className="flex items-center gap-2 text-xs text-status-needs-you">
                        <Icon icon={TriangleAlert} size={14} className="shrink-0" />
                        {t('tunnels.add.devWarning')}
                    </p>
                )}
                {failure !== null && <FormError>{failure}</FormError>}
            </div>
            <Dialog.Footer>
                <Button onClick={onClose}>{t('common:action.cancel')}</Button>
                <Button variant="primary" disabled={!ready || busy} onClick={() => void add()}>
                    {t('tunnels.add.action')}
                </Button>
            </Dialog.Footer>
        </>
    );
}

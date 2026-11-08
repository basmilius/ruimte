import { Button, Checkbox, IconButton, Input, Select, Switch } from '@adecore/ui';
import { SettingsRow } from '@adecore/ui/settings';
import type { TunnelRow, TunnelState } from '@ruimte/contracts';
import { Trash } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SettingsSection } from '@/shell/settings/SettingsSection';
import { ZoneField } from '@/shell/settings/tunnels/ZoneField';
import { transportFor } from '@/transport';

type Change = (type: 'tunnel.add' | 'tunnel.update' | 'tunnel.remove' | 'tunnel.setMcp', payload?: object) => Promise<void>;

/* The hostnames of the tunnel: the MCP, which is guarded by a credential on every request, and the dev servers, which are guarded by nothing. */
export function TunnelRows({ state, change, endpointId }: { state: TunnelState; change: Change; endpointId: string }) {
    const { t } = useTranslation('settings');
    const mcp = state.rows.find((row) => row.kind === 'mcp');
    const devs = state.rows.filter((row) => row.kind === 'dev');

    return (
        <SettingsSection title={t('tunnels.rows.title')} description={t('tunnels.visibility')} scope="machine" machine="picked">
            {state.tunnel !== null && <SettingsRow label={t('tunnels.rows.tunnel', { name: state.tunnel.name })} description={t('tunnels.rows.tunnelHint')} />}
            {mcp === undefined ? <AddMcp state={state} change={change} /> : <HostnameRow row={mcp} change={change} />}
            {devs.map((row) => (
                <HostnameRow key={row.id} row={row} change={change} />
            ))}
            <AddDev state={state} change={change} endpointId={endpointId} />
        </SettingsSection>
    );
}

function HostnameRow({ row, change }: { row: TunnelRow; change: Change }) {
    const { t } = useTranslation('settings');

    return (
        <SettingsRow
            label={row.hostname}
            description={row.kind === 'mcp' ? t('tunnels.rows.mcp') : t('tunnels.rows.dev', { port: row.port ?? 0 })}
            control={
                <div className="flex items-center gap-2">
                    <Switch
                        checked={row.enabled}
                        label={t('tunnels.rows.enabled', { hostname: row.hostname })}
                        onCheckedChange={(enabled) => void change('tunnel.update', { id: row.id, enabled })}
                    />
                    <Select<'back' | 'off'>
                        label={t('tunnels.rows.afterRestart', { hostname: row.hostname })}
                        variant="outlined"
                        value={row.comeBack ? 'back' : 'off'}
                        items={[
                            { value: 'back', label: t('tunnels.rows.comeBack') },
                            { value: 'off', label: t('tunnels.rows.stayOff') }
                        ]}
                        onValueChange={(next) => void change('tunnel.update', { id: row.id, comeBack: next === 'back' })}
                    />
                    <IconButton
                        icon={Trash}
                        label={t('tunnels.rows.remove', { hostname: row.hostname })}
                        onClick={() => void change('tunnel.remove', { id: row.id })}
                    />
                </div>
            }
        />
    );
}

function AddMcp({ state, change }: { state: TunnelState; change: Change }) {
    const { t } = useTranslation('settings');
    const [zone, setZone] = useState('');
    const [label, setLabel] = useState(state.suggestedMcpLabel ?? '');
    const chosen = state.zones.find((entry) => entry.id === zone) ?? state.zones[0];

    return (
        <SettingsRow
            label={t('tunnels.mcp.hostname')}
            description={t('tunnels.mcp.hostnameHint')}
            control={
                <div className="flex flex-wrap items-center justify-end gap-1.5">
                    <ZoneField zones={state.zones} zone={zone} label={label} labelName={t('tunnels.mcp.hostname')} onZone={setZone} onLabel={setLabel} />
                    <Button
                        disabled={chosen === undefined || label.trim() === ''}
                        onClick={() => void change('tunnel.add', { kind: 'mcp', zone: chosen?.id, label })}
                    >
                        {t('tunnels.rows.add')}
                    </Button>
                </div>
            }
        />
    );
}

/* A dev server is free: the person picks the hostname, and nothing stands in front of it. The row says so before the hostname goes on. */
function AddDev({ state, change, endpointId }: { state: TunnelState; change: Change; endpointId: string }) {
    const { t } = useTranslation('settings');
    const [ports, setPorts] = useState<Array<{ port: number; session: string | null }>>([]);
    const [port, setPort] = useState<string>('');
    const [zone, setZone] = useState('');
    const [label, setLabel] = useState('');
    const [understood, setUnderstood] = useState(false);
    const chosenZone = state.zones.find((entry) => entry.id === zone) ?? state.zones[0];

    useEffect(() => {
        transportFor(endpointId)
            ?.request('tunnel.discover', {})
            .then((found) => setPorts(found.ports))
            .catch(() => setPorts([]));
    }, [endpointId, state.rows.length]);

    const chosen = Number(port);
    const ready = Number.isInteger(chosen) && chosen > 0 && chosenZone !== undefined && label.trim() !== '' && understood;
    const suggest = (next: string): void => {
        setPort(next);

        if (label === '' && next !== '') {
            setLabel(`dev-${next}`);
        }
    };

    return (
        <>
            <SettingsRow
                label={t('tunnels.dev.label')}
                description={t('tunnels.dev.description')}
                control={
                    <div className="flex flex-wrap items-center justify-end gap-1.5">
                        <Select<string>
                            label={t('tunnels.dev.port')}
                            variant="outlined"
                            value={ports.some((entry) => String(entry.port) === port) ? port : ''}
                            placeholder={t('tunnels.dev.pick')}
                            items={ports.map((entry) => ({
                                value: String(entry.port),
                                label: entry.session === null ? String(entry.port) : `${entry.port} · ${entry.session}`
                            }))}
                            onValueChange={suggest}
                        />
                        <Input
                            aria-label={t('tunnels.dev.port')}
                            className="w-24"
                            inputMode="numeric"
                            value={port}
                            onChange={(e) => suggest(e.target.value.replace(/\D/g, ''))}
                        />
                        <ZoneField zones={state.zones} zone={zone} label={label} labelName={t('tunnels.dev.hostname')} onZone={setZone} onLabel={setLabel} />
                    </div>
                }
            />
            <SettingsRow
                label={t('tunnels.dev.gate')}
                control={
                    <div className="flex items-center gap-2">
                        <Checkbox checked={understood} label={t('tunnels.dev.gate')} onCheckedChange={setUnderstood} />
                        <Button
                            disabled={!ready}
                            onClick={() => {
                                void change('tunnel.add', { kind: 'dev', zone: chosenZone?.id, label, port: chosen });
                                setPort('');
                                setLabel('');
                                setUnderstood(false);
                            }}
                        >
                            {t('tunnels.rows.add')}
                        </Button>
                    </div>
                }
            />
        </>
    );
}

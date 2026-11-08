import { Button, IconButton, Input, Select, Switch } from '@adecore/ui';
import { ConfirmDialog, SettingsRow } from '@adecore/ui/settings';
import type { TunnelRow, TunnelState } from '@ruimte/contracts';
import { Trash } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SettingsSection } from '@/shell/settings/SettingsSection';
import { ZoneField } from '@/shell/settings/tunnels/ZoneField';
import { transportFor } from '@/transport';

type Change = (type: 'tunnel.add' | 'tunnel.update' | 'tunnel.remove' | 'tunnel.setMcp' | 'tunnel.unlink', payload?: object) => Promise<void>;

/* The hostnames of the tunnel: the MCP, which is guarded by a credential on every request, and the dev servers, which are guarded by nothing. */
export function TunnelRows({ state, change, endpointId }: { state: TunnelState; change: Change; endpointId: string }) {
    const { t } = useTranslation('settings');
    const mcp = state.rows.find((row) => row.kind === 'mcp');
    const devs = state.rows.filter((row) => row.kind === 'dev');

    return (
        <SettingsSection title={t('tunnels.rows.title')} description={t('tunnels.visibility')} scope="machine" machine="picked">
            {state.tunnel !== null && <TunnelRow tunnel={state.tunnel} change={change} />}
            {mcp === undefined ? <AddMcp state={state} change={change} /> : <HostnameRow row={mcp} change={change} />}
            {devs.map((row) => (
                <HostnameRow key={row.id} row={row} change={change} />
            ))}
            <AddDev state={state} change={change} endpointId={endpointId} />
        </SettingsSection>
    );
}

/* The tunnel by its name in Cloudflare, who made it and who runs it, with a way to stop using it that leaves it in Cloudflare. */
function TunnelRow({ tunnel, change }: { tunnel: NonNullable<TunnelState['tunnel']>; change: Change }) {
    const { t } = useTranslation('settings');
    const [confirming, setConfirming] = useState(false);
    const origin = t(tunnel.created ? 'tunnels.rows.made' : 'tunnels.rows.picked');
    const runner = t(`tunnels.rows.runner.${tunnel.runner ?? 'none'}`);

    return (
        <>
            <SettingsRow
                label={t('tunnels.rows.tunnel', { name: tunnel.name })}
                description={`${origin} ${runner}`}
                control={<Button onClick={() => setConfirming(true)}>{t('tunnels.unlink.action')}</Button>}
            />
            <ConfirmDialog
                open={confirming}
                onOpenChange={setConfirming}
                title={t('tunnels.unlink.title', { name: tunnel.name })}
                description={t('tunnels.unlink.description')}
                confirmLabel={t('tunnels.unlink.action')}
                onConfirm={() => change('tunnel.unlink')}
            />
            {tunnel.others.length > 0 && <SettingsRow label={t('tunnels.rows.others')} />}
            {tunnel.others.map((rule) => (
                <SettingsRow
                    key={`${rule.hostname ?? ''}${rule.path ?? ''}`}
                    label={`${rule.hostname ?? '*'}${rule.path ?? ''}`}
                    description={rule.service.replace(/^https?:\/\//, '')}
                />
            ))}
        </>
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

const OTHER_PORT = 'other';

/*
 * A dev server in one row: a port a session listens on (or another one typed in), a label and a zone. Nothing stands
 * in front of a dev server, so Add asks once more before the hostname goes on.
 */
function AddDev({ state, change, endpointId }: { state: TunnelState; change: Change; endpointId: string }) {
    const { t } = useTranslation('settings');
    const [ports, setPorts] = useState<Array<{ port: number; session: string | null }>>([]);
    const [port, setPort] = useState<string>('');
    const [typing, setTyping] = useState(false);
    const [zone, setZone] = useState('');
    const [label, setLabel] = useState('');
    const [confirming, setConfirming] = useState(false);
    const chosenZone = state.zones.find((entry) => entry.id === zone) ?? state.zones[0];

    useEffect(() => {
        transportFor(endpointId)
            ?.request('tunnel.discover', {})
            .then((found) => setPorts(found.ports))
            .catch(() => setPorts([]));
    }, [endpointId, state.rows.length]);

    const chosen = Number(port);
    const ready = Number.isInteger(chosen) && chosen > 0 && chosenZone !== undefined && label.trim() !== '';
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
        await change('tunnel.add', { kind: 'dev', zone: chosenZone?.id, label, port: chosen });
        setPort('');
        setLabel('');
        setTyping(false);
    };

    return (
        <>
            <SettingsRow
                label={t('tunnels.dev.label')}
                control={
                    <div className="flex items-center gap-1.5">
                        {ports.length > 0 && !typing ? (
                            <Select<string>
                                label={t('tunnels.dev.port')}
                                variant="outlined"
                                value={ports.some((entry) => String(entry.port) === port) ? port : ''}
                                placeholder={t('tunnels.dev.port')}
                                items={[
                                    ...ports.map((entry) => ({
                                        value: String(entry.port),
                                        label: entry.session === null ? String(entry.port) : `${entry.port} · ${entry.session}`
                                    })),
                                    { value: OTHER_PORT, label: t('tunnels.dev.other') }
                                ]}
                                onValueChange={pick}
                            />
                        ) : (
                            <Input
                                aria-label={t('tunnels.dev.port')}
                                className="w-20"
                                inputMode="numeric"
                                placeholder={t('tunnels.dev.port')}
                                value={port}
                                onChange={(e) => suggest(e.target.value.replace(/\D/g, ''))}
                            />
                        )}
                        <ZoneField zones={state.zones} zone={zone} label={label} labelName={t('tunnels.dev.hostname')} onZone={setZone} onLabel={setLabel} />
                        <Button disabled={!ready} onClick={() => setConfirming(true)}>
                            {t('tunnels.rows.add')}
                        </Button>
                    </div>
                }
            />
            <ConfirmDialog
                open={confirming}
                onOpenChange={setConfirming}
                title={t('tunnels.dev.confirm.title')}
                description={t('tunnels.dev.confirm.description')}
                confirmLabel={t('tunnels.rows.add')}
                onConfirm={add}
            />
        </>
    );
}

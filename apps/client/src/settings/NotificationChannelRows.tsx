import { messageOf, Switch } from '@adecore/ui';
import { SettingsRow } from '@adecore/ui/settings';
import type { ExtensionNotificationChannel } from '@ruimte/contracts';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LOCAL_ENDPOINT_ID } from '@/state/endpoints';
import { transportFor } from '@/transport';
import { orNull } from '@/transport-api/transport';
import { useMachineAnswers } from '@/transport/features';
import { useEndpointConnection } from '@/transport/status';

function keyOf(channel: ExtensionNotificationChannel): string {
    return `${channel.extension}:${channel.id}`;
}

/*
 * The ways extensions of this computer's machine tell a person outside Ruimte, each with its switch. Only the app on
 * that computer asks, since its machine answers these requests to nobody else. Without such an extension it draws nothing.
 */
export function NotificationChannelRows() {
    const { t } = useTranslation('settings');
    const answers = useMachineAnswers(LOCAL_ENDPOINT_ID, 'extension.notificationChannels');
    const open = useEndpointConnection(LOCAL_ENDPOINT_ID).status === 'open';
    const [channels, setChannels] = useState<ExtensionNotificationChannel[]>([]);
    const [failure, setFailure] = useState<string | null>(null);
    const asks = answers && open;

    useEffect(() => {
        const link = asks ? transportFor(LOCAL_ENDPOINT_ID) : null;

        if (link === null) {
            return;
        }

        let alive = true;
        const read = (): void => {
            void orNull('extension.notificationChannels', link.request('extension.notificationChannels', {})).then((answer) => {
                if (alive && answer !== null) {
                    setChannels(answer.channels);
                }
            });
        };
        // An extension that came, went or was turned off changes which channels there are.
        const off = link.on('extension.changed', read);

        read();

        return () => {
            alive = false;
            off();
        };
    }, [asks]);

    if (!asks || channels.length === 0) {
        return null;
    }

    const set = (channel: ExtensionNotificationChannel, on: boolean): void => {
        const key = keyOf(channel);

        setFailure(null);
        setChannels((before) => before.map((each) => (keyOf(each) === key ? { ...each, on } : each)));
        transportFor(LOCAL_ENDPOINT_ID)
            ?.request('extension.notificationChannelSet', { extension: channel.extension, channel: channel.id, on })
            .catch((e: unknown) => {
                setFailure(messageOf(e));
                setChannels((before) => before.map((each) => (keyOf(each) === key ? { ...each, on: !on } : each)));
            });
    };

    return (
        <>
            {channels.map((channel) => (
                <SettingsRow
                    key={keyOf(channel)}
                    label={t('agents.notificationChannels.label', { title: channel.title })}
                    description={t('agents.notificationChannels.description')}
                    control={
                        <Switch
                            checked={channel.on}
                            onCheckedChange={(next) => set(channel, next)}
                            label={t('agents.notificationChannels.label', { title: channel.title })}
                        />
                    }
                />
            ))}
            {failure !== null && (
                <SettingsRow
                    muted
                    label={
                        <span className="break-words text-status-error" role="alert">
                            {failure}
                        </span>
                    }
                />
            )}
        </>
    );
}

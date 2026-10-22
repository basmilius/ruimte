import { useEffect, useState } from 'react';
import i18next from 'i18next';
import { messageOf } from '@adecore/ui';
import type { VoicePreferences } from '@ruimte/contracts';
import { useEndpoints } from '@/state/endpoints';
import { currentEndpointId } from '@/state/keys';
import { useSettings } from '@/state/settings';
import { useToasts } from '@/state/toasts';
import { useWindow, workspaceOf } from '@/state/window';
import { machineTransport, pool } from '@/transport';
import { machineAnswers, useMachineAnswers } from '@/transport/features';

/*
 * How Voice talks is the machine's (`voice.preferences`), so the desktop and a phone that start Voice there
 * speak alike. A machine that keeps none falls back to this app's own settings: the language Speech to Text
 * listens for and the voice picked here, as Voice used before the machine kept them.
 */
export function localVoicePreferences(): VoicePreferences {
    const { voiceLanguage, liveVoice } = useSettings.getState();
    return { language: voiceLanguage, voice: liveVoice };
}

/* What a start of desktop Voice speaks: the machine of the window's, else this app's own. */
export async function voicePreferencesForStart(endpointId: string = currentEndpointId()): Promise<VoicePreferences> {
    const local = localVoicePreferences();
    if (!machineAnswers(pool.statusOf(endpointId), 'voice.preferences')) {
        return local;
    }
    try {
        return (await machineTransport(endpointId).request('voice.preferences', {})).preferences ?? local;
    } catch {
        // A link that dropped on the way starts Voice as this app would have; the start itself says when it cannot.
        return local;
    }
}

/* The machine the window is about, as `currentEndpointId` reads it, for a render. */
export function useWindowEndpointId(): string {
    const workspace = useWindow((state) => workspaceOf(state.content));
    const activeId = useEndpoints((state) => state.activeId);
    return workspace?.connection.endpointId ?? activeId;
}

export interface MachineVoicePreferences {
    /* False for a machine that keeps none of its own; this app's settings then stand in. */
    kept: boolean;
    /* What the machine stores, or null while it stores none or has not answered yet. */
    preferences: VoicePreferences | null;
    set(next: VoicePreferences): void;
}

/* The preferences of one machine, read once its link is up and followed through `voice.preferences`. */
export function useMachineVoicePreferences(endpointId: string): MachineVoicePreferences {
    const kept = useMachineAnswers(endpointId, 'voice.preferences');
    const [stored, setStored] = useState<{ endpointId: string; preferences: VoicePreferences | null } | null>(null);

    useEffect(() => {
        if (!kept) {
            return;
        }
        let current = true;
        const link = machineTransport(endpointId);
        const off = link.on('voice.preferences', ({ preferences }) => setStored({ endpointId, preferences }));
        link.request('voice.preferences', {})
            .then(({ preferences }) => {
                if (current) {
                    setStored({ endpointId, preferences });
                }
            })
            .catch(() => undefined);
        return () => {
            current = false;
            off();
        };
    }, [kept, endpointId]);

    const preferences = kept && stored?.endpointId === endpointId ? stored.preferences : null;

    const set = (next: VoicePreferences): void => {
        const before = preferences;
        setStored({ endpointId, preferences: next });
        machineTransport(endpointId)
            .request('voice.setPreferences', next)
            .then((answer) => setStored({ endpointId, preferences: answer.preferences }))
            .catch((error: unknown) => {
                setStored({ endpointId, preferences: before });
                useToasts.getState().show({
                    kind: 'error',
                    title: i18next.t('settings:voice.toast.preferencesFailed'),
                    description: messageOf(error, i18next.t('settings:voice.conversation.preferencesFailure'))
                });
            });
    };

    return { kept, preferences, set };
}

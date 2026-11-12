import { Button, FormError, IconButton, Input, Select, Switch, useAsyncAction } from '@adecore/ui';
import { SettingsRow } from '@adecore/ui/settings';
import { Play, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { addCustomSoundPack, removeCustomSoundPack, renameCustomSoundPack, setCustomSound, type SoundFileRefusal } from '@/attention/custom-sounds';
import { playSound } from '@/attention/sounds';
import { useSettings } from '@/state/settings';
import { soundPackItems } from '@/state/sound-packs';
import { SOUND_EVENTS, type SoundEvent } from '@/state/sounds';

const NEW_PACK = 'new';
const PACK_NAME_MAX = 40;

/*
 * The pack the notification sounds come from and which events make one, each with a button to hear it.
 * A pack of a person's own also shows its name, the file of each event and a way to delete it.
 */
export function SoundRows() {
    const { t } = useTranslation('settings');
    const pack = useSettings((s) => s.soundPack);
    const events = useSettings((s) => s.soundEvents);
    const custom = useSettings((s) => s.customSoundPacks);
    const update = useSettings((s) => s.update);
    const own = custom.find((entry) => entry.id === pack);
    const [refusal, setRefusal] = useState<SoundFileRefusal | null>(null);
    const { busy, failure, run } = useAsyncAction(t('agents.sounds.custom.failed'));
    const fileRef = useRef<HTMLInputElement>(null);
    const picking = useRef<SoundEvent | null>(null);

    const choose = (event: SoundEvent): void => {
        picking.current = event;
        fileRef.current?.click();
    };

    const keep = (file: File | undefined): void => {
        const event = picking.current;

        if (file === undefined || event === null || own === undefined) {
            return;
        }

        void run(async () => setRefusal(await setCustomSound(own.id, event, file)));
    };

    return (
        <>
            <SettingsRow
                searchId="agents.sounds.pack"
                label={t('agents.sounds.pack.label')}
                description={t('agents.sounds.pack.description')}
                control={
                    <Select
                        label={t('agents.sounds.pack.label')}
                        size="sm"
                        value={pack}
                        onValueChange={(value) => {
                            setRefusal(null);

                            if (value === NEW_PACK) {
                                addCustomSoundPack(t('agents.sounds.newPackName'));
                            } else {
                                update({ soundPack: value });
                            }
                        }}
                        items={[...soundPackItems(custom, t), { value: NEW_PACK, label: t('agents.sounds.newPack') }]}
                    />
                }
            />
            {own !== undefined && (
                <SettingsRow
                    indent
                    label={t('agents.sounds.custom.name')}
                    control={
                        <div className="flex items-center gap-2">
                            <Input
                                className="w-44"
                                maxLength={PACK_NAME_MAX}
                                aria-label={t('agents.sounds.custom.name')}
                                value={own.name}
                                onChange={(event) => renameCustomSoundPack(own.id, event.target.value)}
                            />
                            <IconButton
                                icon={Trash2}
                                size="sm"
                                label={t('agents.sounds.custom.delete')}
                                disabled={busy}
                                onClick={() => void run(() => removeCustomSoundPack(own.id))}
                            />
                        </div>
                    }
                />
            )}
            {SOUND_EVENTS.map((event) => {
                const label = t(`agents.sounds.events.${event}`);
                const file = own?.files[event];
                const silent = own !== undefined && file === undefined;

                return (
                    <SettingsRow
                        key={event}
                        indent
                        label={label}
                        description={own === undefined ? undefined : (file ?? t('agents.sounds.custom.noFile'))}
                        control={
                            <div className="flex items-center gap-2">
                                {own !== undefined && (
                                    <Button
                                        size="sm"
                                        disabled={busy}
                                        aria-label={t('agents.sounds.custom.chooseFor', { event: label })}
                                        onClick={() => choose(event)}
                                    >
                                        {t('agents.sounds.custom.choose')}
                                    </Button>
                                )}
                                <IconButton
                                    icon={Play}
                                    size="sm"
                                    label={t('agents.sounds.play', { event: label })}
                                    disabled={silent}
                                    onClick={() => playSound({ pack, event })}
                                />
                                <Switch
                                    checked={events[event]}
                                    onCheckedChange={(next) => update({ soundEvents: { ...events, [event]: next } })}
                                    label={label}
                                />
                            </div>
                        }
                    />
                );
            })}
            {(refusal !== null || failure) && (
                <SettingsRow indent label={<FormError>{refusal === null ? failure : t(`agents.sounds.refusal.${refusal}`)}</FormError>} />
            )}
            <input
                ref={fileRef}
                type="file"
                accept="audio/*"
                className="hidden"
                onChange={(event) => {
                    const file = event.target.files?.[0];

                    event.target.value = '';
                    keep(file);
                }}
            />
        </>
    );
}

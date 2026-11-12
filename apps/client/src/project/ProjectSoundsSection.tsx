import { SectionLabel, Select, Switch } from '@adecore/ui';
import { useTranslation } from 'react-i18next';
import { useSettings } from '@/state/settings';
import { soundPackItems, soundPackName } from '@/state/sound-packs';
import { projectSoundKey, withProjectSounds } from '@/state/sounds';

const AS_IN_SETTINGS = '';

/*
 * The pack this project's notifications sound in, or no sound at all, so a person hears which project
 * calls. This client's own, kept in its settings and never in the project file.
 */
export function ProjectSoundsSection({ projectId, endpointId }: { projectId: string; endpointId: string }) {
    const { t } = useTranslation('shell');
    const { t: settingsWords } = useTranslation('settings');
    const key = projectSoundKey(endpointId, projectId);
    const projects = useSettings((s) => s.projectSounds);
    const pack = useSettings((s) => s.soundPack);
    const custom = useSettings((s) => s.customSoundPacks);
    const update = useSettings((s) => s.update);
    const sounds = projects[key] ?? {};

    return (
        <>
            <SectionLabel render={<div />} className="mt-5 mb-0.5">
                {t('projectSettings.sounds')}
            </SectionLabel>
            <p className="mb-1.5 text-sm text-text-faint">{t('projectSettings.soundsNote')}</p>
            <div className="flex items-center gap-3">
                <Select
                    label={t('projectSettings.soundsPack')}
                    size="sm"
                    disabled={sounds.silent === true}
                    value={sounds.pack ?? AS_IN_SETTINGS}
                    onValueChange={(value) =>
                        update({ projectSounds: withProjectSounds(projects, key, { ...sounds, pack: value === AS_IN_SETTINGS ? undefined : value }) })
                    }
                    items={[
                        { value: AS_IN_SETTINGS, label: t('projectSettings.soundsAsInSettings', { pack: soundPackName(pack, custom, settingsWords) }) },
                        ...soundPackItems(custom, settingsWords)
                    ]}
                />
                <span className="grow" />
                {/* No label element: the switch names itself, and a label around it would pass every press on a second time. */}
                <span className="flex items-center gap-2 text-sm text-text">
                    {t('projectSettings.soundsSilent')}
                    <Switch
                        checked={sounds.silent === true}
                        onCheckedChange={(next) => update({ projectSounds: withProjectSounds(projects, key, { ...sounds, silent: next }) })}
                        label={t('projectSettings.soundsSilent')}
                    />
                </span>
            </div>
        </>
    );
}

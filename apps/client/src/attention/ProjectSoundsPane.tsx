import { Select, Switch } from '@adecore/ui';
import { SettingsRow, SettingsSection } from '@adecore/ui/settings';
import { useTranslation } from 'react-i18next';
import { addCustomSoundPack } from '@/attention/custom-sounds';
import { SoundPackRows } from '@/attention/SoundPackRows';
import { useProjectSettingsSubject } from '@/project/project-settings-subject';
import { useSettings } from '@/state/settings';
import { soundPackItems, soundPackName } from '@/state/sound-packs';
import { projectSoundKey, withProjectSounds } from '@/state/sounds';

const AS_IN_SETTINGS = '';
const NEW_PACK = 'new';

/*
 * The pack this project's notifications sound in, or no sound at all, so a person hears which project
 * calls. This client's own, kept in its settings and never in the project file.
 */
export function ProjectSoundsPane() {
    const { t } = useTranslation('shell');
    const { t: settingsWords } = useTranslation('settings');
    const { project, endpointId } = useProjectSettingsSubject();
    const key = projectSoundKey(endpointId, project.projectId);
    const projects = useSettings((s) => s.projectSounds);
    const pack = useSettings((s) => s.soundPack);
    const custom = useSettings((s) => s.customSoundPacks);
    const update = useSettings((s) => s.update);
    const sounds = projects[key] ?? {};

    return (
        <SettingsSection>
            <SettingsRow
                searchId="sounds.pack"
                label={t('projectSettings.soundsPack')}
                description={t('projectSettings.soundsPackNote')}
                control={
                    <Select
                        label={t('projectSettings.soundsPack')}
                        size="sm"
                        disabled={sounds.silent === true}
                        value={sounds.pack ?? AS_IN_SETTINGS}
                        onValueChange={(value) => {
                            if (value === NEW_PACK) {
                                addCustomSoundPack(settingsWords('agents.sounds.newPackName'), key);
                            } else {
                                update({ projectSounds: withProjectSounds(projects, key, { ...sounds, pack: value === AS_IN_SETTINGS ? undefined : value }) });
                            }
                        }}
                        items={[
                            { value: AS_IN_SETTINGS, label: t('projectSettings.soundsAsInSettings', { pack: soundPackName(pack, custom, settingsWords) }) },
                            ...soundPackItems(custom, settingsWords),
                            { value: NEW_PACK, label: settingsWords('agents.sounds.newPack') }
                        ]}
                    />
                }
            />
            {sounds.pack !== undefined && <SoundPackRows key={sounds.pack} pack={sounds.pack} />}
            <SettingsRow
                searchId="sounds.silent"
                label={t('projectSettings.soundsSilent')}
                description={t('projectSettings.soundsSilentNote')}
                control={
                    <Switch
                        checked={sounds.silent === true}
                        onCheckedChange={(next) => update({ projectSounds: withProjectSounds(projects, key, { ...sounds, silent: next }) })}
                        label={t('projectSettings.soundsSilent')}
                    />
                }
            />
        </SettingsSection>
    );
}

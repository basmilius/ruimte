import { setFormatSource } from '@ruimte/ui/format/locale';
import { desktop } from '@/desktop/bridge';
import { activeLanguage } from '@/i18n/active';
import { useSettings } from '@/state/settings';

/* Hands the formatters of @ruimte/ui the language and region a person set here, and the system's region the shell reads. */
export const connectFormat = (): void => {
    setFormatSource({
        language: activeLanguage,
        region: () => useSettings.getState().formatRegion,
        systemLocale: () => desktop()?.systemLocale,
        subscribe: (onChange) => useSettings.subscribe(onChange)
    });
};

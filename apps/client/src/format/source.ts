import { setFormatSource, type FormatSource } from '@basmilius/react-ui/format';
import { desktop } from '@/desktop/bridge';
import { activeLanguage } from '@/i18n/active';
import { useSettings } from '@/state/settings';

/* The language and region a person set here, and the system's region the shell reads. */
export const formatSource: FormatSource = {
    language: activeLanguage,
    region: () => useSettings.getState().formatRegion,
    systemLocale: () => desktop()?.systemLocale,
    subscribe: (onChange) => useSettings.subscribe(onChange)
};

/* Before the first render as well as through `UIProvider`, so code outside React formats in the right region too. */
export const connectFormat = (): void => {
    setFormatSource(formatSource);
};

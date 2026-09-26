import { createContext, useContext } from 'react';

interface SettingsTarget {
    /* The row a search result jumped to, by its `searchId`. */
    target: string | null;
    /* Called once the row was lit long enough, so it is not lit again on the next render. */
    shown(): void;
}

export const SettingsTargetContext = createContext<SettingsTarget>({ target: null, shown: () => {} });

export const useSettingsTarget = (): SettingsTarget => useContext(SettingsTargetContext);

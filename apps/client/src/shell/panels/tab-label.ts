import i18next from 'i18next';
import { databaseTabTitle } from '@/database/tab-look';
import { basenameOf } from '@/shell/panels/files-tree';
import { isCheckoutDiff, isDatabaseTab, type Tab } from '@/state/files';

/* What a loose view is called wherever it is named: the strip, the bar of a cell on its own, a menu. A commit uses its hash because no file represents it. */
export function looseTabLabel(tab: Tab): string {
    if (isDatabaseTab(tab)) {
        return databaseTabTitle(tab);
    }
    const commit = tab.view?.commit;
    if (commit !== undefined) {
        return commit.slice(0, 7);
    }
    if (isCheckoutDiff(tab.path, tab.view) || tab.view === undefined) {
        return basenameOf(tab.path);
    }
    return i18next.t('panels:git.tab.changes');
}

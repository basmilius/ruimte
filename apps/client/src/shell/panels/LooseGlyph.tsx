import { GitCommitHorizontal, GitCompare } from 'lucide-react';
import { databaseTabIcon } from '@/database/tab-look';
import { isDatabaseTab, type Tab } from '@/state/files';
import { FileIcon, Icon } from '@adecore/ui';

/* The mark of a loose view: its file, a comparison or a commit, or what a database view shows. */
export function LooseGlyph({ tab, size = 14 }: { tab: Tab; size?: number }) {
    if (isDatabaseTab(tab)) {
        return <Icon icon={databaseTabIcon(tab)} size={size} className="shrink-0 text-text-faint" />;
    }
    if (tab.view) {
        return <Icon icon={tab.view.commit === undefined ? GitCompare : GitCommitHorizontal} size={size} className="shrink-0 text-text-faint" />;
    }
    return <FileIcon path={tab.path} size={size} />;
}

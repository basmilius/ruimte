import { FileIcon, Icon } from '@adecore/ui';
import { GitCommitHorizontal, GitCompare, Package } from 'lucide-react';
import { databaseTabIcon } from '@/database/tab-look';
import { isArtifactTab, isDatabaseTab, isSessionTab, type Tab } from '@/state/files';

/* The mark of a loose view: its file, a comparison or a commit, what a database view shows, or an artifact of Output. */
export function LooseGlyph({ tab, size = 14 }: { tab: Tab; size?: number }) {
    if (isDatabaseTab(tab)) {
        return <Icon icon={databaseTabIcon(tab)} size={size} className="shrink-0 text-text-faint" />;
    }
    if (isArtifactTab(tab)) {
        return <Icon icon={Package} size={size} className="shrink-0 text-text-faint" />;
    }
    if (isSessionTab(tab)) {
        return tab.kind === 'compare' ? <Icon icon={GitCompare} size={size} className="shrink-0 text-text-faint" /> : <FileIcon path={tab.path} size={size} />;
    }
    if (tab.view) {
        return <Icon icon={tab.view.commit === undefined ? GitCompare : GitCommitHorizontal} size={size} className="shrink-0 text-text-faint" />;
    }
    return <FileIcon path={tab.path} size={size} />;
}

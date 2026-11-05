import i18next from 'i18next';
import type { PrRepo } from '@/controllers/pr-repos';
import type { Command } from '@/shell/commands';
import { PR_SHOW_IN_PREFIX } from '@/shell/menu/ids';

/* One row per repository that stands on a branch, since a pull request belongs to a branch of one repository; a folder with one keeps the single row. */
export function pullRequestCommands(folder: string, repos: readonly PrRepo[], show: (cwd: string) => void): Command[] {
    if (repos.length <= 1) {
        return [{ id: 'pr-show', label: i18next.t('shell:palette.commands.showPullRequest'), run: () => show(repos[0]?.path ?? folder) }];
    }
    return repos.map((repo) => ({
        id: `${PR_SHOW_IN_PREFIX}${repo.path}`,
        label: i18next.t('shell:palette.commands.showPullRequestIn', { repo: repo.label }),
        run: () => show(repo.path)
    }));
}

import { t } from '@/commands/menu-builders';
import type { MenuExtra } from '@/commands/menu-extras';

/* The row that shows the pull request of one repository of a folder that holds several. */
export const PR_SHOW_IN_PREFIX = 'pr-show-in-';

export const GITHUB_MENU_EXTRAS: readonly MenuExtra[] = [
    {
        menu: 'code',
        group: 'pull-request',
        order: 10,
        build: (context, command) =>
            context.prRepos.length > 1
                ? context.prRepos.map((repo) => command(`${PR_SHOW_IN_PREFIX}${repo.path}`, t('showPullRequestIn', { repo: repo.label })))
                : []
    }
];

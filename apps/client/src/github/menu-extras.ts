import { t } from '@/commands/menu-builders';
import type { MenuExtra } from '@/commands/menu-extras';
import { PR_SHOW_IN_PREFIX } from '@/github/commands';

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

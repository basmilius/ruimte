import type { GeneratedCommands } from '@/commands/generated';
import { PR_SHOW_IN_PREFIX } from '@/github/menu-extras';

/* The rows made once per repository of a folder, apart from what they do, so the start screen's chunk holds no command of a workspace. */
export const GITHUB_GENERATED: readonly GeneratedCommands[] = [{ prefix: PR_SHOW_IN_PREFIX, usage: 'prShowIn', palette: true }];

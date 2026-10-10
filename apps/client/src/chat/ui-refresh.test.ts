import { expect, test } from 'bun:test';
import { gitStatusConcernsChat } from './ui-refresh';

const project = { folder: '/work/app' };

test('a git status concerns a chat only inside its project or the checkout it works in', () => {
    expect(gitStatusConcernsChat('/work/app', project, '/work/app')).toBe(true);
    expect(gitStatusConcernsChat('/work/app/packages/lib', project, '/work/app')).toBe(true);
    expect(gitStatusConcernsChat('/home/.ruimte/worktrees/app-1', project, '/home/.ruimte/worktrees/app-1/src')).toBe(true);
    expect(gitStatusConcernsChat('/work/other', project, '/work/app')).toBe(false);
    expect(gitStatusConcernsChat('/work/app-copy', project, '/work/app')).toBe(false);
    expect(gitStatusConcernsChat('/work/other', null, null)).toBe(true);
});

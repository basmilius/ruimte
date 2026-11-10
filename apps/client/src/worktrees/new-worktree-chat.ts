/* A branch name git accepts out of free text; never empty. */
export function branchFromTitle(title: string): string {
    return (
        title
            .toLowerCase()
            .replace(/[^a-z0-9._/-]+/g, '-')
            .replace(/^-+|-+$/g, '') || 'work'
    );
}

/* The branch a chat in a new worktree proposes, clear of the branches that exist and not a name a person would guess for something else. */
export function proposedBranch(taken: readonly string[], random: () => number = Math.random): string {
    for (let attempt = 0; attempt < 20; attempt += 1) {
        const name = `chat-${Math.floor(random() * 36 ** 4)
            .toString(36)
            .padStart(4, '0')}`;
        if (!taken.includes(name)) {
            return name;
        }
    }
    return `chat-${taken.length + 1}`;
}

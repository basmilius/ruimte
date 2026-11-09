/* A ref as a person reads it: `main` for `refs/heads/main`. Apart from the comparison so a tab's label can use it without the store behind it. */
export function refLabel(ref: string): string {
    return ref.replace(/^refs\/(heads|remotes)\//, '');
}

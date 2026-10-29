/* What a person turns off and picks for one CLI, as `project.setAccounts` takes it; the default can never be one that is off. */
export function choiceAfter(
    current: { default?: string; off?: readonly string[] } | undefined,
    change: { default: string | null } | { account: string; offered: boolean }
): { default: string | null; off: string[] } {
    const off = new Set(current?.off ?? []);
    let preferred = current?.default ?? null;

    if ('account' in change) {
        if (change.offered) {
            off.delete(change.account);
        } else {
            off.add(change.account);
        }
    } else {
        preferred = change.default;
    }

    if (preferred !== null) {
        off.delete(preferred);
    }

    return { default: preferred, off: [...off] };
}

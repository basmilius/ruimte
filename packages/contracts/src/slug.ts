/*
 * An id or folder name made of a name: lowercase letters, digits and dashes, starting with a letter or a
 * digit, cut to `maxLength` with room left for a number. An accent folds into its letter.
 */
export function slugOf(name: string, fallback: string, maxLength = 48): string {
    const slug = name
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, maxLength)
        .replace(/-+$/, '');
    return slug === '' ? fallback : slug;
}

/* The slug of a name, or that slug with the first number after it that no id in `taken` has. */
export function freeSlug(name: string, fallback: string, taken: ReadonlySet<string>, maxLength = 48): string {
    const base = slugOf(name, fallback, maxLength);
    if (!taken.has(base)) {
        return base;
    }
    for (let i = 2; ; i++) {
        const candidate = `${base}-${i}`;
        if (!taken.has(candidate)) {
            return candidate;
        }
    }
}

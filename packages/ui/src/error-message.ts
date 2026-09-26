/* An error from across the Electron bridge carries Electron's own prefix, which says nothing to a person. A
   throw that is not an Error has no sentence in it, so a caller that knows the step names it. */
export const messageOf = (e: unknown, fallback?: string): string =>
    (e instanceof Error ? e.message : (fallback ?? String(e))).replace(/^Error invoking remote method '[^']+': (?:[A-Za-z]*Error: )?/, '');

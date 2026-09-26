/*
 * The pure half of `ErrorBoundary`: when a failed subtree gets another try, and what a person copies
 * out of the message. Kept apart so it can be tested without a DOM.
 */

/* Anything the subtree draws from. A change in any of them means the data may be whole again. */
export type ResetKeys = readonly unknown[];

/*
 * Whether a boundary that holds an error should draw its children again. Only a boundary that
 * failed resets. Comparing keys while the children are fine would remount a terminal or a page on
 * every save.
 */
export const shouldReset = (failed: boolean, previous: ResetKeys, next: ResetKeys): boolean => {
    if (!failed) {
        return false;
    }
    if (previous.length !== next.length) {
        return true;
    }
    return previous.some((key, i) => !Object.is(key, next[i]));
};

/* A thrown value is not always an Error, and the message has to say something either way. */
export const errorMessageOf = (error: unknown): string => {
    if (error instanceof Error) {
        return error.message || error.name;
    }
    return typeof error === 'string' ? error : String(error);
};

/* The text behind the copy button: what a bug report needs, the component stack included. */
export const errorReport = (label: string, error: unknown, componentStack: string | null): string => {
    const stack = error instanceof Error && error.stack ? error.stack : errorMessageOf(error);
    const parts = [label, stack];
    if (componentStack) {
        parts.push(`Component stack:${componentStack}`);
    }
    return parts.join('\n\n');
};

/* The desktop shell sets this on every window of a start with `--safe-mode`, so a person can always get back into an app an extension hangs. */
export function extensionsInSafeMode(): boolean {
    return typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('safe-mode');
}

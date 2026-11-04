/* `ruimte --safe-mode` sets this on the window's address, so a person can always get back into an app an extension hangs. */
export function extensionsInSafeMode(): boolean {
    return typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('safe-mode');
}

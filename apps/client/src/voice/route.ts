let onMachine: boolean | null = null;

/*
 * The development harness of Voice run by the daemon: with `?voiceRoute=daemon` in a dev build the window
 * has the machine mint the session and run every tool, as a phone will, so a problem of the sideband shows
 * apart from one of iOS audio. Read once, since the window may rewrite its address later.
 */
export function voiceOnMachine(): boolean {
    onMachine ??= import.meta.env.DEV === true && typeof location !== 'undefined' && new URLSearchParams(location.search).get('voiceRoute') === 'daemon';
    return onMachine;
}

/* Whether this window may raise anything at all. */
export function mayNotify(): boolean {
    return 'Notification' in window && Notification.permission === 'granted';
}

/*
 * Raises a system notification that brings the window up when a person opens it. It carries no tag:
 * Electron shows one that reuses a tag by removing the one before it, and on macOS that removal takes
 * the new one along, so nothing shows at all. What follows an earlier notification closes that one first.
 */
export function raiseNotification(title: string, options: Pick<NotificationOptions, 'body' | 'silent'>, open: () => void): Notification {
    const notification = new Notification(title, options);

    notification.onclick = () => {
        window.focus();
        open();
        notification.close();
    };

    return notification;
}

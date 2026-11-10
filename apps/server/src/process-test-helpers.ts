export function processAlive(pid: number): boolean {
    try {
        process.kill(pid, 0);

        return true;
    } catch {
        return false;
    }
}

/* Ends a process that may already be gone; any other failure to signal it is a real one. */
export function killQuietly(pid: number): void {
    try {
        process.kill(pid, 'SIGKILL');
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ESRCH') {
            throw error;
        }
    }
}

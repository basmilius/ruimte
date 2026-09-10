const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;

/* A file size the way a person says it: whole bytes up to a kilobyte, one decimal above that. */
export const formatBytes = (bytes: number): string => {
    let value = Math.max(0, bytes);
    let unit = 0;
    while (value >= 1024 && unit < UNITS.length - 1) {
        value /= 1024;
        unit++;
    }
    return `${unit === 0 ? value : Number(value.toFixed(1))} ${UNITS[unit]}`;
};

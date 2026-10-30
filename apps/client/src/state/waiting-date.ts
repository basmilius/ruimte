/* Zero and malformed timestamps mean unknown on both live and compact status paths. */
export function waitDate(requests: readonly { createdAt: number }[] = [], firstSeen?: number, fallback?: number): number {
    const dates = requests.map((request) => request.createdAt).filter((at) => Number.isFinite(at) && at > 0);

    if (dates.length > 0) {
        return Math.min(...dates);
    }

    if (firstSeen !== undefined && Number.isFinite(firstSeen) && firstSeen > 0) {
        return firstSeen;
    }

    return fallback !== undefined && Number.isFinite(fallback) && fallback > 0 ? fallback : Infinity;
}

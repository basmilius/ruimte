export interface TunnelStreamEvents {
    /* Bytes from the service. `consumed` says they were written on, which is what lets the next ones come. */
    data(bytes: Uint8Array, consumed: () => void): void;
    /* The backlog toward the service fell, so a paused socket may read again. */
    drain(): void;
    /* The service ended, or the stream failed (`reason` is then the sentence). */
    end(reason: string | null): void;
}

export interface TunnelStream {
    /* False when the backlog toward the service is over its limit; the next `drain` says it fell. */
    write(bytes: Uint8Array): boolean;
    closeWrite(): void;
    close(): void;
}

/* The way out of the shell to the machine that shares the port. The proxy knows nothing else about it. */
export interface TunnelRelay {
    open(events: TunnelStreamEvents): Promise<TunnelStream>;
}

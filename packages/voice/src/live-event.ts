/* An event on a GPT-Live session, either way: what the service sends and what a client or the daemon sends it. */
export interface LiveEvent {
    type: string;
    [key: string]: unknown;
}

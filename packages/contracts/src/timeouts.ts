/*
 * Waits that two ends of one exchange both hold. Each pair has one place where the relation is written, so a change
 * to one wait moves the other with it, and `timeouts.test.ts` fails when a relation stops holding.
 */

/* A request a client sends and no `UNBOUNDED_REQUESTS` entry covers fails when it is not answered by then. */
export const REQUEST_TIMEOUT_MS = 60_000;

// What a machine leaves a client to hear its own answer in, instead of a dropped request.
const ANSWER_MARGIN_MS = 10_000;

/* How long the machine itself waits on something a request is waiting on: under the client's wait, so a person reads the machine's reason. */
export const ANSWER_TIMEOUT_MS = REQUEST_TIMEOUT_MS - ANSWER_MARGIN_MS;

/* How long a page is given to come to rest before the client answers with wherever it got to. */
export const BROWSER_LOAD_TIMEOUT_MS = 10_000;

/* A navigation that never starts (an anchor on the page it is already on) is over by doing nothing. */
export const BROWSER_START_TIMEOUT_MS = 1_500;

// The link there and back, and the client's turn to answer, on top of what the client itself waits.
const BROWSER_ASK_MARGIN_MS = 3_500;

/* What one ask of a client's page may take before the agent hears that nobody answered: past the client's own waits. */
export const BROWSER_ASK_TIMEOUT_MS = BROWSER_LOAD_TIMEOUT_MS + BROWSER_START_TIMEOUT_MS + BROWSER_ASK_MARGIN_MS;

/* Offer to open channel, handshake included; a peer that has not got that far by then is not coming. */
export const DIRECT_ATTEMPT_TIMEOUT_MS = 30_000;

/* How long ICE may gather before the offer or answer goes out with the candidates it has. */
export const ICE_GATHER_TIMEOUT_MS = 5_000;

/* How long a connection id stays tied to the key that offered it: well past an attempt, gathering included. */
export const SIGNAL_OWNER_TTL_MS = 2 * DIRECT_ATTEMPT_TIMEOUT_MS;

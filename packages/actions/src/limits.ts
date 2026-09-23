/*
 * What a name on the canvas fits in: a node title, the label of a group, the word on a line. Past
 * this it is not a name any more but a paragraph in a header, in every list that prints it and in
 * the sidebar. Nothing about it is unique: two nodes may carry the same title, since an id is what
 * names a node and a title is what a person reads.
 */
export const MAX_TITLE_LENGTH = 120;

/*
 * A message is a line or two an agent reads in front of its next turn, not a document. Anything
 * longer belongs in a note on the canvas, which the agent can be linked to and read whole.
 */
export const MAX_NOTICE_LENGTH = 500;

/*
 * The longest first prompt an agent is started with. A terminal agent is started by a line the daemon
 * types into a shell that has not read a byte yet, so that line waits in the tty's canonical buffer
 * (four kilobytes on Linux, eight on macOS) until the shell gets to it, and a line past that is
 * silently cut off. A kickoff prompt of a page fits well under it; anything longer belongs in a
 * file the agent is told to read.
 */
export const MAX_PROMPT_LENGTH = 2000;

/*
 * The agent nodes one caller may have open at a time. The canvas cap of 500 nodes is the ceiling of
 * the drawing, far past the point where a person would notice a loop; this is the narrow one, and it
 * is per caller rather than per project because a person opening agents of their own should never be
 * the one who runs out. It counts nodes that still exist, so removing them frees the count. A team
 * takes as many roles, so one team can fill that allowance and no more.
 */
export const MAX_OPENED_PER_CALLER = 16;

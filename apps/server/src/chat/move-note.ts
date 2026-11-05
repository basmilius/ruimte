/*
 * The note a person reads under a moved chat and the preamble its agent is told, the same for a move
 * that ran through and one the next start finished. `leftAt` is the folder the own files stayed in.
 */
export function movedNote(moved: { name: string; folder: string; leftAt: string | null }): { note: string; preamble: string } {
    const { name, folder, leftAt } = moved;
    const stays = leftAt === null ? '' : ` Its own files stay in ${leftAt}.`;
    const earlier = leftAt === null ? 'Files you made earlier moved there with you.' : `Files you made earlier are still in ${leftAt}.`;
    return {
        note: `Moved from Chats to ${name}.${stays}`,
        preamble: `This chat moved from Chats to the project ${name}. Your working directory is now ${folder}. ${earlier}`
    };
}

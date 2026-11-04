/* What the server tells a model once, in place of the root of `help`: the rules that hold for every tool. */
export const MCP_INSTRUCTIONS = [
    'Ruimte tools work in the project this session belongs to: its views, canvas nodes and lines, agents, tasks and launches, and what this machine runs for it.',
    'context_list names what a person linked to you and context_read reads it; you reach other nodes only over a line or a # reference.',
    'Ids come from the list tools. When you talk to the person, name things by their title, never by id.',
    'view names a canvas by id; from a chat view it reaches any node there without a line. project works in another open project while a person lets agents reach them (project_list).',
    'A path is a file in the project folder, its worktrees, your chat folder or the temp folder.',
    'A write takes revision from the list you decided on and is refused with rev-conflict once the project moved on.',
    'A refused call returns an error that starts with refused <code>: nothing was done, and the lines under it say what the call would accept. So dry_run is only a preview, never needed for safety.'
].join(' ');

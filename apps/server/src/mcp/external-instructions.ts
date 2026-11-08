/* What the external server tells a model once. */
export const EXTERNAL_INSTRUCTIONS = [
    'These tools operate Ruimte as the person who made your credential, inside the projects and the tier that credential names.',
    'Every tool but guide, project_list, project_open and project_activate takes project, the id of a project from project_list.',
    'You stand on no canvas and have no lines: name a canvas with view, and every node there is yours to read and operate. Ids come from the list tools.',
    'When you talk to the person, name things by their title, never by id.',
    'A write takes revision from the list you decided on and is refused with rev-conflict once the project moved on.',
    'A refused call returns an error that starts with refused <code>: nothing was done, and the lines under it say what the call would accept.',
    'Nothing here types into a terminal. A finished agent wakes you nowhere: poll task_list. A call that runs long answers with what to poll.'
].join(' ');

import { ChatMoveTargetSchema, PROJECT_PROPOSAL_LIMITS } from '@ruimte/contracts';
import { z } from 'zod';
import { PERSON_AND_VOICE, AGENT, PERSON, givenName, forActors, CLIENT_ACTORS, chatTarget, projectMachine, listedProjectId } from './fields.ts';

export const PROJECTS_ACTIONS = {
    'project.list': {
        title: 'List projects',
        description: 'Lists the projects of every machine this window knows: the ones in use, and the ones under Recent that a person closed.',
        effect: 'read',
        domain: 'projects',
        actors: CLIENT_ACTORS,
        input: z.object({}),
        output: z.object({
            projects: z.array(
                z.object({
                    endpointId: z.string(),
                    projectId: z.string(),
                    name: z.string(),
                    machine: z.string(),
                    folder: z.string(),
                    recent: z.boolean(),
                    active: z.boolean(),
                    available: z.boolean()
                })
            )
        })
    },
    'project.switch': {
        title: 'Open project',
        description: 'Shows a project of the list in this window. One under Recent comes back into use.',
        effect: 'local',
        domain: 'projects',
        actors: PERSON_AND_VOICE,
        input: z.object({ endpointId: projectMachine, projectId: listedProjectId }),
        output: z.object({ project: z.string(), endpointId: z.string(), projectId: z.string() })
    },
    'project.close': {
        title: 'Close project',
        description:
            'Puts a project of the list under Recent in this window, after confirmation. Its sessions end only when no other client still has it open; the confirmation says which.',
        effect: 'shared',
        domain: 'projects',
        actors: PERSON_AND_VOICE,
        input: z.object({ endpointId: projectMachine, projectId: listedProjectId }),
        output: z.object({
            project: z.string(),
            endpointId: z.string(),
            projectId: z.string(),
            // Null when the machine could not be asked, so only this window let go of it.
            sessions: z.number().int().nullable(),
            otherClients: z.number().int().nullable()
        })
    },
    'project.create': {
        title: 'Open folder as project',
        description: 'Opens a folder on a machine as a project in this window, and makes the folder first when asked to.',
        effect: 'shared',
        domain: 'projects',
        actors: PERSON,
        input: z.object({
            endpointId: projectMachine,
            folder: z.string().min(1).describe('An absolute path on that machine'),
            createFolder: z.boolean().nullable()
        }),
        output: z.object({ project: z.string(), endpointId: z.string(), folder: z.string() })
    },
    'chat.move': {
        title: 'Move AI Chat out of Chats',
        description:
            'Moves an AI Chat of the Chats project into a project on its machine: one that is in the list, or a new one made in a folder. The chat keeps its conversation and works in the project folder from its next turn. Refused while it works, or while it has agents, tasks, owed work, waiting messages or a pull request watch.',
        effect: 'shared',
        domain: 'projects',
        actors: PERSON,
        input: z.object({
            endpointId: projectMachine,
            chatId: chatTarget,
            to: ChatMoveTargetSchema.describe('A project of the list by projectId, or a folder with the name of the project to make there'),
            ownFiles: z.enum(['move', 'leave']).describe('Whether the files the chat made in its own folder move into the project or stay in Chats')
        }),
        output: z.object({ project: z.string(), projectId: z.string(), viewId: z.string() })
    },
    'project.propose': {
        title: 'Suggest a project',
        description:
            "Suggests, in a card of the caller's chat in Chats, that the chat becomes a project; the person reviews it and decides. Makes nothing itself.",
        effect: 'external',
        domain: 'projects',
        actors: AGENT,
        input: z.object({
            name: z.string().trim().min(1).max(PROJECT_PROPOSAL_LIMITS.name).describe('The name of the project, such as the product or the repository'),
            folder: z
                .string()
                .trim()
                .min(1)
                .max(PROJECT_PROPOSAL_LIMITS.folder)
                .nullish()
                .describe('An absolute folder on this machine the project would live in; the person picks one when it is left out'),
            reason: z.string().trim().min(1).max(PROJECT_PROPOSAL_LIMITS.reason).describe('Why the work is a project now, in one or two sentences')
        }),
        output: z.object({
            proposalId: z.string(),
            outcome: z.enum(['declined', 'waiting'])
        })
    },
    'project.ignoredFiles': {
        title: 'List the ignored files of the project',
        description:
            'Lists the files git ignores in the repository of the project (.env files, local settings), which a clone elsewhere does not bring. A folder ignored whole, such as node_modules, is left out.',
        agentDescription: 'Lists the files git ignores in the project repository: path, size, link; folders ignored whole are left out',
        effect: 'read',
        domain: 'projects',
        actors: AGENT,
        input: z.object({}),
        output: z.object({
            // The repository's top level, which every path is relative to.
            root: z.string(),
            files: z.array(z.object({ path: z.string(), size: z.number().int(), link: z.boolean() })),
            truncated: z.boolean()
        })
    },
    'project.delete': {
        title: 'Delete project',
        description: 'Removes a project from its machine after confirmation. A folder keeps every file but, when asked, its canvas file.',
        effect: 'shared',
        domain: 'projects',
        actors: PERSON,
        input: z.object({ endpointId: projectMachine, projectId: listedProjectId, removeFiles: z.boolean().nullable() }),
        output: z.object({ project: z.string(), endpointId: z.string(), projectId: z.string() })
    },
    'project.setAppearance': {
        title: 'Change project name, icon or color',
        description:
            'Renames a project of the list, gives it a Lucide icon from the set the picker has (or folder for what the folder itself declares), or a color. The color is in the shared project file, so a team sees it.',
        effect: 'shared',
        domain: 'projects',
        actors: PERSON_AND_VOICE,
        input: z.object({
            endpointId: projectMachine,
            projectId: listedProjectId,
            name: givenName.nullable(),
            icon: z.string().min(1).nullable().describe('A Lucide name, folder for what the folder itself declares, or none to clear a picked icon'),
            image: forActors(PERSON, z.object({ mime: z.string().min(1), base64: z.string().min(1) })).describe(
                'An image the icon becomes, written into the folder'
            ),
            color: z
                .string()
                .regex(/^#[0-9a-fA-F]{6}$/)
                .nullable()
                .describe('The color of the project as #rrggbb')
        }),
        output: z.object({ project: z.string(), endpointId: z.string(), projectId: z.string(), icon: z.string() })
    }
} as const;

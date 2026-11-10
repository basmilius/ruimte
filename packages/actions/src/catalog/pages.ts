import { z } from 'zod';
import { PERSON_VOICE_AND_AGENT, operatedView, browserNode, browserOutcome, PERSON_VOICE_AGENT_AND_EXTENSION, PERSON_AGENT_AND_EXTENSION } from './fields.ts';

export const PAGES_ACTIONS = {
    'browser.inspect': {
        title: 'Read a page',
        description: 'Where the page of a browser node stands: its address, its title, whether it is loading and what its history holds.',
        effect: 'read',
        domain: 'pages',
        actors: PERSON_VOICE_AGENT_AND_EXTENSION,
        input: z.object({ nodeId: browserNode, viewId: operatedView }),
        output: browserOutcome
    },
    'browser.navigate': {
        title: 'Go to an address',
        description: 'Sends the page of a browser node to an address.',
        effect: 'external',
        domain: 'pages',
        actors: PERSON_VOICE_AGENT_AND_EXTENSION,
        input: z.object({ nodeId: browserNode, viewId: operatedView, url: z.string().min(1).describe('A whole http or https address, scheme and all') }),
        output: browserOutcome.extend({
            // The address a node that had none was given: written in the project, with no page driven.
            assigned: z.object({ url: z.string(), title: z.string() }).nullable()
        })
    },
    'browser.back': {
        title: 'Go back',
        description: 'Takes the page one step back through its own history.',
        effect: 'external',
        domain: 'pages',
        actors: PERSON_VOICE_AGENT_AND_EXTENSION,
        input: z.object({ nodeId: browserNode, viewId: operatedView }),
        output: browserOutcome
    },
    'browser.forward': {
        title: 'Go forward',
        description: 'Takes the page one step forward again, after a step back.',
        effect: 'external',
        domain: 'pages',
        actors: PERSON_VOICE_AGENT_AND_EXTENSION,
        input: z.object({ nodeId: browserNode, viewId: operatedView }),
        output: browserOutcome
    },
    'browser.reload': {
        title: 'Reload a page',
        description: 'Loads the page of a browser node again.',
        effect: 'external',
        domain: 'pages',
        actors: PERSON_VOICE_AGENT_AND_EXTENSION,
        input: z.object({
            nodeId: browserNode,
            viewId: operatedView,
            hard: z.boolean().describe('Loads it past the cache, the way a person holding shift would')
        }),
        output: browserOutcome
    },
    'browser.stop': {
        title: 'Stop loading',
        description: 'Ends a load that is still running, leaving the page as far as it got.',
        effect: 'external',
        domain: 'pages',
        actors: PERSON_VOICE_AND_AGENT,
        input: z.object({ nodeId: browserNode, viewId: operatedView }),
        output: browserOutcome
    },
    'browser.screenshot': {
        title: 'Photograph a page',
        description: 'Writes a png of the page of a browser node and answers where it is.',
        effect: 'read',
        domain: 'pages',
        actors: PERSON_AGENT_AND_EXTENSION,
        input: z.object({ nodeId: browserNode, viewId: operatedView }),
        output: browserOutcome.extend({
            // On this machine, outside the project folder; null when nobody has the page open.
            path: z.string().nullable()
        })
    }
} as const;

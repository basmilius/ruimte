import type { BenchmarkLab } from '@ruimte/pulsar';

/*
 * Ruimte's models against Artificial Analysis's, so a new model gets its points with a deploy of this
 * Worker. There an effort is a model of its own: each effort names its id and that id's name for a
 * reader. No id means not measured; ultrathink and ultra have no counterpart above max. A switch such
 * as Haiku's thinking is two efforts, `off` and the id of the switch.
 */

// `claude` and `codex` predate the labs and stay, since clients without `labs` only draw those two.
export type BenchmarkProvider = 'claude' | 'codex' | 'xai' | 'google';

/*
 * The marks are the ones `ProviderLogo` draws in ADE CORE, and Gemini's from Simple Icons
 * (https://simpleicons.org, `googlegemini`), each in a 24 by 24 box.
 */
export const BENCHMARK_LABS: readonly (BenchmarkLab & { id: BenchmarkProvider })[] = [
    {
        id: 'claude',
        name: 'Anthropic',
        logo: {
            viewBox: '0 0 24 24',
            path: 'M4.709 15.955l4.72-2.647.079-.23-.08-.128H9.2l-.79-.048-2.698-.073-2.339-.097-2.266-.122-.571-.121L0 11.784l.055-.352.48-.321.686.06 1.52.103 2.278.158 1.652.097 2.449.255h.389l.055-.157-.134-.098-.103-.097-2.358-1.596-2.552-1.688-1.336-.972-.724-.491-.364-.462-.158-1.008.656-.722.881.06.225.061.893.686 1.908 1.476 2.491 1.833.365.304.145-.103.019-.073-.164-.274-1.355-2.446-1.446-2.49-.644-1.032-.17-.619a2.97 2.97 0 01-.104-.729L6.283.134 6.696 0l.996.134.42.364.62 1.414 1.002 2.229 1.555 3.03.456.898.243.832.091.255h.158V9.01l.128-1.706.237-2.095.23-2.695.08-.76.377-.91.747-.492.584.28.48.685-.067.444-.286 1.851-.559 2.903-.364 1.942h.212l.243-.242.985-1.306 1.652-2.064.73-.82.85-.904.547-.431h1.033l.76 1.129-.34 1.166-1.064 1.347-.881 1.142-1.264 1.7-.79 1.36.073.11.188-.02 2.856-.606 1.543-.28 1.841-.315.833.388.091.395-.328.807-1.969.486-2.309.462-3.439.813-.042.03.048.061 1.549.146.662.036h1.622l3.02.225.79.522.474.638-.079.485-1.215.62-1.64-.389-3.829-.91-1.312-.329h-.182v.11l1.093 1.068 2.006 1.81 2.509 2.33.127.578-.322.455-.34-.049-2.205-1.657-.851-.747-1.926-1.62h-.128v.17l.444.649 2.345 3.521.122 1.08-.17.353-.607.212-.668-.122-1.374-1.925-1.415-2.167-1.143-1.943-.14.08-.674 7.254-.316.37-.729.28-.607-.461-.322-.747.322-1.476.389-1.924.315-1.53.286-1.9.17-.632-.012-.042-.14.018-1.434 1.967-2.18 2.945-1.726 1.845-.414.164-.717-.37.067-.662.401-.589 2.388-3.036 1.44-1.882.93-1.086-.006-.158h-.055L4.132 18.56l-1.13.146-.487-.456.061-.746.231-.243 1.914-1.316-.012.01z'
        },
        colors: {
            light: ['#a55737', '#ba7050', '#8f614b', '#cd8967', '#a07b65', '#805742'],
            dark: ['#c27c60', '#e49c7c', '#b8886b', '#d0a38a', '#aa8b79', '#c59477']
        }
    },
    {
        id: 'codex',
        name: 'OpenAI',
        logo: {
            viewBox: '0 0 24 24',
            path: 'M21.55 10.004a5.416 5.416 0 00-.478-4.501c-1.217-2.09-3.662-3.166-6.05-2.66A5.59 5.59 0 0010.831 1C8.39.995 6.224 2.546 5.473 4.838A5.553 5.553 0 001.76 7.496a5.487 5.487 0 00.691 6.5 5.416 5.416 0 00.477 4.502c1.217 2.09 3.662 3.165 6.05 2.66A5.586 5.586 0 0013.168 23c2.443.006 4.61-1.546 5.361-3.84a5.554 5.554 0 003.715-2.66 5.488 5.488 0 00-.693-6.497v.001zm-8.381 11.558a4.199 4.199 0 01-2.675-.954c.034-.018.093-.05.132-.074l4.44-2.53a.71.71 0 00.364-.623v-6.176l1.877 1.069c.02.01.033.029.036.05v5.115c-.003 2.274-1.87 4.118-4.174 4.123zM4.192 17.78a4.059 4.059 0 01-.498-2.763c.032.019.09.055.131.078l4.44 2.53c.225.13.504.13.73 0l5.42-3.088v2.138a.068.068 0 01-.027.057L9.9 19.288c-1.999 1.136-4.552.46-5.707-1.51h-.001zM3.023 8.216A4.15 4.15 0 015.198 6.41l-.002.151v5.06a.711.711 0 00.364.624l5.42 3.087-1.876 1.07a.067.067 0 01-.063.005l-4.489-2.559c-1.995-1.14-2.679-3.658-1.53-5.63h.001zm15.417 3.54l-5.42-3.088L14.896 7.6a.067.067 0 01.063-.006l4.489 2.557c1.998 1.14 2.683 3.662 1.529 5.633a4.163 4.163 0 01-2.174 1.807V12.38a.71.71 0 00-.363-.623zm1.867-2.773a6.04 6.04 0 00-.132-.078l-4.44-2.53a.731.731 0 00-.729 0l-5.42 3.088V7.325a.068.068 0 01.027-.057L14.1 4.713c2-1.137 4.555-.46 5.707 1.513.487.833.664 1.809.499 2.757h.001zm-11.741 3.81l-1.877-1.068a.065.065 0 01-.036-.051V6.559c.001-2.277 1.873-4.122 4.181-4.12.976 0 1.92.338 2.671.954-.034.018-.092.05-.131.073l-4.44 2.53a.71.71 0 00-.365.623l-.003 6.173v.001zm1.02-2.168L12 9.25l2.414 1.375v2.75L12 14.75l-2.415-1.375v-2.75z'
        },
        colors: {
            light: ['#364553', '#506779', '#70899a', '#496d75', '#7a8189', '#616575'],
            dark: ['#eef1f2', '#bcc5cd', '#91a0ae', '#a4c2c7', '#b3b5bc', '#a4a1b8']
        }
    },
    {
        id: 'google',
        name: 'Google',
        logo: {
            viewBox: '0 0 24 24',
            path: 'M11.04 19.32Q12 21.51 12 24q0-2.49.93-4.68.96-2.19 2.58-3.81t3.81-2.55Q21.51 12 24 12q-2.49 0-4.68-.93a12.3 12.3 0 0 1-3.81-2.58 12.3 12.3 0 0 1-2.58-3.81Q12 2.49 12 0q0 2.49-.96 4.68-.93 2.19-2.55 3.81a12.3 12.3 0 0 1-3.81 2.58Q2.49 12 0 12q2.49 0 4.68.96 2.19.93 3.81 2.55t2.55 3.81'
        },
        colors: {
            light: ['#2f6fb3', '#4a87c9', '#24578f', '#5f9bd6', '#3d6f9e', '#1d4a78'],
            dark: ['#7fb2ec', '#9cc4f2', '#6aa0dc', '#b4d3f6', '#8aaed6', '#5e93cf']
        }
    },
    {
        id: 'xai',
        name: 'xAI',
        logo: {
            viewBox: '0 0 24 24',
            path: 'M6.469 8.776 16.512 23h-4.464L2.005 8.776H6.47Zm-.004 7.9 2.233 3.164L6.467 23H2l4.465-6.324ZM22 2.582V23h-3.659V7.764L22 2.582ZM22 1l-9.952 14.095-2.233-3.163L17.533 1H22Z'
        },
        colors: {
            light: ['#5b4b8a', '#7562a8', '#4a3f6b', '#8a78bd', '#6d5f8f', '#3f3560'],
            dark: ['#b4a4e6', '#9d8ad8', '#c9bdf0', '#8f7fc4', '#ab9fd0', '#d6ccf5']
        }
    }
];

export type BenchmarkEffort = { effort: string } & ({ id: string; name: string } | { id: null; name: null });

export interface BenchmarkSource {
    slug: string;
    name: string;
    provider: BenchmarkProvider;
    legacy: boolean;
    // In the order the line runs through them, cheapest first.
    efforts: BenchmarkEffort[];
}

export const BENCHMARK_MODELS: readonly BenchmarkSource[] = [
    {
        slug: 'claude-fable-5-1',
        name: 'Claude Fable 5.1',
        provider: 'claude',
        legacy: false,
        efforts: [
            { effort: 'low', id: '05776db7-f5c0-40f7-b824-079160f8cfa8', name: 'Claude Fable 5.1 (Adaptive Reasoning, Low Effort, Default Fallback)' },
            { effort: 'medium', id: '3b7de71c-e034-4591-8ca6-6b6be2fa471f', name: 'Claude Fable 5.1 (Adaptive Reasoning, Medium Effort, Default Fallback)' },
            { effort: 'high', id: '9d7d72cd-d95d-45a0-b109-4ad292c9aabd', name: 'Claude Fable 5.1 (Adaptive Reasoning, High Effort, Default Fallback)' },
            { effort: 'xhigh', id: '9b166bf3-42db-4f63-8338-1c4a1244ffe8', name: 'Claude Fable 5.1 (Adaptive Reasoning, Xhigh Effort, Default Fallback)' },
            { effort: 'max', id: '3e87c73e-a257-495e-9730-367a66229811', name: 'Claude Fable 5.1 (Adaptive Reasoning, Max Effort, Default Fallback)' }
        ]
    },
    {
        slug: 'claude-opus-5-5',
        name: 'Claude Opus 5.5',
        provider: 'claude',
        legacy: false,
        efforts: [
            { effort: 'low', id: '4416ca93-fde6-4b7b-abbc-3a6be109cc3d', name: 'Claude Opus 5.5 (Adaptive Reasoning, Low Effort, Default Fallback)' },
            { effort: 'medium', id: 'ea9e0da6-169f-43c6-92f5-730a10d6ff8d', name: 'Claude Opus 5.5 (Adaptive Reasoning, Medium Effort, Default Fallback)' },
            { effort: 'high', id: 'f314eade-2232-44bf-a3ab-9b326bc67de6', name: 'Claude Opus 5.5 (Adaptive Reasoning, High Effort, Default Fallback)' },
            { effort: 'xhigh', id: 'df5bf99d-d228-4715-b41b-19ca86118777', name: 'Claude Opus 5.5 (Adaptive Reasoning, Xhigh Effort, Default Fallback)' },
            { effort: 'max', id: '2f3c4dc9-a450-4303-8697-0237257cf08f', name: 'Claude Opus 5.5 (Adaptive Reasoning, Max Effort, Default Fallback)' }
        ]
    },
    {
        slug: 'claude-opus-5',
        name: 'Claude Opus 5',
        provider: 'claude',
        legacy: false,
        efforts: [
            { effort: 'low', id: '20928ba9-3a3f-415f-9519-b84ff64ecf34', name: 'Claude Opus 5 (Adaptive Reasoning, Low Effort)' },
            { effort: 'medium', id: 'ff51be8f-e362-4a7e-9043-687ba15de207', name: 'Claude Opus 5 (Adaptive Reasoning, Medium Effort)' },
            { effort: 'high', id: '712be54a-77ae-41b2-9a58-21181479d6ee', name: 'Claude Opus 5 (Adaptive Reasoning, High Effort)' },
            { effort: 'xhigh', id: '1305c921-7aaa-4d6d-99b5-99b3acf15e19', name: 'Claude Opus 5 (Adaptive Reasoning, Xhigh Effort)' },
            { effort: 'max', id: 'b8fc61f7-5e9a-49e6-8547-6ac56db24627', name: 'Claude Opus 5 (Adaptive Reasoning, Max Effort)' }
        ]
    },
    {
        slug: 'claude-sonnet-5-5',
        name: 'Claude Sonnet 5.5',
        provider: 'claude',
        legacy: false,
        efforts: [
            { effort: 'low', id: 'bbc2ffea-cf6b-43be-8c41-1769347e234d', name: 'Claude Sonnet 5.5 (Adaptive Reasoning, Low Effort, Default Fallback)' },
            { effort: 'medium', id: '042e8a37-fcd0-40f4-8f41-99215fb68eda', name: 'Claude Sonnet 5.5 (Adaptive Reasoning, Medium Effort, Default Fallback)' },
            { effort: 'high', id: '268525e2-f873-4178-bc07-e6a0ee1f002d', name: 'Claude Sonnet 5.5 (Adaptive Reasoning, High Effort, Default Fallback)' },
            { effort: 'xhigh', id: '975aeaef-50bd-4a65-9c73-f1015adcd4d4', name: 'Claude Sonnet 5.5 (Adaptive Reasoning, Xhigh Effort, Default Fallback)' },
            { effort: 'max', id: 'b171d979-5ec1-45de-b8b9-db1ee65e77ec', name: 'Claude Sonnet 5.5 (Adaptive Reasoning, Max Effort, Default Fallback)' }
        ]
    },
    {
        slug: 'claude-sonnet-5',
        name: 'Claude Sonnet 5',
        provider: 'claude',
        legacy: false,
        efforts: [
            { effort: 'low', id: '142b93bf-09c4-42dc-9c3a-50b1a222cbd4', name: 'Claude Sonnet 5 (Adaptive Reasoning, Low Effort)' },
            { effort: 'medium', id: 'effcd151-7c31-4437-af3d-e88daeae9385', name: 'Claude Sonnet 5 (Adaptive Reasoning, Medium Effort)' },
            { effort: 'high', id: 'ba0224cf-0351-4f56-8508-b3f1a740ae4a', name: 'Claude Sonnet 5 (Adaptive Reasoning, High Effort)' },
            { effort: 'xhigh', id: '99f376bf-cbcb-4124-bf3e-6b0a4e6e9bea', name: 'Claude Sonnet 5 (Adaptive Reasoning, Xhigh Effort)' },
            { effort: 'max', id: '23c86e4a-c769-43c0-a056-79e3cd15834f', name: 'Claude Sonnet 5 (Adaptive Reasoning, Max Effort)' }
        ]
    },
    {
        slug: 'claude-haiku-5-5',
        name: 'Claude Haiku 5.5',
        provider: 'claude',
        legacy: false,
        efforts: [
            { effort: 'low', id: '42908ae3-d3bd-4934-be19-fbff93d3fde8', name: 'Claude Haiku 5.5 (Low, Default Fallback)' },
            { effort: 'medium', id: 'af26fff4-8120-41be-a5f0-86aaea023f20', name: 'Claude Haiku 5.5 (Medium, Default Fallback)' },
            { effort: 'high', id: '20829974-af06-497e-9f42-77fb958d43b9', name: 'Claude Haiku 5.5 (High, Default Fallback)' },
            { effort: 'xhigh', id: '41b5bf5e-daf6-42d9-b8d1-60e340a3028d', name: 'Claude Haiku 5.5 (Xhigh, Default Fallback)' },
            { effort: 'max', id: '7d064a11-6e78-4030-b535-cdf940615041', name: 'Claude Haiku 5.5 (Max, Default Fallback)' }
        ]
    },
    {
        slug: 'claude-haiku-4-5',
        name: 'Claude Haiku 4.5',
        provider: 'claude',
        legacy: true,
        efforts: [
            { effort: 'off', id: 'c2b1e769-7aee-4669-8076-73918bdebf6c', name: 'Claude 4.5 Haiku (Non-reasoning)' },
            { effort: 'thinking', id: 'a6340098-d7ae-462d-b372-0a0a67fc44b4', name: 'Claude 4.5 Haiku (Reasoning)' }
        ]
    },
    {
        slug: 'claude-opus-4-6',
        name: 'Claude Opus 4.6',
        provider: 'claude',
        legacy: true,
        efforts: [
            { effort: 'low', id: null, name: null },
            { effort: 'medium', id: null, name: null },
            { effort: 'high', id: null, name: null },
            { effort: 'xhigh', id: null, name: null },
            { effort: 'max', id: '53c98840-47af-49aa-94e6-469fb17e9a1b', name: 'Claude Opus 4.6 (Adaptive Reasoning, Max Effort)' }
        ]
    },
    {
        slug: 'claude-sonnet-4-6',
        name: 'Claude Sonnet 4.6',
        provider: 'claude',
        legacy: true,
        efforts: [
            { effort: 'low', id: null, name: null },
            { effort: 'medium', id: null, name: null },
            { effort: 'high', id: null, name: null },
            { effort: 'xhigh', id: null, name: null },
            { effort: 'max', id: 'df8d14e0-3997-4e4d-b4ad-9c047acc9c69', name: 'Claude Sonnet 4.6 (Adaptive Reasoning, Max Effort)' }
        ]
    },
    {
        slug: 'gpt-6-astra',
        name: 'GPT-6 Astra',
        provider: 'codex',
        legacy: false,
        efforts: [
            { effort: 'low', id: 'a3f8100d-e38f-408b-b0fa-0085dae18dc1', name: 'GPT-6 Astra (low)' },
            { effort: 'medium', id: 'e97a4ef5-e817-480e-9595-12f81dc4974f', name: 'GPT-6 Astra (medium)' },
            { effort: 'high', id: 'e05a4828-0536-4876-870d-a235023f992b', name: 'GPT-6 Astra (high)' },
            { effort: 'xhigh', id: '1f541ef3-913f-4eb2-9d07-0e93c7a9a5e3', name: 'GPT-6 Astra (xhigh)' },
            { effort: 'max', id: '2f339a97-9a0d-499a-9cb5-e0db665bfa25', name: 'GPT-6 Astra (max)' }
        ]
    },
    {
        slug: 'gpt-6.1-sol',
        name: 'GPT-6.1 Sol',
        provider: 'codex',
        legacy: false,
        efforts: [
            { effort: 'low', id: 'e76e0fe5-93ca-4272-9359-2eb1740467d1', name: 'GPT-6.1 Sol (Low)' },
            { effort: 'medium', id: 'a2e51d62-ea4e-4f15-8be0-be9dc1fb489d', name: 'GPT-6.1 Sol (Medium)' },
            { effort: 'high', id: '3b84fee3-b70a-41bc-819e-5fbdef9a0042', name: 'GPT-6.1 Sol (High)' },
            { effort: 'xhigh', id: '092a3b0e-c5c8-45dc-bf1b-53673c8ff352', name: 'GPT-6.1 Sol (Xhigh)' },
            { effort: 'max', id: 'b25ac058-1e33-4c31-bbc9-a20c3ad0717a', name: 'GPT-6.1 Sol (Max)' }
        ]
    },
    {
        slug: 'gpt-6-sol',
        name: 'GPT-6 Sol',
        provider: 'codex',
        legacy: false,
        efforts: [
            { effort: 'low', id: '01459872-433a-4ab2-8e99-7083162172eb', name: 'GPT-6 Sol (low)' },
            { effort: 'medium', id: '780a4a85-17ff-4175-a8dd-ebca4823e61b', name: 'GPT-6 Sol (medium)' },
            { effort: 'high', id: '52eebe3e-6ede-4e46-92db-c5dea49fc410', name: 'GPT-6 Sol (high)' },
            { effort: 'xhigh', id: 'da2642fe-9f73-4788-b5af-24edcd55b37e', name: 'GPT-6 Sol (xhigh)' },
            { effort: 'max', id: 'c50ea08c-88c0-4eb7-85b8-27f2bbf6d527', name: 'GPT-6 Sol (max)' }
        ]
    },
    {
        slug: 'gpt-6-luna',
        name: 'GPT-6 Luna',
        provider: 'codex',
        legacy: false,
        efforts: [
            { effort: 'low', id: 'bf9708d8-933d-44f6-affa-b696a7a650c9', name: 'GPT-6 Luna (low)' },
            { effort: 'medium', id: '36667da0-9222-4967-adbb-f7efa15ad213', name: 'GPT-6 Luna (medium)' },
            { effort: 'high', id: '7d1229bc-deea-4717-ba5b-f59a35d991e3', name: 'GPT-6 Luna (high)' },
            { effort: 'xhigh', id: '19813eb2-460a-475c-af65-810bb8660fec', name: 'GPT-6 Luna (xhigh)' },
            { effort: 'max', id: '6fb13851-40ce-4bda-ad3f-6b38e0c5daa7', name: 'GPT-6 Luna (max)' }
        ]
    },
    {
        slug: 'gpt-5.6-sol',
        name: 'GPT-5.6 Sol',
        provider: 'codex',
        legacy: true,
        efforts: [
            { effort: 'low', id: '0904b596-8932-43bd-9b21-324f128e1723', name: 'GPT-5.6 Sol (low)' },
            { effort: 'medium', id: '6f174934-5b7d-4333-86cb-f5ebf4a862e3', name: 'GPT-5.6 Sol (medium)' },
            { effort: 'high', id: '8afc250d-b538-45a2-812a-4605f4ffd87e', name: 'GPT-5.6 Sol (high)' },
            { effort: 'xhigh', id: 'd998db47-9b67-4727-a2bb-2e1261020ac0', name: 'GPT-5.6 Sol (xhigh)' },
            { effort: 'max', id: 'd93edfe8-bf35-49ad-b56e-b18116142a1c', name: 'GPT-5.6 Sol (max)' }
        ]
    },
    {
        slug: 'gpt-5.6-terra',
        name: 'GPT-5.6 Terra',
        provider: 'codex',
        legacy: true,
        efforts: [
            { effort: 'low', id: 'cc4a20cd-09fe-4962-a430-119c815e85fa', name: 'GPT-5.6 Terra (low)' },
            { effort: 'medium', id: '26e0f83a-ca98-4f34-94ac-7c5e251ee410', name: 'GPT-5.6 Terra (medium)' },
            { effort: 'high', id: '81972fba-1219-477e-bbfb-18c656a63ff7', name: 'GPT-5.6 Terra (high)' },
            { effort: 'xhigh', id: '9e30696f-16fa-4b4f-ba53-161895a85fed', name: 'GPT-5.6 Terra (xhigh)' },
            { effort: 'max', id: 'bcf8db0a-3bb6-4d82-9516-0f57370c85a6', name: 'GPT-5.6 Terra (max)' }
        ]
    },
    {
        slug: 'gpt-5.6-luna',
        name: 'GPT-5.6 Luna',
        provider: 'codex',
        legacy: true,
        efforts: [
            { effort: 'low', id: '050c61cd-cddc-463a-a30a-a82aaa37be59', name: 'GPT-5.6 Luna (low)' },
            { effort: 'medium', id: '58b812bf-8498-46db-b834-f43ccc614b61', name: 'GPT-5.6 Luna (medium)' },
            { effort: 'high', id: 'aa55297e-8fbf-4372-b4ab-9b068dc6396c', name: 'GPT-5.6 Luna (high)' },
            { effort: 'xhigh', id: '87110ff0-1f79-41b4-9976-eda250597317', name: 'GPT-5.6 Luna (xhigh)' },
            { effort: 'max', id: '426d24c8-49ae-482a-b4a8-20f1c53f21c1', name: 'GPT-5.6 Luna (max)' }
        ]
    },
    {
        slug: 'gpt-5.5',
        name: 'GPT-5.5',
        provider: 'codex',
        legacy: true,
        efforts: [
            { effort: 'low', id: 'c77cfe51-f4a0-4692-9dee-5061ef667f23', name: 'GPT-5.5 (low)' },
            { effort: 'medium', id: '6b79f899-e3c0-45f6-923c-243faccdb2fc', name: 'GPT-5.5 (medium)' },
            { effort: 'high', id: 'b13c1257-d746-4027-8fc8-4892dc14701c', name: 'GPT-5.5 (high)' },
            { effort: 'xhigh', id: '1f054429-397e-4fdb-9e71-67bc92c1735e', name: 'GPT-5.5 (xhigh)' }
        ]
    },
    {
        slug: 'gpt-5.3-codex-spark',
        name: 'GPT-5.3 Codex Spark',
        provider: 'codex',
        legacy: true,
        efforts: [
            { effort: 'low', id: null, name: null },
            { effort: 'medium', id: null, name: null },
            { effort: 'high', id: null, name: null },
            { effort: 'xhigh', id: null, name: null }
        ]
    },
    {
        slug: 'gemini-4-argon',
        name: 'Gemini 4 Argon',
        provider: 'google',
        legacy: false,
        efforts: [{ effort: 'high', id: 'd366dfa1-d940-4788-aa73-d298c45699b3', name: 'Gemini 4 Argon (High)' }]
    },
    {
        slug: 'gemini-3.8-flash',
        name: 'Gemini 3.8 Flash',
        provider: 'google',
        legacy: false,
        efforts: [
            { effort: 'low', id: 'f6db039b-0f3b-485c-9d7f-982988e44f26', name: 'Gemini 3.8 Flash (Low)' },
            { effort: 'medium', id: '744fa3c1-42a7-4995-b138-fb6be11f463c', name: 'Gemini 3.8 Flash (Medium)' },
            { effort: 'high', id: '8a999846-4c1d-4ce7-a8b7-1310a7166fd7', name: 'Gemini 3.8 Flash (High)' }
        ]
    },
    {
        slug: 'grok-4.7',
        name: 'Grok 4.7',
        provider: 'xai',
        legacy: false,
        efforts: [
            { effort: 'low', id: '208c16f0-8c5b-4524-ac8a-ac74c02e80a9', name: 'Grok 4.7 (Low)' },
            { effort: 'medium', id: null, name: null },
            { effort: 'high', id: '272f5f03-aea9-4675-a244-2b753b618cdf', name: 'Grok 4.7 (High)' },
            { effort: 'xhigh', id: '59627802-1546-422c-9a65-65b61c022d36', name: 'Grok 4.7 (Xhigh)' }
        ]
    },
    {
        slug: 'grok-4.6',
        name: 'Grok 4.6',
        provider: 'xai',
        legacy: true,
        efforts: [
            { effort: 'low', id: 'c07e65e6-32fc-451e-938d-7477a1c3ffcc', name: 'Grok 4.6 (Low)' },
            { effort: 'medium', id: '26614164-6840-4e17-a65a-2deb2fe7e87b', name: 'Grok 4.6 (Medium)' },
            { effort: 'high', id: 'c8adc5cf-fd5a-407b-af51-dc3bede3e49c', name: 'Grok 4.6 (High)' },
            { effort: 'xhigh', id: 'd6f43d0a-e8c4-447c-9ff7-5cf0a9d59aa3', name: 'Grok 4.6 (Xhigh)' }
        ]
    },
    {
        slug: 'grok-4.5',
        name: 'Grok 4.5',
        provider: 'xai',
        legacy: true,
        efforts: [{ effort: 'high', id: '794f69b5-cede-482b-b1cc-d769478497cd', name: 'Grok 4.5 (High)' }]
    }
];

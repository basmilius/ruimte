/*
 * The models of Ruimte against the models Artificial Analysis measures, which is where a new model gets
 * its points: a deploy of this Worker and not a release of the app. At Artificial Analysis an effort is
 * a model of its own, so every effort names the id it is looked up by and the name that id had, for a
 * person reading this table. An effort without an id was not measured there. Ultrathink and ultra have
 * no counterpart, since Artificial Analysis measures up to max. A switch such as Haiku's thinking is
 * two efforts, `off` and the id of the switch.
 */

export type BenchmarkProvider = 'claude' | 'codex';

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
        slug: 'claude-haiku-4-5',
        name: 'Claude Haiku 4.5',
        provider: 'claude',
        legacy: false,
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
    }
];

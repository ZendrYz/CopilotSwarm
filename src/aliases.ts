export const ALIAS_MAP: Record<string, string> = {
  'auto':                       'auto',

  'gpt4.1':                     'gpt-4.1',
  'gpt 4.1':                    'gpt-4.1',
  'gpt5 mini':                  'gpt-5-mini',
  'gpt 5 mini':                 'gpt-5-mini',
  'gpt5.2':                     'gpt-5.2',
  'gpt 5.2':                    'gpt-5.2',
  'gpt5.2 codex':               'gpt-5.2-codex',
  'gpt52 codex':                'gpt-5.2-codex',
  'gpt5.3 codex':               'gpt-5.3-codex',
  'gpt53 codex':                'gpt-5.3-codex',
  'gpt5.4':                     'gpt-5.4',
  'gpt 5.4':                    'gpt-5.4',
  'gpt5.4 mini':                'gpt-5.4-mini',
  'gpt54 mini':                 'gpt-5.4-mini',

  'haiku':                      'claude-haiku-4.5',
  'claude haiku':               'claude-haiku-4.5',
  'haiku 4.5':                  'claude-haiku-4.5',

  'sonnet':                     'claude-sonnet-4.6',
  'claude sonnet':              'claude-sonnet-4.6',
  'sonnet 4':                   'claude-sonnet-4',
  'claude sonnet 4':            'claude-sonnet-4',
  'sonnet 4.5':                 'claude-sonnet-4.5',
  'claude sonnet 4.5':          'claude-sonnet-4.5',
  'sonnet 4.6':                 'claude-sonnet-4.6',
  'claude sonnet 4.6':          'claude-sonnet-4.6',

  'opus':                       'claude-opus-4.6',
  'claude opus':                'claude-opus-4.6',
  'opus 4.5':                   'claude-opus-4.5',
  'claude opus 4.5':            'claude-opus-4.5',
  'opus 4.6':                   'claude-opus-4.6',
  'claude opus 4.6':            'claude-opus-4.6',
  'opus fast':                  'claude-opus-4.6-fast',
  'claude opus fast':           'claude-opus-4.6-fast',

  'gemini flash':               'gemini-3-flash',
  'gemini 3 flash':             'gemini-3-flash',
  'gemini pro':                 'gemini-3.1-pro',
  'gemini 3.1 pro':             'gemini-3.1-pro',
  'gemini 2.5 pro':             'gemini-2.5-pro',
  'gemini 2.5':                 'gemini-2.5-pro',

  'grok':                       'grok-code-fast-1',
  'grok fast':                  'grok-code-fast-1',
  'grok code':                  'grok-code-fast-1',
  'grok code fast':             'grok-code-fast-1',
  'raptor':                     'raptor-mini',
  'raptor mini':                'raptor-mini',
  'goldeneye':                  'goldeneye',
};

export type CopilotModel = {
  id: string;
  provider: string;
  status: 'ga' | 'preview' | 'retiring';
  retirementDate?: string;
  multiplierPaid: number | null;  
  multiplierFree: number | null;   
  plans: {
    free: boolean;
    student: boolean;
    pro: boolean;
    proPlusAndBusiness: boolean;
    enterprise: boolean;
  };
  taskArea: string;
};

export const COPILOT_MODELS: CopilotModel[] = [
  {
    id: 'gpt-4.1',
    provider: 'OpenAI',
    status: 'ga',
    multiplierPaid: 0,
    multiplierFree: 1,
    plans: { free: true, student: true, pro: true, proPlusAndBusiness: true, enterprise: true },
    taskArea: 'general',
  },
  {
    id: 'gpt-5-mini',
    provider: 'OpenAI',
    status: 'ga',
    multiplierPaid: 0,
    multiplierFree: 1,
    plans: { free: true, student: true, pro: true, proPlusAndBusiness: true, enterprise: true },
    taskArea: 'general',
  },
  {
    id: 'gpt-5.1',
    provider: 'OpenAI',
    status: 'retiring',
    retirementDate: '2026-04-15',
    multiplierPaid: 1,
    multiplierFree: null,
    plans: { free: false, student: true, pro: true, proPlusAndBusiness: true, enterprise: true },
    taskArea: 'reasoning',
  },
  {
    id: 'gpt-5.2',
    provider: 'OpenAI',
    status: 'ga',
    multiplierPaid: 1,
    multiplierFree: null,
    plans: { free: false, student: true, pro: true, proPlusAndBusiness: true, enterprise: true },
    taskArea: 'reasoning',
  },
  {
    id: 'gpt-5.2-codex',
    provider: 'OpenAI',
    status: 'ga',
    multiplierPaid: 1,
    multiplierFree: null,
    plans: { free: false, student: true, pro: true, proPlusAndBusiness: true, enterprise: true },
    taskArea: 'agentic',
  },
  {
    id: 'gpt-5.3-codex',
    provider: 'OpenAI',
    status: 'ga',
    multiplierPaid: 1,
    multiplierFree: null,
    plans: { free: false, student: true, pro: true, proPlusAndBusiness: true, enterprise: true },
    taskArea: 'agentic',
  },
  {
    id: 'gpt-5.4',
    provider: 'OpenAI',
    status: 'ga',
    multiplierPaid: 1,
    multiplierFree: null,
    plans: { free: false, student: false, pro: true, proPlusAndBusiness: true, enterprise: true },
    taskArea: 'reasoning',
  },
  {
    id: 'gpt-5.4-mini',
    provider: 'OpenAI',
    status: 'ga',
    multiplierPaid: 0.33,
    multiplierFree: null,
    plans: { free: false, student: true, pro: true, proPlusAndBusiness: true, enterprise: true },
    taskArea: 'agentic',
  },

  {
    id: 'claude-haiku-4.5',
    provider: 'Anthropic',
    status: 'ga',
    multiplierPaid: 0.33,
    multiplierFree: 1,
    plans: { free: true, student: true, pro: true, proPlusAndBusiness: true, enterprise: true },
    taskArea: 'fast',
  },
  {
    id: 'claude-sonnet-4',
    provider: 'Anthropic',
    status: 'ga',
    multiplierPaid: 1,
    multiplierFree: null,
    plans: { free: false, student: false, pro: true, proPlusAndBusiness: true, enterprise: true },
    taskArea: 'reasoning',
  },
  {
    id: 'claude-sonnet-4.5',
    provider: 'Anthropic',
    status: 'ga',
    multiplierPaid: 1,
    multiplierFree: null,
    plans: { free: false, student: false, pro: true, proPlusAndBusiness: true, enterprise: true },
    taskArea: 'general',
  },
  {
    id: 'claude-sonnet-4.6',
    provider: 'Anthropic',
    status: 'ga',
    multiplierPaid: 1,      
    multiplierFree: null,
    plans: { free: false, student: false, pro: true, proPlusAndBusiness: true, enterprise: true },
    taskArea: 'general',
  },
  {
    id: 'claude-opus-4.5',
    provider: 'Anthropic',
    status: 'ga',
    multiplierPaid: 3,
    multiplierFree: null,
    plans: { free: false, student: false, pro: true, proPlusAndBusiness: true, enterprise: true },
    taskArea: 'reasoning',
  },
  {
    id: 'claude-opus-4.6',
    provider: 'Anthropic',
    status: 'ga',
    multiplierPaid: 3,
    multiplierFree: null,
    plans: { free: false, student: false, pro: true, proPlusAndBusiness: true, enterprise: true },
    taskArea: 'reasoning',
  },
  {
    id: 'claude-opus-4.6-fast',
    provider: 'Anthropic',
    status: 'preview',
    multiplierPaid: 30,
    multiplierFree: null,
    plans: { free: false, student: false, pro: false, proPlusAndBusiness: false, enterprise: true },
    taskArea: 'reasoning',
  },

  {
    id: 'gemini-2.5-pro',
    provider: 'Google',
    status: 'ga',
    multiplierPaid: 1,
    multiplierFree: null,
    plans: { free: false, student: true, pro: true, proPlusAndBusiness: true, enterprise: true },
    taskArea: 'reasoning',
  },
  {
    id: 'gemini-3-flash',
    provider: 'Google',
    status: 'preview',
    multiplierPaid: 0.33,
    multiplierFree: null,
    plans: { free: false, student: true, pro: true, proPlusAndBusiness: true, enterprise: true },
    taskArea: 'fast',
  },
  {
    id: 'gemini-3.1-pro',
    provider: 'Google',
    status: 'preview',
    multiplierPaid: 1,
    multiplierFree: null,
    plans: { free: false, student: true, pro: true, proPlusAndBusiness: true, enterprise: true },
    taskArea: 'reasoning',
  },

  {
    id: 'grok-code-fast-1',
    provider: 'xAI',
    status: 'ga',
    multiplierPaid: 0.25,
    multiplierFree: 1,
    plans: { free: true, student: true, pro: true, proPlusAndBusiness: true, enterprise: true },
    taskArea: 'general',
  },

  {
    id: 'raptor-mini',
    provider: 'Fine-tuned GPT-5 mini',
    status: 'preview',
    multiplierPaid: 0,
    multiplierFree: 1,
    plans: { free: true, student: true, pro: true, proPlusAndBusiness: false, enterprise: false },
    taskArea: 'general',
  },
  {
    id: 'goldeneye',
    provider: 'Fine-tuned GPT-5.1-Codex',
    status: 'preview',
    multiplierPaid: null,
    multiplierFree: 1,
    plans: { free: true, student: false, pro: false, proPlusAndBusiness: false, enterprise: false },
    taskArea: 'reasoning',
  },
];

const KNOWN_MODEL_IDS: string[] = COPILOT_MODELS.map(m => m.id);
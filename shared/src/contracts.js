import { z } from 'zod';

export const ROOM_ID = 'main';
export const MIN_PLAYERS = 1;
export const MAX_PLAYERS = 8;
export const TIMER_OPTIONS = Object.freeze([15, 30, 45, 60]);
export const ROUND_OPTIONS = Object.freeze([10, 15, 20, 30, 45, 50]);
export const GAME_MODES = Object.freeze(['classic', 'community']);

export const nicknameSchema = z
  .string()
  .trim()
  .min(2, 'Informe um nome com pelo menos 2 caracteres')
  .max(20, 'O nome deve ter no máximo 20 caracteres')
  .regex(/^[\p{L}\p{N} ._'-]+$/u, 'O nome contém caracteres inválidos');

export const roomSettingsSchema = z
  .object({
    mode: z.enum(GAME_MODES).default('classic'),
    timerSeconds: z.number().int().refine((value) => TIMER_OPTIONS.includes(value), {
      message: 'Duração inválida',
    }),
    roundLimit: z.number().int().refine((value) => ROUND_OPTIONS.includes(value), {
      message: 'Quantidade de rodadas inválida',
    }),
  })
  .strict();

export const sourceSchema = z
  .object({
    label: z.string().trim().min(1).max(120),
    url: z.string().url().max(2048),
  })
  .strict();

export const factSchema = z
  .object({
    id: z.string().trim().min(1).max(100),
    statement: z.string().trim().min(8).max(1000),
    verdict: z.boolean(),
    explanation: z.string().trim().min(8).max(4000),
    correction: z.string().trim().min(1).max(2000).nullable().default(null),
    category: z.string().trim().min(1).max(80),
    difficulty: z.number().int().min(1).max(5),
    tags: z.array(z.string().trim().min(1).max(50)).max(20).default([]),
    sensitivity: z.enum(['general', 'mature_non_graphic']).default('general'),
    sources: z.array(sourceSchema).min(1).max(12),
    verifiedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD'),
    reviewStatus: z.enum(['pending', 'verified', 'archived']).default('pending'),
    active: z.boolean().default(true),
  })
  .strict()
  .superRefine((fact, context) => {
    if (!fact.verdict && !fact.correction) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['correction'],
        message: 'Uma afirmação falsa precisa de correção',
      });
    }
    const needsSecondSource = fact.difficulty >= 4
      || ['corpo-saude', 'historia-politica'].includes(fact.category)
      || fact.tags.some((tag) => /seguran[çc]a/i.test(tag));
    if (needsSecondSource && fact.sources.length < 2) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['sources'],
        message: 'Fatos de nível 4–5 ou sobre saúde, política e segurança precisam de duas fontes',
      });
    }
  });

export const factImportSchema = z.array(factSchema).min(1).max(5000);

export const communityFactSchema = z
  .object({
    statement: z.string().trim().min(8).max(500),
    verdict: z.boolean(),
    explanation: z.string().trim().min(8).max(1500),
    correction: z.string().trim().min(1).max(1000).nullable().default(null),
    category: z.string().trim().min(1).max(80).default('Comunidade'),
    sources: z.array(sourceSchema).max(4).default([]),
  })
  .strict();

export const clientEnvelopeSchema = z
  .object({
    requestId: z.string().trim().min(1).max(100),
    version: z.number().int().nonnegative(),
    gameId: z.string().min(1).max(100).nullable().optional(),
    phaseId: z.string().min(1).max(100).nullable().optional(),
    payload: z.unknown().optional(),
  })
  .strict();

export const joinPayloadSchema = z
  .object({
    nickname: nicknameSchema,
    reconnectToken: z.string().min(20).max(256).optional(),
  })
  .strict();

export const answerPayloadSchema = z
  .object({
    answer: z.boolean(),
    roundId: z.string().min(1).max(100),
  })
  .strict();

export const removePlayerPayloadSchema = z
  .object({ playerId: z.string().uuid() })
  .strict();

export const socketEvents = Object.freeze({
  inbound: Object.freeze({
    JOIN: 'room:join',
    RECONNECT: 'room:resume',
    UPDATE_SETTINGS: 'lobby:configure',
    START: 'game:start',
    LEAVE: 'room:leave',
    REMOVE_STALLED: 'host:removePlayer',
    SUBMIT_COMMUNITY_FACTS: 'community:submit',
    ANSWER: 'round:vote',
    RESTART: 'game:rematch',
    REQUEST_STATE: 'state:request',
  }),
  outbound: Object.freeze({
    SNAPSHOT: 'room:snapshot',
    HOST_CHANGED: 'host:changed',
    PHASE_CHANGED: 'phase:changed',
    COMMUNITY_PROGRESS: 'community:progress',
    ROUND_OPENED: 'round:opened',
    VOTE_STATUS: 'round:voteStatus',
    GAME_FINISHED: 'game:finished',
    ERROR: 'server:error',
  }),
});

export function successAck(requestId, version, data = undefined) {
  return { requestId, ok: true, code: 'OK', version, ...(data === undefined ? {} : { data }) };
}

export function errorAck(requestId, version, code, message, details = undefined) {
  return {
    requestId,
    ok: false,
    code,
    version,
    error: { code, message, ...(details === undefined ? {} : { details }) },
  };
}

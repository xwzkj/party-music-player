import { z } from 'zod'

export const usernameSchema = z.string().regex(/^[A-Za-z0-9_]{3,20}$/, '用户名为 3 到 20 位字母、数字或下划线')
export const passwordSchema = z.string().min(8, '密码至少 8 位').max(64, '密码最多 64 位')
export const nicknameSchema = z.string().trim().min(1, '昵称不能为空').max(16, '昵称最多 16 字')
export const emailSchema = z.string().trim().email('邮箱格式不正确').max(254)
export const emailCodeSchema = z.string().regex(/^\d{6}$/, '验证码为 6 位数字')
export const roomCodeSchema = z.string().regex(/^\d{6}$/, '房间号为 6 位数字')
export const passcodeSchema = z.string().trim().min(4, '口令 4 到 16 位').max(16, '口令 4 到 16 位')
export const idSchema = z.string().min(1).max(64)

export const emailCodeRequestSchema = z.object({
  email: emailSchema,
  turnstileToken: z.string().optional(),
})

export const registerSchema = z.object({
  username: usernameSchema,
  password: passwordSchema,
  email: emailSchema.optional().or(z.literal('').transform(() => undefined)),
  emailCode: emailCodeSchema.optional(),
  turnstileToken: z.string().optional(),
})

export const loginSchema = z.object({
  username: z.string().min(1).max(64),
  password: z.string().min(1).max(64),
})

export const resetRequestSchema = z.object({
  account: z.string().trim().min(1).max(254),
  turnstileToken: z.string().optional(),
})

export const resetConfirmSchema = z.object({
  account: z.string().trim().min(1).max(254),
  code: emailCodeSchema,
  password: passwordSchema,
})

export const patchMeSchema = z.object({ nickname: nicknameSchema })
export const changePasswordSchema = z.object({
  oldPassword: z.string().min(1).max(64),
  newPassword: passwordSchema,
})
export const changeEmailSchema = z.object({ email: emailSchema, code: emailCodeSchema.optional() })
export const changeUsernameSchema = z.object({ username: usernameSchema })

export const adminCreateUserSchema = z.object({
  username: usernameSchema,
  password: passwordSchema,
  nickname: nicknameSchema.optional(),
  canCreateRoom: z.boolean().optional(),
})
export const adminPatchUserSchema = z.object({
  nickname: nicknameSchema.optional(),
  canCreateRoom: z.boolean().optional(),
  password: passwordSchema.optional(),
  email: emailSchema.nullable().optional(),
})
export const adminSettingsSchema = z.object({
  emailVerificationEnabled: z.boolean().optional(),
  turnstileEnabled: z.boolean().optional(),
})
export const testEmailSchema = z.object({ to: emailSchema })

export const createRoomSchema = z.object({
  passcode: passcodeSchema.optional().or(z.literal('').transform(() => undefined)),
})
export const joinRoomSchema = z.object({ passcode: z.string().min(1).max(16) })
export const playUrlSchema = z.object({ itemId: idSchema })

export const searchQuerySchema = z.object({
  type: z.enum(['track', 'playlist']).default('track'),
  q: z.string().trim().min(1).max(100),
  page: z.coerce.number().int().min(1).max(50).default(1),
})
export const resolvePlaylistSchema = z.object({ link: z.string().trim().min(1).max(500) })

const weightSchema = z.number().min(0).max(100)
export const roomSettingsPatchSchema = z
  .object({
    quotaPerMember: z.number().int().min(1).max(200).nullable(),
    voteMode: z.enum(['anyone', 'half', 'all']),
    weights: z.object({
      vote: weightSchema,
      adds: weightSchema,
      order: weightSchema,
      popularity: weightSchema,
      duration: weightSchema,
    }),
    memberAudioDefault: z.boolean(),
    allowTrialTracks: z.boolean(),
    audioLevel: z.enum(['standard', 'exhigh', 'lossless']),
    fallbackPlaylistId: z.string().regex(/^\d{1,20}$/).nullable(),
  })
  .partial()

export const socketSchemas = {
  'room:enter': z.object({ code: roomCodeSchema }),
  'room:leave': z.object({ code: roomCodeSchema }),
  'queue:add': z.object({ sourceId: z.string().regex(/^\d{1,20}$/) }),
  'queue:withdraw': z.object({ itemId: idSchema }),
  'vote:set': z.object({ itemId: idSchema, vote: z.union([z.literal(1), z.literal(-1), z.literal(0)]) }),
  'play:vote': z.object({ kind: z.enum(['skip', 'prev', 'pause', 'resume']), itemId: idSchema, on: z.boolean() }),
  'audio:listening': z.object({ on: z.boolean() }),
  'audio:error': z.object({ itemId: idSchema }),
  'time:ping': z.object({ t0: z.number() }),
  'chat:send': z.object({ content: z.string().max(400) }),
  'host:playback': z.object({
    action: z.enum(['pause', 'resume', 'next', 'prev', 'seek']),
    positionMs: z.number().min(0).optional(),
  }),
  'host:queue': z.object({ action: z.enum(['remove', 'pin', 'unpin', 'setNext']), itemId: idSchema }),
  'host:settings': roomSettingsPatchSchema,
  'host:kick': z.object({ userId: idSchema, ban: z.boolean() }),
  'host:unban': z.object({ userId: idSchema }),
  'host:chatDelete': z.object({ messageId: idSchema }),
  'host:resetPasscode': z.object({}).passthrough(),
  'host:close': z.object({}).passthrough(),
} as const

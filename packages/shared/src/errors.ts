export const ErrorCode = {
  // 账号
  UNAUTHORIZED: 'UNAUTHORIZED',
  BAD_CREDENTIALS: 'BAD_CREDENTIALS',
  ACCOUNT_LOCKED: 'ACCOUNT_LOCKED',
  MUST_CHANGE_PASSWORD: 'MUST_CHANGE_PASSWORD',
  USERNAME_TAKEN: 'USERNAME_TAKEN',
  EMAIL_CODE_INVALID: 'EMAIL_CODE_INVALID',
  TURNSTILE_FAILED: 'TURNSTILE_FAILED',
  // 权限
  FORBIDDEN: 'FORBIDDEN',
  ROOM_LIMIT_REACHED: 'ROOM_LIMIT_REACHED',
  // 房间
  ROOM_NOT_FOUND: 'ROOM_NOT_FOUND',
  ROOM_CLOSED: 'ROOM_CLOSED',
  BAD_PASSCODE: 'BAD_PASSCODE',
  JOIN_PAUSED: 'JOIN_PAUSED',
  BANNED: 'BANNED',
  // 队列与投票
  QUOTA_EXCEEDED: 'QUOTA_EXCEEDED',
  TRACK_UNAVAILABLE: 'TRACK_UNAVAILABLE',
  TRACK_TRIAL_ONLY: 'TRACK_TRIAL_ONLY',
  ALREADY_PLAYING: 'ALREADY_PLAYING',
  CANNOT_VOTE_OWN: 'CANNOT_VOTE_OWN',
  STALE_ITEM: 'STALE_ITEM',
  VOTE_NOT_OPEN: 'VOTE_NOT_OPEN',
  VOTE_COOLDOWN: 'VOTE_COOLDOWN',
  NO_HISTORY: 'NO_HISTORY',
  QUEUE_FULL: 'QUEUE_FULL',
  ROOM_FULL: 'ROOM_FULL',
  // 其他
  CHAT_RATE_LIMITED: 'CHAT_RATE_LIMITED',
  RATE_LIMITED: 'RATE_LIMITED',
  NETEASE_ERROR: 'NETEASE_ERROR',
  NETEASE_NOT_BOUND: 'NETEASE_NOT_BOUND',
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  FEATURE_DISABLED: 'FEATURE_DISABLED',
  NOT_FOUND: 'NOT_FOUND',
  INTERNAL: 'INTERNAL',
} as const

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode]

export const errorMessages: Record<ErrorCode, string> = {
  UNAUTHORIZED: '请先登录',
  BAD_CREDENTIALS: '用户名或密码错误',
  ACCOUNT_LOCKED: '失败次数过多，账号已锁定 15 分钟',
  MUST_CHANGE_PASSWORD: '请先修改初始密码',
  USERNAME_TAKEN: '用户名已被占用',
  EMAIL_CODE_INVALID: '验证码错误或已过期',
  TURNSTILE_FAILED: '人机验证失败，请重试',
  FORBIDDEN: '没有权限',
  ROOM_LIMIT_REACHED: '你已经有一个开放的房间',
  ROOM_NOT_FOUND: '房间不存在',
  ROOM_CLOSED: '房间已关闭',
  BAD_PASSCODE: '口令错误',
  JOIN_PAUSED: '尝试次数过多，房间暂停加入 2 分钟',
  BANNED: '你已被禁止进入这个房间',
  QUOTA_EXCEEDED: '点歌名额已用完',
  TRACK_UNAVAILABLE: '这首歌无法播放',
  TRACK_TRIAL_ONLY: '这首歌只能试听，房间不允许点试听歌曲',
  ALREADY_PLAYING: '这首歌正在播放',
  CANNOT_VOTE_OWN: '不能给自己点的歌投票',
  STALE_ITEM: '歌曲已经变了，请重试',
  VOTE_NOT_OPEN: '当前状态下不能发起这个投票',
  VOTE_COOLDOWN: '操作太频繁，请稍后再试',
  NO_HISTORY: '没有可以重播的歌',
  QUEUE_FULL: '队列已满',
  ROOM_FULL: '房间人数已满',
  CHAT_RATE_LIMITED: '发言太快了，请稍后再试',
  RATE_LIMITED: '请求太频繁，请稍后再试',
  NETEASE_ERROR: '网易云接口出错',
  NETEASE_NOT_BOUND: '还没有绑定网易云账号',
  VALIDATION_FAILED: '输入不合法',
  FEATURE_DISABLED: '该功能未开启',
  NOT_FOUND: '不存在',
  INTERNAL: '服务器内部错误',
}

export class AppError extends Error {
  readonly code: ErrorCode
  readonly status: number
  constructor(code: ErrorCode, status = 400, message?: string) {
    super(message ?? errorMessages[code])
    this.code = code
    this.status = status
  }
}

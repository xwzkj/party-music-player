import bcrypt from 'bcryptjs'
import { config } from '../config.ts'

export const hashPassword = (pw: string): Promise<string> => bcrypt.hash(pw, config.bcryptCost)
export const verifyPassword = (pw: string, hash: string): Promise<boolean> => bcrypt.compare(pw, hash)

/** 用户不存在时也做一次比较，避免通过响应时间判断账号是否存在 */
let dummyHash: string | null = null
export async function dummyVerify(pw: string): Promise<void> {
  dummyHash ??= await bcrypt.hash('dummy-password', config.bcryptCost)
  await bcrypt.compare(pw, dummyHash)
}

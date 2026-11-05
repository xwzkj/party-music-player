// 必须在任何 src 模块之前导入：config 在导入时读取环境变量
process.env.MUSIC_PROVIDER = 'fake'
process.env.BCRYPT_COST = '4'
process.env.LOG_LEVEL = 'silent'
process.env.REVERSE_VOTE_COOLDOWN_MS = '300'
process.env.NO_LISTENER_PAUSE_MS = '60000'

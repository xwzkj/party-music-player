import { defineStore } from 'pinia'
import { computed, ref, shallowRef } from 'vue'
import type { ChatMessage, PlayVoteKind, RoomSnapshot } from '@pmp/shared'
import { get } from '../api/http'
import { AudioEngine } from '../player/AudioEngine'
import { emit, getSocket, serverNow, startClockSync, stopClockSync } from '../realtime/socket'
import { toast, toastError } from '../ui'
import { usePrefs } from './prefs'

export const useRoom = defineStore('room', () => {
  const code = ref<string | null>(null)
  const snap = shallowRef<RoomSnapshot | null>(null)
  const chats = ref<ChatMessage[]>([])
  const connected = ref(false)
  const listening = ref(false)
  /** 刷新页面后需要再点一次才能出声 */
  const needsUnlock = ref(false)
  const closedReason = ref<string | null>(null)
  const hostQr = ref<{ fromNickname: string; qrImage: string } | null>(null)
  const optimisticVotes = ref<Record<string, 1 | -1 | 0>>({})
  let engine: AudioEngine | null = null
  let localVersion = 0
  let entered = false

  const isHost = computed(() => !!snap.value?.me.isHost)
  const presentCount = computed(() => snap.value?.members.filter((m) => m.present).length ?? 0)

  function onState(s: RoomSnapshot): void {
    if (s.version <= localVersion && snap.value) return
    localVersion = s.version
    snap.value = s
    optimisticVotes.value = {}
    engine?.update(s.timeline, s.upNext?.id ?? null)
  }

  function bindSocket(): void {
    const s = getSocket()
    s.off('room:state').on('room:state', onState)
    s.off('chat:message').on('chat:message', (m) => {
      if (!chats.value.some((c) => c.id === m.id)) chats.value.push(m)
      if (chats.value.length > 500) chats.value.splice(0, chats.value.length - 500)
    })
    s.off('chat:deleted').on('chat:deleted', ({ messageId }) => {
      chats.value = chats.value.filter((c) => c.id !== messageId)
    })
    s.off('room:notice').on('room:notice', (n) => toast(n.text))
    s.off('room:closed').on('room:closed', () => {
      closedReason.value = '房间已关闭'
      teardown()
    })
    s.off('member:kicked').on('member:kicked', (p) => {
      closedReason.value = p.banned ? '你已被移出房间，并且不能再进入' : '你已被移出房间'
      teardown()
    })
    s.off('netease:loginQr').on('netease:loginQr', (p) => {
      hostQr.value = { fromNickname: p.fromNickname, qrImage: p.qrImage }
    })
    s.off('connect').on('connect', () => {
      connected.value = true
      // 服务端重启后版本号会从头开始
      localVersion = 0
      if (entered && code.value) void enter()
    })
    s.off('disconnect').on('disconnect', () => {
      connected.value = false
    })
  }

  async function enter(): Promise<void> {
    if (!code.value) return
    try {
      await emit('room:enter', { code: code.value })
      if (listening.value) await emit('audio:listening', { on: true })
    } catch (e) {
      toastError(e)
      closedReason.value = (e as Error).message
    }
  }

  async function open(roomCode: string): Promise<void> {
    if (code.value === roomCode && entered) return
    teardown()
    code.value = roomCode
    closedReason.value = null
    entered = true
    const prefs = usePrefs()
    engine = new AudioEngine(roomCode, {
      onError: (itemId) => void emit('audio:error', { itemId }).catch(() => {}),
    })
    engine.setVolume(prefs.volume)
    bindSocket()
    const s = getSocket()
    if (s.connected) {
      connected.value = true
      await enter()
    } else {
      s.connect()
    }
    startClockSync()
    document.addEventListener('visibilitychange', onVisible)
    try {
      chats.value = await get<ChatMessage[]>(`/rooms/${roomCode}/chat`)
    } catch {
      /* ignore */
    }
  }

  async function loadOlderChats(): Promise<number> {
    if (!code.value || !chats.value.length) return 0
    const older = await get<ChatMessage[]>(`/rooms/${code.value}/chat?before=${chats.value[0].createdAt}`)
    chats.value = [...older, ...chats.value]
    return older.length
  }

  /** 进房间后决定本机是否出声：本机选择优先，否则用默认值 */
  function initialListening(): boolean {
    if (!code.value || !snap.value) return false
    const choice = usePrefs().listeningChoice(code.value)
    return choice ?? snap.value.me.listeningDefault
  }

  async function setListening(on: boolean): Promise<void> {
    if (!engine || !code.value) return
    if (on && !engine.unlocked) {
      const ok = await engine.unlock()
      if (!ok) {
        toast('浏览器阻止了播放，请再点一次')
        return
      }
    }
    needsUnlock.value = false
    listening.value = on
    usePrefs().setListeningChoice(code.value, on)
    engine.setListening(on)
    try {
      await emit('audio:listening', { on })
    } catch (e) {
      toastError(e)
    }
  }

  function setVolume(v: number): void {
    usePrefs().volume = v
    engine?.setVolume(v)
  }

  function onVisible(): void {
    if (document.visibilityState !== 'visible') return
    const s = getSocket()
    if (!s.connected) s.connect()
    else void enter()
  }

  function teardown(): void {
    entered = false
    engine?.destroy()
    engine = null
    listening.value = false
    needsUnlock.value = false
    snap.value = null
    localVersion = 0
    stopClockSync()
    document.removeEventListener('visibilitychange', onVisible)
  }

  async function leave(): Promise<void> {
    if (code.value) {
      try {
        await emit('room:leave', { code: code.value })
      } catch {
        /* ignore */
      }
    }
    teardown()
    code.value = null
    chats.value = []
  }

  /** 离开页面但不算主动离开（例如回到首页） */
  function detach(): void {
    if (listening.value) void emit('audio:listening', { on: false }).catch(() => {})
    teardown()
    code.value = null
    chats.value = []
    getSocket().disconnect()
  }

  // ---------- 操作 ----------

  async function act<T>(event: Parameters<typeof emit>[0], payload: unknown): Promise<T | undefined> {
    try {
      return await emit<T>(event, payload)
    } catch (e) {
      toastError(e)
      return undefined
    }
  }

  async function vote(itemId: string, v: 1 | -1 | 0): Promise<void> {
    optimisticVotes.value = { ...optimisticVotes.value, [itemId]: v }
    try {
      await emit('vote:set', { itemId, vote: v })
    } catch (e) {
      const next = { ...optimisticVotes.value }
      delete next[itemId]
      optimisticVotes.value = next
      toastError(e)
    }
  }

  async function playVote(kind: PlayVoteKind): Promise<void> {
    const np = snap.value?.nowPlaying
    if (!np) return
    const mine = np.votes[kind].mine
    const r = await act<{ passed: boolean }>('play:vote', { kind, itemId: np.item.id, on: !mine })
    if (r?.passed) toast({ skip: '切歌成功', prev: '已重播上一首', pause: '已暂停', resume: '继续播放' }[kind])
  }

  function positionMs(): number {
    const t = snap.value?.timeline
    if (!t) return 0
    if (t.state === 'playing') return Math.max(0, Math.min(t.durationMs, serverNow() - t.startedAt))
    if (t.state === 'paused') return t.pausedAtMs
    return 0
  }

  return {
    code,
    snap,
    chats,
    connected,
    listening,
    needsUnlock,
    closedReason,
    hostQr,
    optimisticVotes,
    isHost,
    presentCount,
    open,
    leave,
    detach,
    initialListening,
    setListening,
    setVolume,
    loadOlderChats,
    act,
    vote,
    playVote,
    positionMs,
  }
})

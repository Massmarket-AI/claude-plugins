// (0.7.70) Alerts: one notification when a thread is pinned for the person, one quiet sound when a pin needs them or a reply package of
// theirs lands, and nothing else (Rob, 2026-11-24, the approved Phase 2 plan: alert only when someone has to act). The bridge against a
// pretend desktop app, feed and store (register-world.test-helper.ts); every client is made up.

import type { On } from 'claude-code'
import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { AlertDue, Alerted, NewPin } from './alerts'
import { ALERTS_DUE, ALERT_CHARS, ALERT_GAP_MS, ALERT_MAX, ALERT_TITLE, DUE_MAX_MS, HANDOFF_MS, PIN_KEEP_MS, SOUND_ASSET, SOUND_GAIN, alertedOf, alertsOn, claimDue, cutAlert, moreAlertText, pinAlertText, pinSig, planAlerts, waitingAlertText, waitingSig } from './alerts'
import type { Feed } from './queue'
import { ALERTS_OFF_SAID, ALERTS_ON_SAID } from './register'
import type { WorldOptions } from './register-world.test-helper'
import { NOW, HOUR, LONG, ACME, BOLT, PAIRS, SELF, thread, feed, world, mm, tool, tickOnce } from './register-world.test-helper'

const pin = (pid: string, sig: string, text = `Pinned for you: ${pid}`): NewPin => ({ pid, sid: `local_${pid}`, client: pid, sig, text })
const record = (over: Partial<Alerted> = {}): Alerted => ({ pins: {}, packages: [], at: NOW - 60_000, ...over })
const loud = { now: NOW, quiet: false, on: true }

describe('0.7.70: what one pass alerts for (planAlerts)', () => {
  test('a computer\'s first pass alerts nothing and only records', () => {
    const plan = planAlerts(null, { ...loud, pins: [pin(BOLT, 'reply:1')], ready: ['p1'] })
    expect(plan.notify).toEqual([])
    expect(plan.sound).toBe(false)
    expect(plan.next).toEqual({ pins: { [BOLT]: { sig: 'reply:1', at: NOW } }, packages: ['p1'], at: NOW })
  })

  test('a new pin notifies once and sounds; the same client for the same thing again is a re-pin, and silent', () => {
    const first = planAlerts(record(), { ...loud, pins: [pin(BOLT, 'reply:1')], ready: [] })
    expect(first.notify.map(p => p.pid)).toEqual([BOLT])
    expect(first.sound).toBe(true)
    const again = planAlerts(first.next, { ...loud, now: NOW + HOUR, pins: [pin(BOLT, 'reply:1')], ready: [] })
    expect(again.notify).toEqual([])
    expect(again.sound).toBe(false)
    // something new of the same client's is a new pin
    const next = planAlerts(again.next, { ...loud, now: NOW + 2 * HOUR, pins: [pin(BOLT, 'reply:2')], ready: [] })
    expect(next.notify.map(p => p.sig)).toEqual(['reply:2'])
  })

  test('a quiet pass (after a gap) and a computer with alerts off record and alert nothing', () => {
    for (const o of [{ quiet: true, on: true }, { quiet: false, on: false }]) {
      const plan = planAlerts(record(), { now: NOW, ...o, pins: [pin(BOLT, 'reply:1')], ready: ['p1'] })
      expect(plan.notify).toEqual([])
      expect(plan.sound).toBe(false)
      expect(plan.next.pins[BOLT]?.sig).toBe('reply:1')
      expect(plan.next.packages).toEqual(['p1'])
    }
  })

  test(`at most ${ALERT_MAX} notifications a pass, and one line for the rest`, () => {
    const pins = Array.from({ length: ALERT_MAX + 3 }, (_, n) => pin(`p${n}`, 'task:1'))
    const plan = planAlerts(record(), { ...loud, pins, ready: [] })
    expect(plan.notify).toHaveLength(ALERT_MAX)
    expect(plan.more).toBe(3)
    expect(moreAlertText(3)).toBe('3 more threads are pinned for you.')
    expect(moreAlertText(1)).toBe('1 more thread is pinned for you.')
    // one client twice in one pass: once
    expect(planAlerts(record(), { ...loud, pins: [pin(BOLT, 'a'), pin(BOLT, 'b')], ready: [] }).notify).toHaveLength(1)
  })

  test('a reply package landing sounds with no notification; one seen before never sounds again', () => {
    const plan = planAlerts(record({ packages: ['p0'] }), { ...loud, pins: [], ready: ['p0', 'p1'] })
    expect(plan.notify).toEqual([])
    expect(plan.sound).toBe(true)
    expect(plan.next.packages).toEqual(['p0', 'p1'])
    // it leaves the ready list and comes back: seen, so silent
    const gone = planAlerts(plan.next, { ...loud, pins: [], ready: [] })
    expect(gone.sound).toBe(false)
    expect(planAlerts(gone.next, { ...loud, pins: [], ready: ['p1'] }).sound).toBe(false)
  })

  test('a pin\'s record goes after two weeks; a damaged record reads as none', () => {
    const old = record({ pins: { [BOLT]: { sig: 'reply:1', at: NOW - PIN_KEEP_MS - 1 } } })
    expect(planAlerts(old, { ...loud, pins: [], ready: [] }).next.pins).toEqual({})
    expect(alertedOf({ pins: { [BOLT]: { sig: 'x', at: 1 }, bad: { sig: 2 } }, packages: ['a', 3], at: 5 })).toEqual({ pins: { [BOLT]: { sig: 'x', at: 1 } }, packages: ['a'], at: 5 })
    for (const bad of [null, [], { pins: [], packages: [], at: 1 }, { pins: {}, packages: {}, at: 1 }, { pins: {}, packages: [] }]) expect(alertedOf(bad)).toBeNull()
  })

  test('the switch is on unless turned off; the words stay under 200 characters, one line', () => {
    expect(alertsOn(undefined)).toBe(true)
    expect(alertsOn({ on: true })).toBe(true)
    expect(alertsOn({ on: false })).toBe(false)
    const long = waitingAlertText('🟡 Acme Roofing · waiting on you', `${'Schedule the follow-ups '.repeat(20)}?`)
    expect([...long].length).toBeLessThan(ALERT_CHARS)
    expect(long.endsWith('…')).toBe(true)
    expect(cutAlert('a\nb\tc')).toBe('a b c')
    expect(pinAlertText('🟡 22h left · Bolt Staffing · reply · 2 new')).toBe('Pinned for you: 🟡 22h left · Bolt Staffing · reply · 2 new')
    expect(pinSig('reply', NOW)).toBe(`reply:${NOW}`)
    expect(pinSig('task', Infinity)).toBe('task:none')
    expect(waitingSig('send', 5)).toBe('waiting:send:5')
  })
})

describe('0.7.70: each notification is raised from its pinned thread (claimDue)', () => {
  const due = (at: number, text = 'Pinned for you: x'): AlertDue => ({ text, key: 'pin:x', at })
  test('a thread takes its own at once and leaves the others for theirs', () => {
    const { mine, keep } = claimDue({ local_a: due(NOW, 'a'), local_b: due(NOW, 'b') }, 'local_a', NOW + 1_000)
    expect(mine.map(a => a.text)).toEqual(['a'])
    expect(Object.keys(keep)).toEqual(['local_b'])
  })
  test(`one nobody took ${HANDOFF_MS / 1000} s after it was handed over: any thread takes it; past ${DUE_MAX_MS / 60_000} minutes it goes unraised`, () => {
    const { mine, keep } = claimDue({ local_b: due(NOW - HANDOFF_MS - 1, 'late'), local_c: due(NOW - DUE_MAX_MS - 1, 'stale'), local_d: due(NOW - HANDOFF_MS, 'on time') }, 'local_a', NOW)
    expect(mine.map(a => a.text)).toEqual(['late'])
    expect(Object.keys(keep)).toEqual(['local_d'])
  })
  test('a thread that does not know its id yet takes only the late ones; a damaged entry goes', () => {
    const { mine, keep } = claimDue({ local_a: due(NOW), bad: { text: 5 } as never, worse: null as never }, '', NOW)
    expect(mine).toEqual([])
    expect(keep).toEqual({ local_a: due(NOW) })
  })
})

// ======================================================================== the bridge itself

/** What the engine was asked to raise and to play, as its own `ui.notify` and `audio.play` answer. */
function heard(on: On) {
  const notes: Array<{ text: string; title?: string; key?: string }> = []
  const plays: Array<{ clip: unknown; gain?: number }> = []
  on('ui.notify', (_$, e) => {
    notes.push({ text: e.text, ...(e.title !== undefined ? { title: e.title } : {}), ...(e.key !== undefined ? { key: e.key } : {}) })
    return { value: { isSent: true as const, channel: 'client' as const } }
  })
  on('audio.play', (_$, e) => {
    plays.push({ clip: e.clip, ...(e.gain !== undefined ? { gain: e.gain } : {}) })
    return { value: undefined }
  })
  return { notes, plays }
}

/** Nothing on the feed: every client clear. */
const clear = (): Feed => feed({ drafts: [], mail: [], tickets: {} })
/** Bolt's two client messages, its reply due within 24 business hours: its thread pins. */
const boltDue = (): Feed => feed({ drafts: [], tickets: {} })
/** Bolt's thread is this one, linked by the person: the thread that syncs is the one it pins, so it raises the notification at once. */
const boltWorld = (on: On, over: WorldOptions = {}) =>
  world(on, { feed: clear(), self: thread(SELF, 'Staffing plan', 0), ...over, store: { 'mm.threads': PAIRS, 'mm.links': { [BOLT]: SELF }, ...(over.store ?? {}) } })
const minute = async (w: { clock: { advance: (ms: number) => Promise<void> } }) => w.clock.advance(60_000)
const pinned = (w: ReturnType<typeof world>, sid = SELF) => w.threads.get(sid)?.pinned === true

describe('0.7.70: a new pin for the person raises one notification and the sound, and nothing else does', () => {
  test('the first sync alerts nothing; a pin after it: one notification naming the client and what is due, keyed by client, and one sound', async ($, on) => {
    const w = boltWorld(on)
    const { notes, plays } = heard(on)
    await mm($, '')
    expect(w.stored['mm.alerted']).toEqual({ pins: {}, packages: [], at: NOW })
    w.setFeed(boltDue())
    await minute(w)
    await mm($, '')
    expect(pinned(w)).toBe(true)
    const title = String(w.threads.get(SELF)?.title)
    expect(title).toContain('Bolt Staffing')
    expect(notes).toEqual([{ text: `Pinned for you: ${title}`, title: ALERT_TITLE, key: `pin:${BOLT}` }])
    expect([...(notes[0]?.text ?? '')].length).toBeLessThan(200)
    expect(plays).toEqual([{ clip: { asset: SOUND_ASSET }, gain: SOUND_GAIN }])
    // still pinned, sync after sync: nothing more
    await minute(w)
    await mm($, '')
    expect(notes).toHaveLength(1)
    expect(plays).toHaveLength(1)
  })

  test('nothing on an unpin, and nothing when the same thing pins it again', async ($, on) => {
    const w = boltWorld(on)
    const { notes, plays } = heard(on)
    await mm($, '')
    w.setFeed(boltDue())
    await minute(w)
    await mm($, '')
    expect(notes).toHaveLength(1)
    // the reply goes: the bridge takes its own pin off
    w.setFeed(clear())
    await minute(w)
    await mm($, '')
    expect(pinned(w)).toBe(false)
    // and the same messages are back: pinned again for the same thing
    w.setFeed(boltDue())
    await minute(w)
    await mm($, '')
    expect(pinned(w)).toBe(true)
    expect(notes).toHaveLength(1)
    expect(plays).toHaveLength(1)
  })

  test('a thread the person already pinned is not pinned by the bridge, so nothing', async ($, on) => {
    const w = boltWorld(on)
    const { notes, plays } = heard(on)
    await mm($, '')
    const t = w.threads.get(SELF)
    if (t) t.pinned = true
    w.setFeed(boltDue())
    await minute(w)
    await mm($, '')
    expect(pinned(w)).toBe(true)
    expect(w.writes().filter(x => x.startsWith('set_pinned'))).toEqual([])
    expect(notes).toEqual([])
    expect(plays).toEqual([])
  })

  test('threads already pinned when the bridge starts: nothing, though they need the person', async ($, on) => {
    const w = boltWorld(on, { feed: boltDue(), self: thread(SELF, 'Staffing plan', 0, { pinned: true }) })
    const { notes, plays } = heard(on)
    await mm($, '')
    await minute(w)
    await mm($, '')
    expect(pinned(w)).toBe(true)
    expect(notes).toEqual([])
    expect(plays).toEqual([])
  })

  test('after a gap of more than 20 minutes (the computer asleep), the first sync pins quietly', async ($, on) => {
    const w = boltWorld(on)
    const { notes, plays } = heard(on)
    await mm($, '')
    await w.clock.advance(ALERT_GAP_MS + 60_000)
    w.setFeed(boltDue())
    await mm($, '')
    expect(pinned(w)).toBe(true)
    expect(notes).toEqual([])
    expect(plays).toEqual([])
    expect((w.stored['mm.alerted'] as Alerted).pins[BOLT]?.sig).toMatch(/^reply:\d+$/)
  })

  test('/mm alerts says the switch and sets it, per computer: off, a pin raises nothing; on again, what was pinned meanwhile stays quiet', async ($, on) => {
    const w = boltWorld(on)
    const { notes, plays } = heard(on)
    expect(await mm($, 'alerts')).toBe('Alerts are on on this computer. Type /mm alerts on or /mm alerts off.')
    expect(await mm($, 'alerts off')).toBe(ALERTS_OFF_SAID)
    expect(w.stored['mm.alerts']).toEqual({ on: false })
    expect(await mm($, 'alerts')).toBe('Alerts are off on this computer. Type /mm alerts on or /mm alerts off.')
    expect(await mm($, 'status')).toContain('\nalerts (a notification for a new pin, a sound for a pin or a package): off\nauto-update: on\n')
    await mm($, '')
    w.setFeed(boltDue())
    await minute(w)
    await mm($, '')
    expect(pinned(w)).toBe(true)
    expect(notes).toEqual([])
    expect(plays).toEqual([])
    expect(await mm($, 'alerts on')).toBe(ALERTS_ON_SAID)
    await minute(w)
    await mm($, '')
    expect(notes).toEqual([])
    expect(plays).toEqual([])
    // Claude can set it through the tool, as /mm rc
    expect(await tool($, 'alerts off')).toBe(ALERTS_OFF_SAID)
  })

  test(`a pin of another thread's: the sound now, the notification left for that thread; it is not running here, so this one raises it once after ${HANDOFF_MS / 1000} s`, LONG, async ($, on) => {
    const w = world(on, { feed: clear(), threads: [thread('local_b', 'Staffing plan', 20)], store: { 'mm.threads': PAIRS, 'mm.links': { [BOLT]: 'local_b' } } })
    const { notes, plays } = heard(on)
    await tickOnce($, w)
    w.setFeed(boltDue())
    await minute(w)
    await mm($, '')
    expect(pinned(w, 'local_b')).toBe(true)
    expect(plays).toHaveLength(1)
    expect(notes).toEqual([])
    const title = String(w.threads.get('local_b')?.title)
    expect((w.stored[ALERTS_DUE] as Record<string, AlertDue>).local_b?.text).toBe(`Pinned for you: ${title}`)
    // within the hand-off time this thread leaves it for local_b
    await minute(w)
    expect(notes).toEqual([])
    await minute(w)
    expect(notes).toEqual([{ text: `Pinned for you: ${title}`, title: ALERT_TITLE, key: `pin:${BOLT}` }])
    expect(w.stored[ALERTS_DUE]).toEqual({})
    await minute(w)
    await minute(w)
    expect(notes).toHaveLength(1)
    expect(plays).toHaveLength(1)
  })

  test('a reply package of the person\'s landing plays the sound, with no notification', async ($, on) => {
    const w = world(on, { feed: clear() })
    const { notes, plays } = heard(on)
    await mm($, '')
    w.setFeed(feed({ mail: [], tickets: {} }))
    await minute(w)
    await mm($, '')
    expect(notes).toEqual([])
    expect(plays).toEqual([{ clip: { asset: SOUND_ASSET }, gain: SOUND_GAIN }])
    await minute(w)
    await mm($, '')
    expect(plays).toHaveLength(1)
  })

  test('a thread that says it waits on the person: one notification with its question', LONG, async ($, on) => {
    const ASK = 'Schedule the four follow-ups as printed?'
    const w = world(on, { feed: feed({ drafts: [], mail: [], tickets: {}, projects: [{ project_id: ACME, name: 'Acme Roofing — Pat' }] } as Partial<Feed>), store: { 'mm.links': { [ACME]: SELF } } })
    const { notes, plays } = heard(on)
    await tickOnce($, w)
    expect(notes).toEqual([])
    await tool($, `waiting send -- ${ASK}`)
    await w.clock.advance(2_000)
    expect(pinned(w, SELF)).toBe(true)
    expect(notes).toEqual([{ text: `Pinned for you: 🟡 Acme Roofing · waiting on you: "${ASK}"`, title: ALERT_TITLE, key: `pin:${ACME}` }])
    expect(plays).toHaveLength(1)
  })

  test('an unattended run (MM_UNATTENDED=1) never alerts', async ($, on) => {
    const w = boltWorld(on, { env: { CLAUDE_CODE_ENTRYPOINT: 'claude-desktop', HOME: '/home/someone', MM_UNATTENDED: '1' } })
    const { notes, plays } = heard(on)
    await mm($, '')
    w.setFeed(boltDue())
    await minute(w)
    await mm($, '')
    expect(pinned(w)).toBe(true)
    expect(notes).toEqual([])
    expect(plays).toEqual([])
  })

  test('a notification or a sound the engine refuses is let go: the pin and the record stand', async ($: Engine, on) => {
    const w = boltWorld(on)
    on('ui.notify', () => {
      throw new Error('no channel here')
    })
    on('audio.play', () => {
      throw new Error('no player here')
    })
    await mm($, '')
    w.setFeed(boltDue())
    await minute(w)
    await mm($, '')
    expect(pinned(w)).toBe(true)
    expect((w.stored['mm.alerted'] as Alerted).pins[BOLT]).toBeDefined()
  })
})

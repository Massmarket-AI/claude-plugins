/**
 * (0.7.72) The "You" section's client rows, and the band's "next": one row per client that needs the person, saying what is needed
 * from them (the item's own ask, never "open the thread"), by when (business days), why it is pinned and whether it is. Rob,
 * 2026-11-24: "It should be an expansion of the U column that's always visible that we're working on, but have detail on all the
 * clients: needed by that team member, what's needed from them, by what deadline, why it's pinned." It replaces Needs you now.
 * ⛔ Read-only and pure: it works rows out of the sync's items, and never sends, pins or unpins anything.
 *
 * Where each row's ask comes from (`YouSource`), first that applies:
 *   noreply  the package says no reply is owed                     "close Acme's package: no reply is owed"
 *   draft    a draft the person holds and has not sent             "send your draft to Zach (2 left)"
 *   package  a reply package ready for the person's go             "approve the reply to Zach about "Invite failures""
 *   ok       (the founder) a package that waits on his OK          "give your OK on the reply to Zach (Asif sends it)"
 *   mail     a client message with no package yet                  "answer Zach about "Invite failures""
 *   ask      a teammate's internal ask                             "answer Asif's ask: "Can we move the call?""
 *   eta      a ticket of theirs that owes an ETA                   "give an ETA for "Inbound lead router""
 *   owner    a ticket of theirs to give an owner                   "assign an owner to "Inbound lead router""
 *   go       follow-up steps that wait for their go                "give your go on 3 follow-ups (first text Fri Nov 6)"
 *   task     a dated ticket of theirs                              "deliver "Inbound lead router"", "start "…"" past its start-by
 *   pace     quoted work at a pace they hold                       "catch up on the quoted work (behind)"
 *   queue    the internal queue's top ticket                       "next in your build queue: "Fix the inbound router""
 *   none     nothing on the item names a specific ask (reported)   what the row's own line says
 */

import type { QueueItem } from './queue'
import {
  assignAsksOf,
  clientDueOf,
  clockAndDue,
  clockLead,
  clockText,
  cleanName,
  cleanText,
  committedCount,
  dueWhen,
  etaAsksOf,
  goFirstText,
  goOf,
  internalBehindAt,
  leadDueOf,
  noReplyNow,
  openAsks,
  ownPins,
  paceOf,
  paceWord,
  pinsFor,
  queuedOf,
  senderName,
  shownDue,
} from './queue'
import type { RowPin } from './threads'
import { packageReady, rowPinWords } from './threads'
import type { MmYouRow, MmYouSource } from '../types'

export type YouRow = MmYouRow
export type YouSource = MmYouSource

/** A subject as an ask quotes it: no `Re:` or `Fwd:` in front, at most 60 characters. */
export function subjectOf(subject: unknown): string {
  return cleanText(typeof subject === 'string' ? subject.replace(/^\s*(?:(?:re|fwd?|aw|wg)\s*:\s*)+/i, '') : '', 60)
}

/** The newest client message on the item (the feed's order is not relied on), or null. */
function newestMail(it: Pick<QueueItem, 'mail'>): QueueItem['mail'][number] | null {
  const mail = Array.isArray(it.mail) ? it.mail.filter(m => m && typeof m === 'object') : []
  if (!mail.length) return null
  return mail.reduce((a, b) => ((Date.parse(b.at) || 0) > (Date.parse(a.at) || 0) ? b : a))
}

/** `Zach about "Invite failures"`, `Zach`, or the client's name when the feed names no sender. */
function whoAbout(it: QueueItem): string {
  const m = newestMail(it)
  const who = senderName(m?.sender) || cleanName(it.client) || 'the client'
  const about = subjectOf(m?.subject)
  return about ? `${who} about "${about}"` : who
}

const more = (n: number): string => (n > 0 ? ` (+${n} more)` : '')
const quoted = (title: unknown, max = 60): string => `"${cleanText(title, max) || 'Untitled ticket'}"`

/**
 * What is needed from the person on this item, and where the words came from. `stillOpen`: what the server's check of our reply
 * found still open (R8, the row's), first named.
 */
export function youAsk(it: QueueItem, now: number, stillOpen?: readonly string[]): { ask: string; from: YouSource } {
  const client = cleanName(it.client) || 'the client'
  const o = it.open ?? null
  if (Array.isArray(stillOpen) && stillOpen.length) return { ask: `finish what your reply to ${client} left open: ${cleanText(stillOpen[0], 80)}${more(stillOpen.length - 1)}`, from: 'open' }
  if (it.noReply === true) return noReplyNow(it) ? { ask: `close ${client}'s package: no reply is owed`, from: 'noreply' } : { ask: `answer ${whoAbout(it)}: they wrote after the no-reply package`, from: 'mail' }
  if (o?.state === 'held_by_me') return { ask: `send your draft to ${whoAbout(it)}${o.unsent > 1 ? ` (${o.unsent} left)` : ''}`, from: 'draft' }
  if (it.kind === 'ok' && !it.theirs) {
    const sends = it.ok?.sends && !/^nobody/i.test(it.ok.sends) ? ` (${cleanText(it.ok.sends, 40)} sends it)` : ''
    return { ask: `give your OK on the reply to ${whoAbout(it)}${sends}`, from: 'ok' }
  }
  if (packageReady(it)) return { ask: it.messages > 0 ? `approve the reply to ${whoAbout(it)}` : `approve ${client}'s reply package`, from: 'package' }
  if (it.messages > 0 && o?.state !== 'held_by_other') return { ask: `answer ${whoAbout(it)}${more(it.messages - 1)}`, from: 'mail' }
  const asks = openAsks(it)
  if (asks.length) {
    const a = asks[0]
    const who = cleanText(a?.asker, 40) || 'a teammate'
    const what = cleanText(a?.snippet, 80)
    return { ask: `answer ${who}'s ask${what ? `: "${what}"` : ''}${more(asks.length - 1)}`, from: 'ask' }
  }
  const eta = etaAsksOf(it)
  if (eta.length) return { ask: `give an ETA for ${quoted(eta[0]?.title)}${more(eta.length - 1)}`, from: 'eta' }
  const owners = assignAsksOf(it)
  if (owners.length) return { ask: `assign an owner to ${quoted(owners[0]?.title)}${more(owners.length - 1)}`, from: 'owner' }
  const g = goOf(it)
  if (g?.mine) return { ask: `give your go on ${g.steps} follow-up${g.steps === 1 ? '' : 's'} (${goFirstText(g)})`, from: 'go' }
  const dated = committedCount(it)
  const title = Array.isArray(it.taskTitles) ? it.taskTitles.find(t => typeof t === 'string' && t.trim()) : undefined
  if (dated > 0 && title) {
    const notStarted = typeof it.startBy === 'number' && Number.isFinite(it.startBy) && it.startBy <= now
    return { ask: `${notStarted ? 'start' : 'deliver'} ${quoted(title)}${more(dated - 1)}`, from: 'task' }
  }
  if (paceOf(it)) return { ask: `catch up on ${client}'s quoted work (${paceWord(it)})`, from: 'pace' }
  const q = queuedOf(it)
  if (q.length) return { ask: `next in your build queue: ${quoted(q[0]?.title)}`, from: 'queue' }
  return { ask: dated > 0 ? `${dated} task${dated === 1 ? '' : 's'} of yours` : 'look at the thread', from: 'none' }
}

/** Where the row stands on its clock, and the time it is ordered by. */
export function youClock(it: QueueItem, now: number): { clock: YouRow['clock']; at: number; when: string; short: string } {
  const client = clientDueOf(it)
  // a client's own date has passed: late, worked from that date
  if (client < now) return { clock: 'late', at: client, when: clockAndDue(client, now), short: clockLead(client, now) }
  // ⛔ (0.7.61) a team clock that has passed reads behind, never late; the client's own date after it, when there is one
  const behind = internalBehindAt(it, now)
  const lead = leadDueOf(it, now)
  if (Number.isFinite(behind)) {
    const due = Number.isFinite(lead) ? `, due ${clockText(shownDue(lead), now)}` : ''
    return { clock: 'behind', at: behind, when: `behind since ${dueWhen(behind, now)}${due}`, short: 'behind' }
  }
  if (Number.isFinite(lead)) return { clock: pinsFor(it, now) ? 'soon' : 'later', at: lead, when: `due ${clockText(shownDue(lead), now)}`, short: `due ${clockText(shownDue(lead), now)}` }
  return { clock: 'none', at: Infinity, when: 'no due date', short: 'no due date' }
}

/** Why the row needs the person, in a few words: what pins it, and (0.7.68) the thread's own `mm waiting` question. */
export function youWhy(it: QueueItem, now: number, clock: YouRow['clock'], from: YouSource, waiting?: string): string {
  const parts: string[] = []
  if (clock === 'late') parts.push('late on a client date')
  else if (clock === 'behind') parts.push('behind on a team clock')
  else if (clock === 'soon') parts.push('due within 24 business hours')
  const what: Partial<Record<YouSource, string>> = {
    open: 'your reply left items open',
    noreply: 'package ready, no reply owed',
    draft: 'your draft is not sent',
    package: 'reply ready for your go',
    ok: 'waits on your OK',
    mail: 'the client wrote',
    ask: 'a teammate asked you',
    eta: 'an ETA is owed',
    owner: 'needs an owner',
    go: 'follow-ups wait for your go',
    task: 'your ticket',
    pace: 'quoted work at your pace',
    queue: 'your build queue',
  }
  if (what[from]) parts.push(what[from] as string)
  // the pin itself (R1): what is the person's own pins at once, whatever its clock (a go on follow-ups, a pace row)
  if (!parts.length && ownPins(it, now)) parts.push('pinned for you')
  if (waiting) parts.push(`waiting on you: ${cleanText(waiting, 120)}`)
  return parts.join(' · ')
}

/** The row's pin: pinned, needs a pin (the pane's own words for why not), or no pin needed yet (due later). */
export function youPin(pin: RowPin | undefined): Pick<YouRow, 'pin' | 'pinWhy'> {
  if (!pin || typeof pin !== 'object') return { pin: 'later' }
  if (pin.pinned === true) return { pin: 'pinned' }
  return { pin: 'needs_pin', pinWhy: rowPinWords(pin).replace(/^not pinned(?::\s*)?/, '') || 'not pinned' }
}

/** One item as its You row. */
export function youRow(it: QueueItem, now: number, o: { pin?: RowPin | undefined; stillOpen?: readonly string[]; waiting?: string; target?: string } = {}): YouRow {
  const { ask, from } = youAsk(it, now, o.stillOpen)
  const c = youClock(it, now)
  return {
    projectId: it.projectId,
    client: cleanName(it.client) || 'a client',
    ask,
    from,
    when: c.when,
    short: c.short,
    clock: c.clock,
    at: Number.isFinite(c.at) ? c.at : null,
    why: youWhy(it, now, c.clock, from, o.waiting),
    ...youPin(o.pin),
    ...(o.target ? { target: o.target } : {}),
  }
}

/**
 * The order (Rob's spec): late first, the most overdue first; then by deadline, soonest first (a team clock that has passed comes
 * before any deadline still ahead); nothing dated last. Ties by client name.
 */
export function youSort(a: Pick<YouRow, 'clock' | 'at' | 'client'>, b: Pick<YouRow, 'clock' | 'at' | 'client'>): number {
  const lateA = a.clock === 'late' ? 0 : 1
  const lateB = b.clock === 'late' ? 0 : 1
  if (lateA !== lateB) return lateA - lateB
  const atA = a.at ?? Infinity
  const atB = b.at ?? Infinity
  if (atA !== atB) return atA < atB ? -1 : 1
  return a.client.localeCompare(b.client)
}

/** The items as their rows, in the order they are drawn. */
export function youRows(items: readonly QueueItem[], now: number, o: { pins?: Readonly<Record<string, RowPin>>; stillOpen?: Readonly<Record<string, readonly string[]>>; waiting?: Readonly<Record<string, string>>; targets?: Readonly<Record<string, string>> } = {}): YouRow[] {
  return items
    .filter(it => it && typeof it.projectId === 'string')
    .map(it =>
      youRow(it, now, {
        pin: o.pins?.[it.projectId],
        ...(o.stillOpen?.[it.projectId] ? { stillOpen: o.stillOpen[it.projectId] } : {}),
        ...(o.waiting?.[it.projectId] ? { waiting: o.waiting[it.projectId] } : {}),
        ...(o.targets?.[it.projectId] ? { target: o.targets[it.projectId] } : {}),
      }),
    )
    .sort(youSort)
}

/** The ask as the band shortens it: its first clause, at most 48 characters. */
export function shortAsk(ask: string): string {
  const first = ask.split(/:\s| \(/)[0] ?? ask
  const words = first.replace(/ about ".*$/, '')
  return [...words].length > 48 ? `${[...words].slice(0, 47).join('').trimEnd()}…` : words
}

/** What the band says when nothing needs the person. */
export const NOTHING_NEEDS_YOU = 'Nothing needs you right now.'

/**
 * The band's first line: `Needs you: 7 · 2 late` and the next row's words, `Crucial Hire, approve the reply, due 3:45 PM`, which the
 * band draws as the button that opens that thread. With nothing: NOTHING_NEEDS_YOU.
 */
export function youBand(rows: readonly YouRow[]): { head: string; next?: { words: string; projectId: string; target?: string } } {
  if (!rows.length) return { head: NOTHING_NEEDS_YOU }
  const late = rows.filter(r => r.clock === 'late').length
  const behind = rows.filter(r => r.clock === 'behind').length
  const head = [`Needs you: ${rows.length}`, ...(late ? [`${late} late`] : []), ...(behind ? [`${behind} behind`] : [])].join(' · ')
  const n = rows[0] as YouRow
  return { head, next: { words: `${n.client}, ${shortAsk(n.ask)}, ${n.short}`, projectId: n.projectId, ...(n.target ? { target: n.target } : {}) } }
}

/** The band's first line as one sentence, for a surface that draws no button. */
export const youBandText = (b: ReturnType<typeof youBand>): string => (b.next ? `${b.head} · next: ${b.next.words}` : b.head)

/**
 * (0.7.73) The "You" section's client rows, and the band's "next": one row per client that needs the person, saying what is needed
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
  clientSections,
  committedCount,
  dueWhen,
  etaAsksOf,
  goFirstText,
  goOf,
  hoursDone,
  internalBehindAt,
  leadDueOf,
  needsYouNow,
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
import type { MmYouRow, MmYouSource, MmYouWait } from '../types'

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
  if (Number.isFinite(lead)) {
    const due = `due ${clockText(shownDue(lead), now)}`
    return { clock: pinsFor(it, now) ? 'soon' : 'later', at: lead, when: due, short: due }
  }
  return { clock: 'none', at: Infinity, when: 'no due date', short: 'no due date' }
}

/**
 * (0.7.73, Rob 2026-11-24: "A color that represents if you're on pace to complete it on time. Or when they're ahead of schedule") Whether
 * the client is on pace to finish on time: red late on a client date, or a pace row that reads late; amber behind (a pace row behind or
 * overbooked, a start-by passed with the work not started, a team clock passed); green ahead (today's paid hours logged) or on pace.
 */
export function youPace(it: QueueItem, now: number): { level: 'green' | 'amber' | 'red'; words: string } {
  const client = clientDueOf(it)
  if (client < now) return { level: 'red', words: clockLead(client, now) }
  const p = paceOf(it)
  if (p?.state === 'late') return { level: 'red', words: 'late on hours' }
  if (p?.state === 'behind' || p?.state === 'overbooked') return { level: 'amber', words: p.state }
  if (typeof it.startBy === 'number' && Number.isFinite(it.startBy) && it.startBy <= now) return { level: 'amber', words: 'not started' }
  if (Number.isFinite(internalBehindAt(it, now))) return { level: 'amber', words: 'behind on a team clock' }
  if (p && hoursDone(p)) return { level: 'green', words: 'ahead today' }
  return { level: 'green', words: 'on pace' }
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

/** The row's pin as the pane says it: `pinned`, `needs a pin: you unpinned it`, `no pin needed yet`. */
export const youPinText = (r: Pick<YouRow, 'pin' | 'pinWhy'>): string => (r.pin === 'pinned' ? 'pinned' : r.pin === 'needs_pin' ? `needs a pin: ${r.pinWhy || 'not pinned'}` : 'no pin needed yet')

/** How fresh something is, in real time: `just now`, `25m ago`, `3h ago`, `2d ago`. Not a client clock: never business time. */
export function agoWords(at: number, now: number): string {
  const m = Math.max(0, Math.round((now - at) / 60_000))
  if (m < 2) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  return h < 48 ? `${h}h ago` : `${Math.round(h / 24)}d ago`
}

/**
 * At most `max` characters of a client's or teammate's words, with an ellipsis where it was cut: cleaned as `cleanText` cleans, but
 * keeping `?`, `!`, `:` and `;`, which the pane draws as plain text (they never go into a kickoff, a title or a tool argument from here).
 */
function clip(text: unknown, max: number): string {
  const kept = (typeof text === 'string' ? text : '').normalize('NFC').replace(/[^\p{L}\p{N} .,&'()/?!:;-]/gu, ' ')
  const all = kept.replace(/ +/g, ' ').trim()
  return [...all].length > max ? `${[...all].slice(0, max - 1).join('').trimEnd()}…` : all
}

const hrs = (n: number): string => String(Math.round(n * 10) / 10)
const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`

/** The most detail lines a row draws, so the section stays an overview (Rob 2026-11-25: "i dont want to get overcluttered"). */
export const YOU_DETAIL_MAX = 3

/**
 * (0.7.73, Rob 2026-11-25: "more info than what we see in the thread names ... an overview of each clients status that needs them with
 * more specific client task details") The specifics under a You row, each from the item itself and none repeating its head: the
 * client's newest message (who, how long ago, its first words), the reply package (who holds it, drafts not sent, what came after
 * it), a teammate's ask, the tickets beyond the one the head names, and the hours (needed against paid a day, logged today, the
 * date). In that order, at most YOU_DETAIL_MAX.
 */
export function youDetails(it: QueueItem, now: number, from: YouSource, max = YOU_DETAIL_MAX): string[] {
  const out: string[] = []
  const m = newestMail(it)
  if (m && it.messages > 0) {
    const who = senderName(m.sender) || cleanName(it.client) || 'The client'
    const at = Date.parse(m.at)
    const words = clip(m.snippet, 90) || subjectOf(m.subject)
    const many = it.messages > 1 ? ` (${plural(it.messages, 'message')})` : ''
    out.push(`${who} wrote${Number.isFinite(at) ? ` ${agoWords(at, now)}` : ''}${words ? `: "${words}"` : ''}${many}`)
  }
  const o = it.open ?? null
  if (o && o.noReply !== true) {
    // (0.7.77) a head that already says "send your draft" is not said again: only what it does not say
    const said = from === 'draft'
    const parts = [
      said ? '' : o.state === 'held_by_other' && o.by ? `${cleanText(o.by, 40)} holds it` : o.state === 'held_by_me' ? 'you hold it' : o.state === 'stale' ? 'out of date' : '',
      said || o.unsent <= 0 ? '' : `${plural(o.unsent, 'draft')} ${o.state === 'held_by_me' || o.state === 'held_by_other' ? 'not sent' : 'ready'}`,
      o.newer > 0 ? `${plural(o.newer, 'message')} came after it` : '',
    ].filter(Boolean)
    if (parts.length) out.push(`Reply package: ${parts.join(' · ')}`)
  } else if (packageReady(it) && it.coversThrough) {
    const at = Date.parse(it.coversThrough)
    if (Number.isFinite(at)) out.push(`Reply package: ready, covers mail through ${clockText(at, now)}`)
  }
  const asks = openAsks(it).slice(from === 'ask' ? 1 : 0)
  if (asks.length) {
    const a = asks[0]
    const what = clip(a?.snippet, 80)
    out.push(`${cleanText(a?.asker, 40) || 'A teammate'} asks${what ? `: "${what}"` : ''}${asks.length > 1 ? ` (+${asks.length - 1} more)` : ''}`)
  }
  const titles = (Array.isArray(it.taskTitles) ? it.taskTitles : []).filter(x => typeof x === 'string' && x.trim()).slice(from === 'task' ? 1 : 0)
  if (titles.length) out.push(`${titles.length === 1 ? 'Ticket' : 'Tickets'}: ${titles.slice(0, 2).map(x => `"${clip(x, 50)}"`).join(', ')}${titles.length > 2 ? ` (+${titles.length - 2} more)` : ''}`)
  const p = paceOf(it)
  if (p) {
    const by = Number.isFinite(p.date) ? clockText(shownDue(p.date), now) : ''
    out.push(
      p.state === 'late'
        ? `Hours: ${hrs(p.short)} h of quoted work past ${by}`
        : `Hours: needs ${hrs(p.need)} h a day, ${hrs(p.paid)} paid${p.logged !== null ? ` · ${hrs(p.logged)} h logged today` : ''}${by ? ` · due ${by}` : ''}`,
    )
  }
  return out.slice(0, max)
}

/**
 * (0.7.77, Rob 2026-11-25: "it doesn't seem to be giving that much more new info under each item ... I think we need some more detail")
 * What a row's Details opens: when we last wrote to the client, the reply package, the hours, then the client's whole part as its own
 * thread shows it (`clientSections`: every message waiting with its words, the tasks, the asks, the follow-ups), as Markdown.
 */
export function youPage(it: QueueItem, now: number): string {
  const client = cleanName(it.client) || 'the client'
  const top: string[] = []
  if (typeof it.lastOut === 'number' && Number.isFinite(it.lastOut) && it.lastOut > 0) top.push(`- We last wrote to ${client} ${agoWords(it.lastOut, now)} (${clockText(it.lastOut, now)}).`)
  else top.push(`- Nothing we sent to ${client} is in the feed.`)
  for (const line of youDetails(it, now, 'none', Infinity)) if (/^(Reply package|Hours):/.test(line)) top.push(`- ${line}`)
  const rest = clientSections(it, now)
  while (rest.length && rest[0] === '') rest.shift()
  return [...top, ...(rest.length ? ['', ...rest] : [])].join('\n')
}

/** One item as its You row. */
export function youRow(it: QueueItem, now: number, o: { pin?: RowPin | undefined; stillOpen?: readonly string[]; waiting?: string; target?: string } = {}): YouRow {
  const { ask, from } = youAsk(it, now, o.stillOpen)
  const c = youClock(it, now)
  const pace = youPace(it, now)
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
    pace: pace.level,
    paceWords: pace.words,
    details: youDetails(it, now, from),
    page: youPage(it, now),
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

/** (0.7.68) What a thread waits on, by the kind it declared (`mm waiting <type>`). */
const WAIT_WORDS: Readonly<Record<string, string>> = { send: 'a go to send', money: 'a money call', 'only-you': 'something only you can do', risk: 'a risk call' }

/**
 * The threads that declared `mm waiting` (MmYouWait), into the rows: beside the client's own row when the thread is that client's (its
 * why ends with the question), else a row of its own whose ask is the question, pinned (the declaration pins it), with no due date.
 */
export function withWaits(rows: readonly YouRow[], waits: readonly MmYouWait[] | undefined): YouRow[] {
  const out = rows.map(r => ({ ...r }))
  for (const w of Array.isArray(waits) ? waits : []) {
    if (!w || typeof w.sid !== 'string' || typeof w.question !== 'string' || !w.question) continue
    // cleaned as any text the pane shows, keeping the question mark that ends it
    const question = `${cleanText(w.question, 120)}${/\?\s*$/.test(w.question) ? '?' : ''}`
    const mine = w.projectId ? out.find(r => r.projectId === w.projectId) : undefined
    if (mine) {
      if (!mine.why.includes('waiting on you')) mine.why = [mine.why, `waiting on you: ${question}`].filter(Boolean).join(' · ')
      if (!mine.target) mine.target = w.sid
      continue
    }
    if (out.some(r => r.target === w.sid)) continue
    out.push({
      projectId: w.projectId ?? w.sid,
      client: cleanName(w.client) || 'a thread',
      ask: `answer: ${question}`,
      from: 'waiting',
      when: 'no due date',
      short: 'waiting on you',
      clock: 'none',
      at: null,
      why: `waiting on you for ${WAIT_WORDS[w.type] ?? 'an answer'}`,
      pace: 'amber',
      paceWords: 'waiting on you',
      pin: 'pinned',
      target: w.sid,
    })
  }
  return out.sort(youSort)
}

/** What the You section says when nothing needs the person. */
export const NOTHING_NEEDS_YOU = 'Nothing needs you right now.'

/**
 * ⛔ (0.7.81, Rob 2026-11-25: "The need view is basically supposed to show them and help them confirm that they have everything
 * pinned they're supposed to have pinned. It's also supposed to mirror the things that show up under each of their names on the
 * team view." Then, to the recommendation that the pin rule decide all three: "Yes, build it") The clients Needs you lists: exactly
 * the ones the sync's pin report says should be pinned (`rowPins`, from `pinReport`: R1's `pinsFor`, less a client a scheduled
 * run or the checking loop holds off), which is the list OW draws under the person's name on the team view. Before 0.7.81 the
 * list was every dated client of the person's, so a task due Friday or a thread waiting on a 4:15 PM run was listed and not
 * pinned. A sync with no report (none built, or an older version's record): R1's own test, `pinsFor`.
 */
export function needsYouSet(items: readonly QueueItem[], rowPins: Readonly<Record<string, unknown>> | null | undefined, now: number): Set<string> {
  const listed = items.filter(it => it && typeof it.projectId === 'string')
  if (rowPins && typeof rowPins === 'object') return new Set(listed.filter(it => Object.prototype.hasOwnProperty.call(rowPins, it.projectId)).map(it => it.projectId))
  return new Set(listed.filter(it => pinsFor(it, now)).map(it => it.projectId))
}

/** (0.7.81) The most clients the Coming up line names; past it, `(+n more)`. */
export const COMING_UP_MAX = 6

/**
 * (0.7.81) The one line under Needs you for the person's clients that do not pin yet: due later than the next 24 business hours,
 * held off by a scheduled run (`held`: project id → ` waits on a run 4:15 PM`, as its thread's name says it), or with nothing
 * dated (a message with no reply due), last. Soonest first. '' when there are none. Clients with undated tickets alone stay in
 * `No due date`, and the internal queue in `Your build queue`. Claude's words, approved with the rule.
 */
export function comingUpText(items: readonly QueueItem[], inNeeds: ReadonlySet<string>, held: Readonly<Record<string, string>> | null | undefined, now: number): string {
  const rows: { at: number; text: string }[] = []
  for (const it of items) {
    if (!it || typeof it.projectId !== 'string' || inNeeds.has(it.projectId) || !needsYouNow(it)) continue
    const lead = leadDueOf(it, now)
    // (the bridge's own words, `runWaitSuffix`, kept on the sync record: one line, cut, with their clock's colon kept)
    const wait = held && typeof held[it.projectId] === 'string' ? [...held[it.projectId].replace(/[\u0000-\u001f\u007f]+/g, ' ').trim()].slice(0, 60).join('') : ''
    // (a client with nothing dated, such as a message with no reply due, stays one look away, last: as `No due date` keeps undated tickets)
    const when = wait || (Number.isFinite(lead) ? `due ${clockText(shownDue(lead), now)}` : 'no due date')
    rows.push({ at: Number.isFinite(lead) ? lead : Infinity, text: `${cleanName(it.client) || 'a client'} · ${when}` })
  }
  if (!rows.length) return ''
  rows.sort((a, b) => a.at - b.at || a.text.localeCompare(b.text))
  const shown = rows.slice(0, COMING_UP_MAX).map(r => r.text).join('; ')
  return `Coming up, not pinned yet: ${shown}${more(rows.length - COMING_UP_MAX)}`
}

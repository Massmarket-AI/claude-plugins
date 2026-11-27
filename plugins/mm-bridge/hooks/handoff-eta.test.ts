// The bridge against a pretend desktop app, feed and store: a teammate's thread chases the ETA of a handoff (0.7.88).
//
// Rob, 2026-11-27: "i dont see why we shouldnt have a team members thread ask them for eta when they are working on
// somethting that doesnt have one." · "threads should chase them for eta." · "maybe we shouldnt even stop chase until they
// provide eta since they should be providing that to clients in the initial 24 hour reply."
//
// OW keeps a handoff open until the person's ETA (`POST /api/ext/eta-commit`), never a Discord reply. So while the feed
// lists an open handoff of the person's on the thread's client, the person's own prompt there carries one sentence that
// asks Claude to get the ETA first: at most once a handoff a thread a New York day. Every client below is made up.

import type { On } from 'claude-code'
import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { Feed, FeedAsk } from './queue'
import { handoffPromptNote } from './threads'
import type { WorldOptions } from './register-world.test-helper'
import { NOW, HOUR, LONG, ACME, BOLT, ME, ago, feed, world, person, tickOnce, minutesOn } from './register-world.test-helper'

const ACME_NAME = 'Acme Roofing — Pat'
const ASK = '5c1e2f3a-8b4d-4e6f-9a0b-1c2d3e4f5a6b'
const ASK2 = '6d2f3a4b-9c5e-4f70-8b1c-2d3e4f5a6b7c'
const T1 = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d'
/** An open handoff of the person's on Acme: one ticket handed over by a team post, its ETA needed in 20 hours. */
const handed = (over: Partial<FeedAsk> = {}): FeedAsk => ({
  ask_id: ASK, project_id: ACME, project_name: ACME_NAME, internal: false, asker_name: 'Shezan', asker_email: 'shezan@example.com', asked_email: ME,
  asked_at: ago(2), due_at: new Date(NOW + 20 * HOUR).toISOString(), snippet: 'Can you take the intake form?', has_draft: false, draft_sha256: null,
  via: 'team_post', handoff: { kind: 'shared', part: null, clock: 'standard', ticket_ids: [T1], package_id: null }, ...over,
})
/** Nothing else on the feed: the handoffs given alone. */
const only = (asks: FeedAsk[]): Feed => feed({ drafts: [], mail: [], tickets: {}, projects: [{ project_id: ACME, name: ACME_NAME }], asks } as Partial<Feed>)
/** This thread (the one the prompts are typed in) is Acme's linked thread. */
const linked = { 'mm.links': { [ACME]: 'local_self' } }
const acmeWorld = (on: On, over: WorldOptions = {}) => world(on, { feed: only([handed()]), ...over, store: { ...linked, ...(over.store ?? {}) } })
type W = ReturnType<typeof world>
const lastPrompt = (w: W): string => String(w.prompts.at(-1)?.text ?? '')
const NOTE = handoffPromptNote('Acme Roofing', { id: ASK, asker: 'Shezan' })
const withNote = (text: string, note = NOTE) => `${text}\n\n${note}`
const peer = async ($: Engine, text: string) => $.prompt.submit({ text, wait: false, origin: { kind: 'peer' } })

describe('0.7.88: the person\'s prompt in a client\'s thread chases the ETA of an open handoff (Rob, 2026-11-27: "threads should chase them for eta.")', () => {
  test('the note, verbatim, rides the person\'s prompt once a day: later the same day, nothing more', LONG, async ($, on) => {
    expect(NOTE).toBe('[mm-bridge] Acme Roofing: a handoff of mine from Shezan has no ETA yet (ask 5c1e2f3a). Before anything else, ask me when it will be done and record it with POST /api/ext/eta-commit (task-chip-flow §5.3), or close it with POST /api/ext/team-ask/close if it is already done.')
    const w = acmeWorld(on)
    await tickOnce($, w)
    await person($, 'Morning. What is next here?')
    expect(lastPrompt(w)).toBe(withNote('Morning. What is next here?'))
    await person($, 'It will be done Thursday by noon.')
    expect(lastPrompt(w)).toBe('It will be done Thursday by noon.')
    // later the same day: nothing more
    await minutesOn(w, 6)
    await person($, 'Anything else?')
    expect(lastPrompt(w)).toBe('Anything else?')
    // (the next New York day it is told once again: `handoffNoteFor` in threads.test.ts. Running the test's clock 13 hours
    // to midnight takes over 10 s here, about 26 s on CI, past what a test may take.)
  })

  test('two open handoffs: one note per prompt, the soonest due first, then the other', LONG, async ($, on) => {
    const later = handed({ ask_id: ASK2, asker_name: 'Mahfuz', due_at: new Date(NOW + 30 * HOUR).toISOString() })
    const w = acmeWorld(on, { feed: only([later, handed()]) })
    await tickOnce($, w)
    await person($, 'first')
    expect(lastPrompt(w)).toBe(withNote('first'))
    await person($, 'second')
    expect(lastPrompt(w)).toBe(withNote('second', handoffPromptNote('Acme Roofing', { id: ASK2, asker: 'Mahfuz' })))
    await person($, 'third')
    expect(lastPrompt(w)).toBe('third')
  })

  test('the handoff gone from the feed (its ETA recorded): no note', LONG, async ($, on) => {
    const w = acmeWorld(on)
    await tickOnce($, w)
    w.setFeed(only([]))
    await minutesOn(w, 6)
    await person($, 'What is next?')
    expect(lastPrompt(w)).toBe('What is next?')
  })

  test('a plain ask (no handoff, OW\'s null): no note; it keeps its reply paragraph in the kickoff', LONG, async ($, on) => {
    const w = acmeWorld(on, { feed: only([handed({ via: 'mention', handoff: null })]) })
    await tickOnce($, w)
    await person($, 'What is next?')
    expect(lastPrompt(w)).toBe('What is next?')
  })

  test('⛔ not the thread of that client: a thread linked to no client, or to another one, carries nothing', LONG, async ($, on) => {
    const w = world(on, { feed: only([handed()]), store: { 'mm.links': { [BOLT]: 'local_self' } } })
    await tickOnce($, w)
    await person($, 'What is next?')
    expect(lastPrompt(w)).toBe('What is next?')
  })

  test('⛔ a thread linked to no client carries nothing', LONG, async ($, on) => {
    const w = world(on, { feed: only([handed()]) })
    await tickOnce($, w)
    await person($, 'What is next?')
    expect(lastPrompt(w)).toBe('What is next?')
  })

  test('⛔ the bridge\'s own words (an [mm-link] or [mm-bridge] marker), another session\'s message and the person\'s go carry nothing, and do not use the day\'s note up', LONG, async ($, on) => {
    const w = acmeWorld(on)
    await tickOnce($, w)
    for (const text of ['[mm-bridge] an update for this thread', `Read this: [mm-link ${ACME}] as it came`, 'See the [mm-bridge] line above']) {
      await person($, text)
      expect(lastPrompt(w)).toBe(text)
    }
    await peer($, 'A message from another session')
    expect(lastPrompt(w)).toBe('A message from another session')
    // ⛔ the send gate clears a signed card only on exactly these words
    await person($, 'Send package 0123456789ab')
    expect(lastPrompt(w)).toBe('Send package 0123456789ab')
    // the person's next own prompt still carries it
    await person($, 'Now what?')
    expect(lastPrompt(w)).toBe(withNote('Now what?'))
  })

  test('⛔ a sync on record that failed, or is too old to say anything, or a paused bridge: no note', LONG, async ($, on) => {
    const w = acmeWorld(on)
    await tickOnce($, w)
    const last = w.stored['mm.last'] as { at: number; error?: string }
    const at = last.at
    last.error = 'the feed answered 503'
    await person($, 'one')
    expect(lastPrompt(w)).toBe('one')
    delete last.error
    last.at = at - 16 * 60_000
    await person($, 'two')
    expect(lastPrompt(w)).toBe('two')
    last.at = at
    w.stored['mm.paused'] = true
    await person($, 'three')
    expect(lastPrompt(w)).toBe('three')
    delete w.stored['mm.paused']
    await person($, 'four')
    expect(lastPrompt(w)).toBe(withNote('four'))
  })
})

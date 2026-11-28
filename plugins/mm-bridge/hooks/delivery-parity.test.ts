// (0.7.86) The delivery check (client-reply-prep section 9.2e; Rob, 2026-11-27: "before one is able to be sent, it should
// ensure we have checked the qa video, walkthrough video, and documentation for completeness against the approved plan").
// A delivery package's page carries "### Delivery check"; the card must hold every line of it, or `mm card` answers not
// ready and the thread prints the whole page instead.
import { describe, expect, test } from 'claude-code/testing'

import type { MmCardTree } from '../types'
import { readTree } from './card'
import { contentPieces, pageGap } from './card-parity'
import { DELIVERY_PAIRS } from './delivery-pairs.test-helper'

describe('0.7.86 delivery check: the card holds the page', () => {
  test('the pairs are delivery packages', () => {
    expect(Object.keys(DELIVERY_PAIRS).length).toBe(7)
  })
  for (const name of Object.keys(DELIVERY_PAIRS)) {
    test(name, () => {
      const p = DELIVERY_PAIRS[name]
      const tree = readTree(JSON.parse(JSON.stringify(p.tree))) as MmCardTree
      expect(contentPieces(p.page).length).toBeGreaterThan(5)
      expect(p.page).toContain('### Delivery check')
      expect(pageGap(p.page, tree)).toBe('')
    })
  }
})

/**
 * Made-up page and card pairs from client-reply-prep's renderers; regenerate with tests/gen_card_pairs.py --ts there.
 */
export const CARD_PAIRS: Record<string, { page: string; tree: unknown }> = {
"everything":{
"page":"## ZZ_client (Dana) · reply package · Package `3f1c9a7e5b2d`\n\n### Every question answered?\n| # | They asked | Our reply says | |\n|---|---|---|---|\n| 1 | ZZ_q1_quote is it live? | \"yes ZZ_answer\" | ✅ |\n\n### ETA or proof for every open ticket?\n| # | Ticket | Owner | The reply gives | Our reply says |\n|---|---|---|---|---|\n| 1 | `aaaaaaaa` ZZ_ticket_title | zz_owner@massmarket.ai | ETA Thu Nov 12, 3 h | \"ZZ_ticket_quote\" |\n| 2 | `aaaaaaaa` ZZ_ticket2_title | zz_owner2@massmarket.ai | ⛔ Missing | — |\n\n⛔ 1 of 2 open tickets have no ETA, proof or named wait from their owner in the drafts as they stand.\nOW only records this for now (observe). Get it before the go anyway.\n\n### Their message\nEverything since our last reply, Mon Nov 2, 7:00 AM ET: ZZ_went_out_what.\n\n#### ZZ_inb_from · Thu Nov 5, 10:00 AM ET · gmail\nTo: zz_inb_to@x.example · Cc: zz_inb_cc@x.example · Subject: ZZ_hdr_subject\n> ```text\n> Hi team, ZZ_inbound_email_words, is it live? And Saturday?\n> ```\n\n_Quoted history below this point was removed: it starts \"On Mon Nov 2 2026 Rob wrote: > old stuff ZZ_quoted_history\". Source: doc `dddddddd`._\n\n#### Dana · Thu Nov 5, 11:00 AM ET · call\nTheir words, an excerpt the package stored; the whole document is doc `dddddddd`:\n> ```text\n> ZZ_call_excerpt\n> ```\n\n#### Dana · Thu Nov 5, 11:20 AM ET · portal\n_Doc `dddddddd` (document) is not the message itself, and the package stored none of their words for it. Summary from the package: ZZ_nonmsg_summary_\n\n**Attachment** (Thu Nov 5, 11:10 AM ET): ZZ_attach_summary · our transcription is doc `dddddddd`\n\nEarlier messages, already answered by our last reply:\n- Sun Nov 1, 11:20 AM ET, gmail: ZZ_older_summary (doc `dddddddd`)\n\n### Client reply\nZZ_reply_owed_why.\n\n#### 1. ZZ_d1_title\n**To:** zz_d1_to@x.example · **Cc:** zz_d1_cc@x.example, support@letaidothehardwork.com, rob@massmarket.ai · **Subject:** ZZ_d1_subject · **From:** zz_d1_from@massmarket.ai · **Channel:** gmail · hash `e1e1e1e1e1e1` · ⚠️ needs Rob's OK\n**The change:** ZZ_d1_diff\n```text\nHi Dana, ZZ_d1_body yes ZZ_answer.\n\nSecond paragraph ZZ_d1_body2.\n```\n\n#### 5. ZZ_d5_title\n_Already sent Thu Nov 5, 7:00 AM ET by zz_sent_by@massmarket.ai (zz_sent_ref). One go does not send it again._\n\n### Team post\n\n#### 2. ZZ_d2_title\n**Channel:** 900000000000000099 · **Must act:** <@900000000000000002> · **FYI:** <@900000000000000004> · **Owners:** `aaaaaaaa` zz_ticket_owner@massmarket.ai · **In reply to:** 900000000000000077 · hash `e2e2e2e2e2e2`\n**The change:** ZZ_d2_diff\n```text\nUpdate from <@900000000000000003> ZZ_d2_body **ZZ_d2_bold**\n```\n\n### Added by the team\n\n#### zz_contrib@massmarket.ai · Thu Nov 5, 12:00 PM ET\n> ```text\n> ZZ_contribution\n> ```\n\n### Follow-ups (sent only if they have not replied)\nDry run: none of these steps will send while follow-ups are in dry run. The go still schedules them, so chase by hand until follow-ups go live.\nCounting from zz_anchor@massmarket.ai's email of Nov 3.\nEach one goes only if nothing has come from ZZ_fu_sms_name since our reply. Any reply, booking or payment cancels the rest, and their message gets a new package with its own follow-ups.\nGoal: ZZ_goal_action. Done when: ZZ_goal_done.\n\n**1. Email · 2 business days after our reply (Thu 11-05 if the reply goes today) · same thread**\nFrom: zz_fu_from@massmarket.ai · To: zz_fu_to@x.example · Cc: zz_fu_cc@x.example, support@letaidothehardwork.com, rob@massmarket.ai\nSubject: ZZ_fu_subject\n> ```text\n> ZZ_fu_email_body\n> ```\n\n**2. Text · 3 business days after our reply (Fri 11-06 if the reply goes today)**\nTo: ZZ_fu_sms_name · HighLevel contact ZZ_fu_sms_contact · +1 555-555-0142\n> ```text\n> ZZ_fu_sms_body\n> ```\n\n**3. LinkedIn voice note · 4 business days after our reply (Mon 11-09 if the reply goes today) · Rob's seat**\nTo: https://linkedin.example/zz_li\nTranscript:\n> ```text\n> ZZ_fu_voice_body\n> ```\nAudio: not made yet, so this step cannot send. Make it before the go.\n\n**4. Call task for ZZ_assignee · 5 business days after our reply (Tue 11-10 if the reply goes today) · only if they still have not replied**\nWhy a call: ZZ_fu_call_why\n> ```text\n> ZZ_fu_call_body\n> ```\n\nNot shown: 1 cancelled step (ZZ_cancel_reason). Cancelled steps never send.\n\n### Other items\n\n#### 3. ZZ_d3_title\n**Kind:** Text message · **channel:** highlevel_sms · **location_id:** ZZ_d3_location · **contact_id:** ZZ_d3_contact · **to_phone:** +15555550143 · **to_name:** ZZ_d3_name · hash `e3e3e3e3e3e3`\n**The change:** ZZ_d3_diff\n```text\nZZ_d3_sms_body\n```\n\n#### 4. ZZ_d4_title\n**Kind:** HighLevel change · **location_id:** ZZ_d4_location · **thing:** ZZ_d4_thing · hash `e4e4e4e4e4e4`\n**The change:** ZZ_d4_diff\n```text\nZZ_d4_body\n```\n\n### Links\n- ZZ_link_label: https://x.example/zz_link\n- ZZ_source_title: https://x.example/zz_source\n- Draft 1 attachment: `p/zz_attach_path.pdf`\n- Draft 4 document: https://drive.google.com/open?id=1abcdefghijklmnopqrstuvwxyz\n- Draft 4 preview: https://x.example/zz_preview\n- Draft 4 live site: https://x.example/zz_prod\n- Draft 4 before: `zz_before` · after: `zz_after`\n- Draft 5 sent: `zz_sent_ref`\n\n### Findings\n- 1 item(s) added by the team. Recommend: fold them into the client reply before the go.\n- Rob: ZZ_decision. Recommend: ZZ_decision_rec.\n- Only Rob knows: ZZ_fact. Recommend: ZZ_fact_rec.\n- Concession in draft 1 (credit, $50): \"ZZ_concession_text\".\n- Flag (ZZ_flagkind): ZZ_flag.\n_2 more in the JSON read (without format=pickup)._\n\nOne go sends all 4 items now and schedules 4 follow-ups. Package `3f1c9a7e5b2d`.\n",
"tree":{
"v":1,
"package_id":"aaaaaaaa-1111-4222-8333-444444444444",
"project_id":"bbbbbbbb-1111-4222-8333-444444444444",
"client":"ZZ_client (Dana)",
"package_sha256":"3f1c9a7e5b2d4c6a8e0f1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f",
"label":"3f1c9a7e5b2d",
"blocks":71,
"signer":"Test Signer",
"can_sign":true,
"images":0,
"rendered_at":"2026-11-06T15:00:00Z",
"nodes":[
{
"c":"rp-head",
"k":[
{
"r":[
{
"s":"ZC"
}
],
"c":"rp-av rp-av-client"
},
{
"c":"rp-grow",
"k":[
{
"r":[
{
"s":"ZZ_client (Dana)"
}
],
"c":"rp-title"
},
{
"r":[
{
"s":"Reply package · "
},
{
"s":"3f1c9a7e5b2d",
"c":"rp-mono"
}
],
"c":"rp-sub"
}
]
},
{
"r":[
{
"s":"Green",
"c":"rp-chip rp-ok"
},
{
"s":" "
},
{
"s":"prepared",
"c":"rp-chip rp-n"
}
],
"c":"rp-chips"
}
]
},
{
"c":"rp-note",
"k":[
{
"r":[
{
"s":"ZZ_whats_new"
}
],
"c":"rp-whatsnew",
"fp":"f3dd1078"
}
]
},
{
"c":"rp-sec",
"k":[
{
"r":[
{
"s":"Their message"
}
],
"c":"rp-h"
},
{
"r":[
{
"s":"Everything since our last reply, Mon Nov 2, 7:00 AM ET: ZZ_went_out_what."
}
],
"c":"rp-foot",
"fp":"0200ba3a"
},
{
"c":"rp-mail",
"k":[
{
"r":[
{
"s":"ZZ_hdr_subject",
"c":"rp-subj",
"fp":"2ddbffb7"
}
],
"c":"rp-mail-subj"
},
{
"c":"rp-mail-from",
"k":[
{
"r":[
{
"s":"ZI"
}
],
"c":"rp-av"
},
{
"c":"rp-grow",
"k":[
{
"r":[
{
"s":"ZZ_inb_from"
}
],
"c":"rp-from",
"fp":"f9fbc4b6"
},
{
"r":[
{
"s":"To",
"c":"rp-k"
},
{
"s":" "
},
{
"s":"zz_inb_to@x.example",
"c":"rp-v",
"fp":"8a3a7eeb"
}
],
"c":"rp-hdr"
},
{
"r":[
{
"s":"Cc",
"c":"rp-k"
},
{
"s":" "
},
{
"s":"zz_inb_cc@x.example",
"c":"rp-v",
"fp":"2e02030c"
}
],
"c":"rp-hdr"
}
]
},
{
"r":[
{
"s":"Thu Nov 5, 10:00 AM ET · gmail"
}
],
"c":"rp-when"
}
]
},
{
"r":[
{
"s":"Hi team, ZZ_inbound_email_words, is it live? And Saturday?"
}
],
"c":"rp-body rp-mail-body",
"fp":"3048517f"
}
]
},
{
"r":[
{
"s":"Quoted history below this point was removed: it starts \"On Mon Nov 2 2026 Rob wrote: > old stuff ZZ_quoted_history\". Source: doc dddddddd."
}
],
"c":"rp-foot",
"fp":"caa98759"
},
{
"c":"rp-call",
"k":[
{
"c":"rp-call-head",
"k":[
{
"r":[
{
"s":"📞",
"c":"rp-icon"
}
]
},
{
"c":"rp-grow",
"k":[
{
"r":[
{
"s":"ZZ_call_title"
}
],
"c":"rp-from"
},
{
"r":[
{
"s":"Dana · Thu Nov 5, 11:00 AM ET · call · transcript · doc "
},
{
"s":"dddddddd",
"c":"rp-mono"
}
],
"c":"rp-sub"
}
]
}
]
},
{
"r":[
{
"s":"Their words, an excerpt the package stored; the whole document is doc dddddddd:"
}
],
"c":"rp-foot",
"fp":"58d9ba54"
},
{
"c":"rp-turn rp-turn-q",
"k":[
{
"r":[
{
"s":"Dana"
}
],
"c":"rp-turn-who rp-them"
},
{
"r":[
{
"s":"ZZ_call_excerpt"
}
],
"c":"rp-turn-text",
"fp":"2d51b9c4"
}
]
},
{
"btn":"Read the whole transcript ↗",
"ask":"Show me doc dddddddd from package 3f1c9a7e5b2d in full.",
"c":"rp-btn rp-btn-s"
}
]
},
{
"r":[
{
"s":"📎 ",
"c":"rp-icon"
},
{
"s":"Attachment (Thu Nov 5, 11:10 AM ET): ZZ_attach_summary · our transcription is doc dddddddd",
"c":"rp-v",
"fp":"0ec579ca"
}
],
"c":"rp-att"
},
{
"r":[
{
"s":"Dana · Thu Nov 5, 11:20 AM ET · portal"
}
],
"c":"rp-from",
"fp":"6ae8ebd1"
},
{
"r":[
{
"s":"Doc dddddddd (document) is not the message itself, and the package stored none of their words for it. Summary from the package: ZZ_nonmsg_summary"
}
],
"c":"rp-foot",
"fp":"cbd4e7e9"
},
{
"r":[
{
"s":"Earlier messages, already answered by our last reply:"
}
],
"c":"rp-foot"
},
{
"r":[
{
"s":"Sun Nov 1, 11:20 AM ET, gmail: ZZ_older_summary (doc dddddddd)"
}
],
"c":"rp-foot",
"fp":"a64faa01"
}
]
},
{
"c":"rp-sec",
"k":[
{
"r":[
{
"s":"Our reply to the client"
}
],
"c":"rp-h"
},
{
"r":[
{
"s":"ZZ_reply_owed_why."
}
],
"c":"rp-foot",
"fp":"df5a8011"
},
{
"r":[
{
"s":"1. ZZ_d1_title"
}
],
"c":"rp-dtitle"
},
{
"r":[
{
"s":"The change: ZZ_d1_diff"
}
],
"c":"rp-foot",
"fp":"a60a702a"
},
{
"c":"rp-mail",
"k":[
{
"r":[
{
"s":"ZZ_d1_subject",
"c":"rp-subj",
"fp":"95cba2fa"
},
{
"s":" "
},
{
"s":"👤 ",
"c":"rp-chip rp-warn rp-icon"
},
{
"s":"needs Rob's OK",
"c":"rp-chip rp-warn"
},
{
"s":" "
},
{
"s":"e1e1e1e1e1e1",
"c":"rp-chip rp-n rp-mono"
}
],
"c":"rp-mail-subj"
},
{
"c":"rp-mail-from",
"k":[
{
"r":[
{
"s":"ZD"
}
],
"c":"rp-av"
},
{
"c":"rp-grow",
"k":[
{
"r":[
{
"s":"zz_d1_from@massmarket.ai"
}
],
"c":"rp-from",
"fp":"e2bd06ae"
},
{
"r":[
{
"s":"To",
"c":"rp-k"
},
{
"s":" "
},
{
"s":"zz_d1_to@x.example",
"c":"rp-v",
"fp":"b9c594e7"
}
],
"c":"rp-hdr"
},
{
"r":[
{
"s":"Cc",
"c":"rp-k"
},
{
"s":" "
},
{
"s":"zz_d1_cc@x.example, support@letaidothehardwork.com, rob@massmarket.ai",
"c":"rp-v",
"fp":"2028ca06"
}
],
"c":"rp-hdr"
},
{
"r":[
{
"s":"Bcc",
"c":"rp-k"
},
{
"s":" "
},
{
"s":"zz_d1_bcc@x.example",
"c":"rp-v",
"fp":"1f33a60a"
}
],
"c":"rp-hdr"
},
{
"r":[
{
"s":"Attached",
"c":"rp-k"
},
{
"s":" "
},
{
"s":"ZZ_d1_attach.pdf",
"c":"rp-v",
"fp":"4927ecd3"
}
],
"c":"rp-hdr"
}
]
},
{
"r":[
{
"s":"in thread · gmail"
}
],
"c":"rp-when"
}
]
},
{
"r":[
{
"s":"Hi Dana, ZZ_d1_body yes ZZ_answer.\n\nSecond paragraph ZZ_d1_body2."
}
],
"c":"rp-body rp-mail-body",
"fp":"1d0a305c"
}
]
},
{
"r":[
{
"s":"3. ZZ_d3_title "
},
{
"s":"e3e3e3e3e3e3",
"c":"rp-chip rp-n rp-mono"
}
],
"c":"rp-dtitle"
},
{
"r":[
{
"s":"Kind: Text message · channel: highlevel_sms · location_id: ZZ_d3_location · contact_id: ZZ_d3_contact · to_phone: +15555550143 · to_name: ZZ_d3_name"
}
],
"c":"rp-foot",
"fp":"d6e38edc"
},
{
"r":[
{
"s":"The change: ZZ_d3_diff"
}
],
"c":"rp-foot",
"fp":"63472b00"
},
{
"c":"rp-phone rp-sms",
"k":[
{
"r":[
{
"s":"ZZ_d3_name · +1 555-555-0143 · HighLevel contact ZZ_d3_contact"
}
],
"c":"rp-phone-head"
},
{
"c":"rp-row rp-out",
"k":[
{
"r":[
{
"s":"ZZ_d3_sms_body"
}
],
"c":"rp-bub rp-bub-out",
"fp":"6de05c72"
},
{
"r":[
{
"s":"Our reply · sends on the go"
}
],
"c":"rp-bmeta"
}
]
}
]
},
{
"r":[
{
"s":"5. ZZ_d5_title"
}
],
"c":"rp-dtitle"
},
{
"r":[
{
"s":"Already sent Thu Nov 5, 7:00 AM ET by zz_sent_by@massmarket.ai (zz_sent_ref). One go does not send it again."
}
],
"c":"rp-foot",
"fp":"a56879e3"
},
{
"c":"rp-mail",
"k":[
{
"r":[
{
"s":"ZZ_d5_subject",
"c":"rp-subj",
"fp":"fabe4bae"
},
{
"s":" "
},
{
"s":"✓ ",
"c":"rp-chip rp-ok rp-icon"
},
{
"s":"already sent",
"c":"rp-chip rp-ok"
},
{
"s":" "
},
{
"s":"e5e5e5e5e5e5",
"c":"rp-chip rp-n rp-mono"
}
],
"c":"rp-mail-subj"
},
{
"c":"rp-mail-from",
"k":[
{
"r":[
{
"s":"?"
}
],
"c":"rp-av"
},
{
"c":"rp-grow",
"k":[
{
"r":[
{
"s":"(sender not named)"
}
],
"c":"rp-from",
"fp":"c8148d99"
},
{
"r":[
{
"s":"To",
"c":"rp-k"
},
{
"s":" "
},
{
"s":"zz_d5_to@x.example",
"c":"rp-v",
"fp":"8eff76f3"
}
],
"c":"rp-hdr"
},
{
"r":[
{
"s":"Cc",
"c":"rp-k"
},
{
"s":" "
},
{
"s":"(none)",
"c":"rp-v",
"fp":"90458a20"
}
],
"c":"rp-hdr"
}
]
},
{
"r":[
{
"s":"sent Thu Nov 5, 7:00 AM ET"
}
],
"c":"rp-when"
}
]
},
{
"r":[
{
"s":"ZZ_d5_body"
}
],
"c":"rp-body rp-mail-body",
"fp":"4c8b69be"
}
]
}
]
},
{
"c":"rp-sec",
"k":[
{
"r":[
{
"s":"Team post"
}
],
"c":"rp-h"
},
{
"r":[
{
"s":"2. ZZ_d2_title "
},
{
"s":"e2e2e2e2e2e2",
"c":"rp-chip rp-n rp-mono"
}
],
"c":"rp-dtitle"
},
{
"r":[
{
"s":"The change: ZZ_d2_diff"
}
],
"c":"rp-foot",
"fp":"f43d2641"
},
{
"c":"rp-dc",
"k":[
{
"r":[
{
"s":"900000000000000099",
"c":"rp-mono"
},
{
"s":" · reply to "
},
{
"s":"900000000000000077",
"c":"rp-mono"
}
],
"c":"rp-dc-chan"
},
{
"c":"rp-dc-msg",
"k":[
{
"c":"rp-grow",
"k":[
{
"r":[
{
"s":"Jarvis "
},
{
"s":"APP",
"c":"rp-dc-bot"
},
{
"s":" "
},
{
"s":"not posted yet",
"c":"rp-dc-ts"
}
],
"c":"rp-dc-name"
},
{
"r":[
{
"s":"Update from "
},
{
"s":"@900000…",
"c":"rp-mention",
"m":"900000000000000003"
},
{
"s":" ZZ_d2_body "
},
{
"s":"ZZ_d2_bold",
"c":"rp-b"
}
],
"c":"rp-body rp-dc-body",
"fp":"3eee0738"
},
{
"r":[
{
"s":"Must act: "
},
{
"s":"@900000…",
"c":"rp-mention",
"m":"900000000000000002"
},
{
"s":" · FYI: "
},
{
"s":"@900000…",
"c":"rp-mention",
"m":"900000000000000004"
},
{
"s":" · Owners: aaaaaaaa zz_ticket_owner@massmarket.ai"
}
],
"c":"rp-dc-meta"
}
]
}
]
}
]
}
]
},
{
"c":"rp-sec",
"k":[
{
"r":[
{
"s":"Other items"
}
],
"c":"rp-h"
},
{
"c":"rp-item",
"k":[
{
"c":"rp-item-head",
"k":[
{
"c":"rp-grow",
"k":[
{
"r":[
{
"s":"4. ZZ_d4_title"
}
],
"c":"rp-from"
},
{
"r":[
{
"s":"HighLevel change"
}
],
"c":"rp-sub"
}
]
},
{
"r":[
{
"s":"e4e4e4e4e4e4",
"c":"rp-chip rp-n rp-mono"
}
]
}
]
},
{
"r":[
{
"s":"Kind: HighLevel change · location_id: ZZ_d4_location · thing: ZZ_d4_thing"
}
],
"c":"rp-foot",
"fp":"aebabfa1"
},
{
"r":[
{
"s":"The change: ZZ_d4_diff"
}
],
"c":"rp-foot",
"fp":"ff247b9f"
},
{
"r":[
{
"s":"ZZ_d4_body"
}
],
"c":"rp-body rp-pre",
"fp":"705be2cb"
}
]
}
]
},
{
"c":"rp-sec",
"k":[
{
"r":[
{
"s":"Follow-ups, sent only if they have not replied"
}
],
"c":"rp-h"
},
{
"r":[
{
"s":"⚠ ",
"c":"rp-icon"
},
{
"s":"Dry run: none of these steps will send while follow-ups are in dry run. The go still schedules them, so chase by hand until follow-ups go live."
}
],
"c":"rp-banner rp-warn"
},
{
"r":[
{
"s":"Counting from zz_anchor@massmarket.ai's email of Nov 3."
}
],
"c":"rp-foot",
"fp":"7fadff35"
},
{
"r":[
{
"s":"Each one goes only if nothing has come from ZZ_fu_sms_name since our reply. Any reply, booking or payment cancels the rest, and their message gets a new package with its own follow-ups."
}
],
"c":"rp-foot",
"fp":"999d540e"
},
{
"r":[
{
"s":"Goal: ZZ_goal_action. Done when: ZZ_goal_done."
}
],
"c":"rp-foot",
"fp":"98cf1afe"
},
{
"c":"rp-tl",
"k":[
{
"c":"rp-li",
"k":[
{
"c":"rp-grow",
"k":[
{
"r":[
{
"s":"1. Email · 2 business days after our reply (Thu 11-05 if the reply goes today) · same thread"
}
],
"c":"rp-tl-head",
"fp":"6bc61770"
},
{
"r":[
{
"s":"From: zz_fu_from@massmarket.ai · To: zz_fu_to@x.example · Cc: zz_fu_cc@x.example, support@letaidothehardwork.com, rob@massmarket.ai"
}
],
"c":"rp-foot",
"fp":"62094d70"
},
{
"r":[
{
"s":"Subject: ZZ_fu_subject"
}
],
"c":"rp-foot",
"fp":"e1630888"
},
{
"r":[
{
"s":"ZZ_fu_email_body"
}
],
"c":"rp-body rp-quote",
"fp":"9bb4ec0d"
}
]
}
]
},
{
"c":"rp-li",
"k":[
{
"c":"rp-grow",
"k":[
{
"r":[
{
"s":"2. Text · 3 business days after our reply (Fri 11-06 if the reply goes today)"
}
],
"c":"rp-tl-head",
"fp":"4563e3c9"
},
{
"r":[
{
"s":"To: ZZ_fu_sms_name · HighLevel contact ZZ_fu_sms_contact · +1 555-555-0142"
}
],
"c":"rp-foot",
"fp":"5f02baa8"
},
{
"r":[
{
"s":"ZZ_fu_sms_body"
}
],
"c":"rp-bub rp-bub-out rp-inline",
"fp":"98333d92"
}
]
}
]
},
{
"c":"rp-li",
"k":[
{
"c":"rp-grow",
"k":[
{
"r":[
{
"s":"3. LinkedIn voice note · 4 business days after our reply (Mon 11-09 if the reply goes today) · Rob's seat"
}
],
"c":"rp-tl-head",
"fp":"8d60b4ef"
},
{
"r":[
{
"s":"To: https://linkedin.example/zz_li"
}
],
"c":"rp-foot",
"fp":"95f5bca6"
},
{
"r":[
{
"s":"Audio: not made yet, so this step cannot send. Make it before the go."
}
],
"c":"rp-foot",
"fp":"19ae004b"
},
{
"r":[
{
"s":"ZZ_fu_voice_body"
}
],
"c":"rp-body rp-quote",
"fp":"0589618f"
}
]
}
]
},
{
"c":"rp-li",
"k":[
{
"c":"rp-grow",
"k":[
{
"r":[
{
"s":"4. Call task for ZZ_assignee · 5 business days after our reply (Tue 11-10 if the reply goes today) · only if they still have not replied"
}
],
"c":"rp-tl-head",
"fp":"3c57dae0"
},
{
"r":[
{
"s":"Why a call: ZZ_fu_call_why"
}
],
"c":"rp-foot",
"fp":"f0759ed8"
},
{
"r":[
{
"s":"ZZ_fu_call_body"
}
],
"c":"rp-body rp-quote",
"fp":"66330e45"
}
]
}
]
}
]
},
{
"r":[
{
"s":"Not shown: 1 cancelled step (ZZ_cancel_reason). Cancelled steps never send."
}
],
"c":"rp-foot",
"fp":"f9d7195e"
}
]
},
{
"c":"rp-sec",
"k":[
{
"r":[
{
"s":"Every question answered?"
}
],
"c":"rp-h"
},
{
"c":"rp-q",
"k":[
{
"r":[
{
"s":"Q1",
"c":"rp-qn"
}
]
},
{
"c":"rp-grow",
"k":[
{
"r":[
{
"s":"ZZ_q1_quote is it live?"
}
],
"c":"rp-qa rp-qa-them",
"fp":"10a5091d"
},
{
"r":[
{
"s":"yes ZZ_answer"
}
],
"c":"rp-qa rp-qa-us",
"fp":"006fbc6b"
}
]
},
{
"r":[
{
"s":"✓ ",
"c":"rp-mark rp-ok rp-icon"
},
{
"s":"answered",
"c":"rp-mark rp-ok"
}
]
}
]
}
]
},
{
"c":"rp-sec",
"k":[
{
"r":[
{
"s":"ETA or proof for every open ticket?"
}
],
"c":"rp-h"
},
{
"c":"rp-q",
"k":[
{
"r":[
{
"s":"aaaaaaaa",
"c":"rp-qn rp-mono"
}
]
},
{
"c":"rp-grow",
"k":[
{
"r":[
{
"s":"ZZ_ticket_title"
}
],
"c":"rp-qa",
"fp":"004bd9b7"
},
{
"r":[
{
"s":"Owner: zz_owner@massmarket.ai · Reply says: \"ZZ_ticket_quote\""
}
],
"c":"rp-foot",
"fp":"882634e1"
}
]
},
{
"r":[
{
"s":"✓ ",
"c":"rp-mark rp-ok rp-icon"
},
{
"s":"ETA Thu Nov 12, 3 h",
"c":"rp-mark rp-ok"
}
]
}
]
},
{
"c":"rp-q",
"k":[
{
"r":[
{
"s":"aaaaaaaa",
"c":"rp-qn rp-mono"
}
]
},
{
"c":"rp-grow",
"k":[
{
"r":[
{
"s":"ZZ_ticket2_title"
}
],
"c":"rp-qa",
"fp":"5cafda09"
},
{
"r":[
{
"s":"Owner: zz_owner2@massmarket.ai"
}
],
"c":"rp-foot",
"fp":"a5c4dc20"
}
]
},
{
"r":[
{
"s":"✗ ",
"c":"rp-mark rp-bad rp-icon"
},
{
"s":"Missing",
"c":"rp-mark rp-bad"
}
]
}
]
},
{
"r":[
{
"s":"⛔ ",
"c":"rp-icon"
},
{
"s":"1 of 2 open tickets have no ETA, proof or named wait from their owner in the drafts as they stand."
}
],
"c":"rp-banner rp-bad"
},
{
"r":[
{
"s":"OW only records this for now (observe). Get it before the go anyway."
}
],
"c":"rp-foot"
}
]
},
{
"c":"rp-sec",
"k":[
{
"r":[
{
"s":"Added by the team"
}
],
"c":"rp-h"
},
{
"r":[
{
"s":"zz_contrib@massmarket.ai · Thu Nov 5, 12:00 PM ET"
}
],
"c":"rp-noteby"
},
{
"r":[
{
"s":"ZZ_contribution"
}
],
"c":"rp-body rp-quote",
"fp":"99b3bf34"
}
]
},
{
"c":"rp-sec",
"k":[
{
"r":[
{
"s":"Findings"
}
],
"c":"rp-h"
},
{
"c":"rp-find",
"k":[
{
"r":[
{
"s":"1 item(s) added by the team."
}
],
"c":"rp-find-what",
"fp":"26aef38a"
},
{
"r":[
{
"s":"Recommend",
"c":"rp-k"
},
{
"s":" "
},
{
"s":"fold them into the client reply before the go.",
"c":"rp-v",
"fp":"7707953c"
}
],
"c":"rp-rec"
}
]
},
{
"c":"rp-find",
"k":[
{
"r":[
{
"s":"Rob: ZZ_decision."
}
],
"c":"rp-find-what",
"fp":"26b7e349"
},
{
"r":[
{
"s":"Recommend",
"c":"rp-k"
},
{
"s":" "
},
{
"s":"ZZ_decision_rec.",
"c":"rp-v",
"fp":"9ab02741"
}
],
"c":"rp-rec"
}
]
},
{
"c":"rp-find",
"k":[
{
"r":[
{
"s":"Only Rob knows: ZZ_fact."
}
],
"c":"rp-find-what",
"fp":"9b27d975"
},
{
"r":[
{
"s":"Recommend",
"c":"rp-k"
},
{
"s":" "
},
{
"s":"ZZ_fact_rec.",
"c":"rp-v",
"fp":"e621d591"
}
],
"c":"rp-rec"
}
]
},
{
"c":"rp-find",
"k":[
{
"r":[
{
"s":"Concession in draft 1 (credit, $50): \"ZZ_concession_text\"."
}
],
"c":"rp-find-what",
"fp":"336ae546"
}
]
},
{
"c":"rp-find",
"k":[
{
"r":[
{
"s":"Flag (ZZ_flagkind): ZZ_flag."
}
],
"c":"rp-find-what",
"fp":"aea551d2"
}
]
},
{
"r":[
{
"s":"2 more in the JSON read (without format=pickup)."
}
],
"c":"rp-foot"
}
]
},
{
"c":"rp-sec",
"k":[
{
"r":[
{
"s":"Links"
}
],
"c":"rp-h"
},
{
"c":"rp-links",
"k":[
{
"r":[
{
"s":"ZZ_link_label: "
},
{
"s":"https://x.example/zz_link",
"href":"https://x.example/zz_link"
}
],
"c":"rp-li"
},
{
"r":[
{
"s":"ZZ_source_title: "
},
{
"s":"https://x.example/zz_source",
"href":"https://x.example/zz_source"
}
],
"c":"rp-li"
},
{
"r":[
{
"s":"Draft 1 attachment: p/zz_attach_path.pdf"
}
],
"c":"rp-li"
},
{
"r":[
{
"s":"Draft 4 document: "
},
{
"s":"https://drive.google.com/open?id=1abcdefghijklmnopqrstuvwxyz",
"href":"https://drive.google.com/open?id=1abcdefghijklmnopqrstuvwxyz"
}
],
"c":"rp-li"
},
{
"r":[
{
"s":"Draft 4 preview: "
},
{
"s":"https://x.example/zz_preview",
"href":"https://x.example/zz_preview"
}
],
"c":"rp-li"
},
{
"r":[
{
"s":"Draft 4 live site: "
},
{
"s":"https://x.example/zz_prod",
"href":"https://x.example/zz_prod"
}
],
"c":"rp-li"
},
{
"r":[
{
"s":"Draft 4 before: zz_before · after: zz_after"
}
],
"c":"rp-li"
},
{
"r":[
{
"s":"Draft 5 sent: zz_sent_ref"
}
],
"c":"rp-li"
}
]
}
]
},
{
"c":"rp-go",
"k":[
{
"r":[
{
"s":"One go sends all 4 items now and schedules 4 follow-ups. Package 3f1c9a7e5b2d."
}
],
"c":"rp-closing",
"fp":"5a1f9758"
},
{
"r":[
{
"s":"⚠ ",
"c":"rp-icon"
},
{
"s":"1 open ticket(s) have no ETA, proof or named wait"
}
],
"c":"rp-banner rp-warn"
},
{
"r":[
{
"s":"⚠ ",
"c":"rp-icon"
},
{
"s":"the last approval is stale: ZZ_stale_reason"
}
],
"c":"rp-banner rp-warn"
},
{
"r":[
{
"s":"⚠ ",
"c":"rp-icon"
},
{
"s":"needs Rob's OK: draft 1 (in Rob's session his go records it)"
}
],
"c":"rp-banner rp-warn"
},
{
"c":"rp-actions",
"k":[
{
"sign":{
"label":"3f1c9a7e5b2d",
"signer":"Test Signer"
}
}
]
}
]
}
]
}
},
"no reply":{
"page":"## ZZ_client (Dana) · reply package · Package `3f1c9a7e5b2d`\n\n### Every question answered?\n| # | They asked | Our reply says | |\n|---|---|---|---|\n| 1 | ZZ_q1_quote deferred? | — | Deferred: ZZ_q_reason |\n\n### Their message\nEverything since our last reply, Mon Nov 2, 7:00 AM ET: ZZ_went_out_what.\n\n#### ZZ_inb_from · Thu Nov 5, 10:00 AM ET · gmail\nTo: zz_inb_to@x.example · Cc: zz_inb_cc@x.example · Subject: ZZ_hdr_subject\n> ```text\n> Hi team, ZZ_inbound_email_words, is it live? And Saturday?\n> ```\n\n_Quoted history below this point was removed: it starts \"On Mon Nov 2 2026 Rob wrote: > old stuff ZZ_quoted_history\". Source: doc `dddddddd`._\n\n#### Dana · Thu Nov 5, 11:00 AM ET · call\nTheir words, an excerpt the package stored; the whole document is doc `dddddddd`:\n> ```text\n> ZZ_call_excerpt\n> ```\n\n#### Dana · Thu Nov 5, 11:20 AM ET · portal\n_Doc `dddddddd` (document) is not the message itself, and the package stored none of their words for it. Summary from the package: ZZ_nonmsg_summary_\n\n**Attachment** (Thu Nov 5, 11:10 AM ET): ZZ_attach_summary · our transcription is doc `dddddddd`\n\nEarlier messages, already answered by our last reply:\n- Sun Nov 1, 11:20 AM ET, gmail: ZZ_older_summary (doc `dddddddd`)\n\n### Suggestion: no reply needed\nZZ_no_reply_why.\n\n### Team post\n\n#### 2. ZZ_d2_title\n**Channel:** 900000000000000099 · **Must act:** <@900000000000000002> · **FYI:** <@900000000000000004> · **Owners:** `aaaaaaaa` zz_ticket_owner@massmarket.ai · **In reply to:** 900000000000000077 · hash `e2e2e2e2e2e2`\n**The change:** ZZ_d2_diff\n```text\nUpdate from <@900000000000000003> ZZ_d2_body **ZZ_d2_bold**\n```\n\n### Added by the team\n\n#### zz_contrib@massmarket.ai · Thu Nov 5, 12:00 PM ET\n> ```text\n> ZZ_contribution\n> ```\n\n### Proposed follow-ups\nDry run: none of these steps will send while follow-ups are in dry run. The go still schedules them, so chase by hand until follow-ups go live.\nCounting from zz_anchor@massmarket.ai's email of Nov 3.\nEach one goes only if nothing has come from ZZ_fu_sms_name since the go. Any reply, booking or payment cancels the rest, and their message gets a new package with its own follow-ups.\nGoal: ZZ_goal_action. Done when: ZZ_goal_done.\n\n**1. Email · 2 business days after the go (Thu 11-05 if the go is today) · same thread**\nFrom: zz_fu_from@massmarket.ai · To: zz_fu_to@x.example · Cc: zz_fu_cc@x.example, support@letaidothehardwork.com, rob@massmarket.ai\nSubject: ZZ_fu_subject\n> ```text\n> ZZ_fu_email_body\n> ```\n\n**2. Text · 3 business days after the go (Fri 11-06 if the go is today)**\nTo: ZZ_fu_sms_name · HighLevel contact ZZ_fu_sms_contact · +1 555-555-0142\n> ```text\n> ZZ_fu_sms_body\n> ```\n\n**3. LinkedIn voice note · 4 business days after the go (Mon 11-09 if the go is today) · Rob's seat**\nTo: https://linkedin.example/zz_li\nTranscript:\n> ```text\n> ZZ_fu_voice_body\n> ```\nAudio: not made yet, so this step cannot send. Make it before the go.\n\n**4. Call task for ZZ_assignee · 5 business days after the go (Tue 11-10 if the go is today) · only if they still have not replied**\nWhy a call: ZZ_fu_call_why\n> ```text\n> ZZ_fu_call_body\n> ```\n\nKeep them, or drop any of them at the go: either way the go closes this package with no reply.\n\nNot shown: 1 cancelled step (ZZ_cancel_reason). Cancelled steps never send.\n\n### Other items\n\n#### 4. ZZ_d4_title\n**Kind:** HighLevel change · **location_id:** ZZ_d4_location · **thing:** ZZ_d4_thing · hash `e4e4e4e4e4e4`\n**The change:** ZZ_d4_diff\n```text\nZZ_d4_body\n```\n\n### Links\n- ZZ_link_label: https://x.example/zz_link\n- ZZ_source_title: https://x.example/zz_source\n- Draft 4 document: https://drive.google.com/open?id=1abcdefghijklmnopqrstuvwxyz\n- Draft 4 preview: https://x.example/zz_preview\n- Draft 4 live site: https://x.example/zz_prod\n- Draft 4 before: `zz_before` · after: `zz_after`\n\n### Findings\n- 1 item(s) added by the team. Recommend: fold them into the client reply before the go.\n- Rob: ZZ_decision. Recommend: ZZ_decision_rec.\n- Only Rob knows: ZZ_fact. Recommend: ZZ_fact_rec.\n- Concession in draft 1 (credit, $50): \"ZZ_concession_text\".\n- Flag (ZZ_flagkind): ZZ_flag.\n_2 more in the JSON read (without format=pickup)._\n\nDeferred, not carried: the follow-ups keep running, and a client reply starts a new run. Questions: q1 (\"ZZ_q1_quote deferred?\").\nOne go sends all 2 items and schedules 4 follow-ups, then closes this package with no reply. Package `3f1c9a7e5b2d`.\n",
"tree":{
"v":1,
"package_id":"aaaaaaaa-1111-4222-8333-444444444444",
"project_id":"bbbbbbbb-1111-4222-8333-444444444444",
"client":"ZZ_client (Dana)",
"package_sha256":"3f1c9a7e5b2d4c6a8e0f1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f",
"label":"3f1c9a7e5b2d",
"blocks":51,
"signer":"Test Signer",
"can_sign":true,
"images":0,
"rendered_at":"2026-11-06T15:00:00Z",
"nodes":[
{
"c":"rp-head",
"k":[
{
"r":[
{
"s":"ZC"
}
],
"c":"rp-av rp-av-client"
},
{
"c":"rp-grow",
"k":[
{
"r":[
{
"s":"ZZ_client (Dana)"
}
],
"c":"rp-title"
},
{
"r":[
{
"s":"Reply package · "
},
{
"s":"3f1c9a7e5b2d",
"c":"rp-mono"
}
],
"c":"rp-sub"
}
]
},
{
"r":[
{
"s":"Green",
"c":"rp-chip rp-ok"
},
{
"s":" "
},
{
"s":"prepared",
"c":"rp-chip rp-n"
}
],
"c":"rp-chips"
}
]
},
{
"c":"rp-note",
"k":[
{
"r":[
{
"s":"ZZ_whats_new"
}
],
"c":"rp-whatsnew",
"fp":"f3dd1078"
}
]
},
{
"c":"rp-sec",
"k":[
{
"r":[
{
"s":"Their message"
}
],
"c":"rp-h"
},
{
"r":[
{
"s":"Everything since our last reply, Mon Nov 2, 7:00 AM ET: ZZ_went_out_what."
}
],
"c":"rp-foot",
"fp":"0200ba3a"
},
{
"c":"rp-mail",
"k":[
{
"r":[
{
"s":"ZZ_hdr_subject",
"c":"rp-subj",
"fp":"2ddbffb7"
}
],
"c":"rp-mail-subj"
},
{
"c":"rp-mail-from",
"k":[
{
"r":[
{
"s":"ZI"
}
],
"c":"rp-av"
},
{
"c":"rp-grow",
"k":[
{
"r":[
{
"s":"ZZ_inb_from"
}
],
"c":"rp-from",
"fp":"f9fbc4b6"
},
{
"r":[
{
"s":"To",
"c":"rp-k"
},
{
"s":" "
},
{
"s":"zz_inb_to@x.example",
"c":"rp-v",
"fp":"8a3a7eeb"
}
],
"c":"rp-hdr"
},
{
"r":[
{
"s":"Cc",
"c":"rp-k"
},
{
"s":" "
},
{
"s":"zz_inb_cc@x.example",
"c":"rp-v",
"fp":"2e02030c"
}
],
"c":"rp-hdr"
}
]
},
{
"r":[
{
"s":"Thu Nov 5, 10:00 AM ET · gmail"
}
],
"c":"rp-when"
}
]
},
{
"r":[
{
"s":"Hi team, ZZ_inbound_email_words, is it live? And Saturday?"
}
],
"c":"rp-body rp-mail-body",
"fp":"3048517f"
}
]
},
{
"r":[
{
"s":"Quoted history below this point was removed: it starts \"On Mon Nov 2 2026 Rob wrote: > old stuff ZZ_quoted_history\". Source: doc dddddddd."
}
],
"c":"rp-foot",
"fp":"caa98759"
},
{
"c":"rp-call",
"k":[
{
"c":"rp-call-head",
"k":[
{
"r":[
{
"s":"📞",
"c":"rp-icon"
}
]
},
{
"c":"rp-grow",
"k":[
{
"r":[
{
"s":"ZZ_call_title"
}
],
"c":"rp-from"
},
{
"r":[
{
"s":"Dana · Thu Nov 5, 11:00 AM ET · call · transcript · doc "
},
{
"s":"dddddddd",
"c":"rp-mono"
}
],
"c":"rp-sub"
}
]
}
]
},
{
"r":[
{
"s":"Their words, an excerpt the package stored; the whole document is doc dddddddd:"
}
],
"c":"rp-foot",
"fp":"58d9ba54"
},
{
"c":"rp-turn rp-turn-q",
"k":[
{
"r":[
{
"s":"Dana"
}
],
"c":"rp-turn-who rp-them"
},
{
"r":[
{
"s":"ZZ_call_excerpt"
}
],
"c":"rp-turn-text",
"fp":"2d51b9c4"
}
]
},
{
"btn":"Read the whole transcript ↗",
"ask":"Show me doc dddddddd from package 3f1c9a7e5b2d in full.",
"c":"rp-btn rp-btn-s"
}
]
},
{
"r":[
{
"s":"📎 ",
"c":"rp-icon"
},
{
"s":"Attachment (Thu Nov 5, 11:10 AM ET): ZZ_attach_summary · our transcription is doc dddddddd",
"c":"rp-v",
"fp":"0ec579ca"
}
],
"c":"rp-att"
},
{
"r":[
{
"s":"Dana · Thu Nov 5, 11:20 AM ET · portal"
}
],
"c":"rp-from",
"fp":"6ae8ebd1"
},
{
"r":[
{
"s":"Doc dddddddd (document) is not the message itself, and the package stored none of their words for it. Summary from the package: ZZ_nonmsg_summary"
}
],
"c":"rp-foot",
"fp":"cbd4e7e9"
},
{
"r":[
{
"s":"Earlier messages, already answered by our last reply:"
}
],
"c":"rp-foot"
},
{
"r":[
{
"s":"Sun Nov 1, 11:20 AM ET, gmail: ZZ_older_summary (doc dddddddd)"
}
],
"c":"rp-foot",
"fp":"a64faa01"
}
]
},
{
"c":"rp-sec",
"k":[
{
"r":[
{
"s":"Our reply to the client"
}
],
"c":"rp-h"
},
{
"r":[
{
"s":"⊘ ",
"c":"rp-icon"
},
{
"s":"Suggestion: no reply needed"
}
],
"c":"rp-banner rp-n"
},
{
"r":[
{
"s":"ZZ_no_reply_why."
}
],
"c":"rp-foot",
"fp":"7a10dc0f"
}
]
},
{
"c":"rp-sec",
"k":[
{
"r":[
{
"s":"Team post"
}
],
"c":"rp-h"
},
{
"r":[
{
"s":"2. ZZ_d2_title "
},
{
"s":"e2e2e2e2e2e2",
"c":"rp-chip rp-n rp-mono"
}
],
"c":"rp-dtitle"
},
{
"r":[
{
"s":"The change: ZZ_d2_diff"
}
],
"c":"rp-foot",
"fp":"f43d2641"
},
{
"c":"rp-dc",
"k":[
{
"r":[
{
"s":"900000000000000099",
"c":"rp-mono"
},
{
"s":" · reply to "
},
{
"s":"900000000000000077",
"c":"rp-mono"
}
],
"c":"rp-dc-chan"
},
{
"c":"rp-dc-msg",
"k":[
{
"c":"rp-grow",
"k":[
{
"r":[
{
"s":"Jarvis "
},
{
"s":"APP",
"c":"rp-dc-bot"
},
{
"s":" "
},
{
"s":"not posted yet",
"c":"rp-dc-ts"
}
],
"c":"rp-dc-name"
},
{
"r":[
{
"s":"Update from "
},
{
"s":"@900000…",
"c":"rp-mention",
"m":"900000000000000003"
},
{
"s":" ZZ_d2_body "
},
{
"s":"ZZ_d2_bold",
"c":"rp-b"
}
],
"c":"rp-body rp-dc-body",
"fp":"3eee0738"
},
{
"r":[
{
"s":"Must act: "
},
{
"s":"@900000…",
"c":"rp-mention",
"m":"900000000000000002"
},
{
"s":" · FYI: "
},
{
"s":"@900000…",
"c":"rp-mention",
"m":"900000000000000004"
},
{
"s":" · Owners: aaaaaaaa zz_ticket_owner@massmarket.ai"
}
],
"c":"rp-dc-meta"
}
]
}
]
}
]
}
]
},
{
"c":"rp-sec",
"k":[
{
"r":[
{
"s":"Other items"
}
],
"c":"rp-h"
},
{
"c":"rp-item",
"k":[
{
"c":"rp-item-head",
"k":[
{
"c":"rp-grow",
"k":[
{
"r":[
{
"s":"4. ZZ_d4_title"
}
],
"c":"rp-from"
},
{
"r":[
{
"s":"HighLevel change"
}
],
"c":"rp-sub"
}
]
},
{
"r":[
{
"s":"e4e4e4e4e4e4",
"c":"rp-chip rp-n rp-mono"
}
]
}
]
},
{
"r":[
{
"s":"Kind: HighLevel change · location_id: ZZ_d4_location · thing: ZZ_d4_thing"
}
],
"c":"rp-foot",
"fp":"aebabfa1"
},
{
"r":[
{
"s":"The change: ZZ_d4_diff"
}
],
"c":"rp-foot",
"fp":"ff247b9f"
},
{
"r":[
{
"s":"ZZ_d4_body"
}
],
"c":"rp-body rp-pre",
"fp":"705be2cb"
}
]
}
]
},
{
"c":"rp-sec",
"k":[
{
"r":[
{
"s":"Proposed follow-ups"
}
],
"c":"rp-h"
},
{
"r":[
{
"s":"⚠ ",
"c":"rp-icon"
},
{
"s":"Dry run: none of these steps will send while follow-ups are in dry run. The go still schedules them, so chase by hand until follow-ups go live."
}
],
"c":"rp-banner rp-warn"
},
{
"r":[
{
"s":"Counting from zz_anchor@massmarket.ai's email of Nov 3."
}
],
"c":"rp-foot",
"fp":"7fadff35"
},
{
"r":[
{
"s":"Each one goes only if nothing has come from ZZ_fu_sms_name since the go. Any reply, booking or payment cancels the rest, and their message gets a new package with its own follow-ups."
}
],
"c":"rp-foot",
"fp":"bfba30d9"
},
{
"r":[
{
"s":"Goal: ZZ_goal_action. Done when: ZZ_goal_done."
}
],
"c":"rp-foot",
"fp":"98cf1afe"
},
{
"c":"rp-tl",
"k":[
{
"c":"rp-li",
"k":[
{
"c":"rp-grow",
"k":[
{
"r":[
{
"s":"1. Email · 2 business days after the go (Thu 11-05 if the go is today) · same thread"
}
],
"c":"rp-tl-head",
"fp":"89e317db"
},
{
"r":[
{
"s":"From: zz_fu_from@massmarket.ai · To: zz_fu_to@x.example · Cc: zz_fu_cc@x.example, support@letaidothehardwork.com, rob@massmarket.ai"
}
],
"c":"rp-foot",
"fp":"62094d70"
},
{
"r":[
{
"s":"Subject: ZZ_fu_subject"
}
],
"c":"rp-foot",
"fp":"e1630888"
},
{
"r":[
{
"s":"ZZ_fu_email_body"
}
],
"c":"rp-body rp-quote",
"fp":"9bb4ec0d"
}
]
}
]
},
{
"c":"rp-li",
"k":[
{
"c":"rp-grow",
"k":[
{
"r":[
{
"s":"2. Text · 3 business days after the go (Fri 11-06 if the go is today)"
}
],
"c":"rp-tl-head",
"fp":"0968a492"
},
{
"r":[
{
"s":"To: ZZ_fu_sms_name · HighLevel contact ZZ_fu_sms_contact · +1 555-555-0142"
}
],
"c":"rp-foot",
"fp":"5f02baa8"
},
{
"r":[
{
"s":"ZZ_fu_sms_body"
}
],
"c":"rp-bub rp-bub-out rp-inline",
"fp":"98333d92"
}
]
}
]
},
{
"c":"rp-li",
"k":[
{
"c":"rp-grow",
"k":[
{
"r":[
{
"s":"3. LinkedIn voice note · 4 business days after the go (Mon 11-09 if the go is today) · Rob's seat"
}
],
"c":"rp-tl-head",
"fp":"d31260a4"
},
{
"r":[
{
"s":"To: https://linkedin.example/zz_li"
}
],
"c":"rp-foot",
"fp":"95f5bca6"
},
{
"r":[
{
"s":"Audio: not made yet, so this step cannot send. Make it before the go."
}
],
"c":"rp-foot",
"fp":"19ae004b"
},
{
"r":[
{
"s":"ZZ_fu_voice_body"
}
],
"c":"rp-body rp-quote",
"fp":"0589618f"
}
]
}
]
},
{
"c":"rp-li",
"k":[
{
"c":"rp-grow",
"k":[
{
"r":[
{
"s":"4. Call task for ZZ_assignee · 5 business days after the go (Tue 11-10 if the go is today) · only if they still have not replied"
}
],
"c":"rp-tl-head",
"fp":"0dfe90a9"
},
{
"r":[
{
"s":"Why a call: ZZ_fu_call_why"
}
],
"c":"rp-foot",
"fp":"f0759ed8"
},
{
"r":[
{
"s":"ZZ_fu_call_body"
}
],
"c":"rp-body rp-quote",
"fp":"66330e45"
}
]
}
]
}
]
},
{
"r":[
{
"s":"Keep them, or drop any of them at the go: either way the go closes this package with no reply."
}
],
"c":"rp-foot"
},
{
"r":[
{
"s":"Not shown: 1 cancelled step (ZZ_cancel_reason). Cancelled steps never send."
}
],
"c":"rp-foot",
"fp":"f9d7195e"
}
]
},
{
"c":"rp-sec",
"k":[
{
"r":[
{
"s":"Every question answered?"
}
],
"c":"rp-h"
},
{
"c":"rp-q",
"k":[
{
"r":[
{
"s":"Q1",
"c":"rp-qn"
}
]
},
{
"c":"rp-grow",
"k":[
{
"r":[
{
"s":"ZZ_q1_quote deferred?"
}
],
"c":"rp-qa rp-qa-them",
"fp":"62c4562b"
},
{
"r":[
{
"s":"Deferred: ZZ_q_reason"
}
],
"c":"rp-foot",
"fp":"33e92c69"
}
]
},
{
"r":[
{
"s":"– ",
"c":"rp-mark rp-n rp-icon"
},
{
"s":"Deferred",
"c":"rp-mark rp-n"
}
]
}
]
}
]
},
{
"c":"rp-sec",
"k":[
{
"r":[
{
"s":"Added by the team"
}
],
"c":"rp-h"
},
{
"r":[
{
"s":"zz_contrib@massmarket.ai · Thu Nov 5, 12:00 PM ET"
}
],
"c":"rp-noteby"
},
{
"r":[
{
"s":"ZZ_contribution"
}
],
"c":"rp-body rp-quote",
"fp":"99b3bf34"
}
]
},
{
"c":"rp-sec",
"k":[
{
"r":[
{
"s":"Findings"
}
],
"c":"rp-h"
},
{
"c":"rp-find",
"k":[
{
"r":[
{
"s":"1 item(s) added by the team."
}
],
"c":"rp-find-what",
"fp":"26aef38a"
},
{
"r":[
{
"s":"Recommend",
"c":"rp-k"
},
{
"s":" "
},
{
"s":"fold them into the client reply before the go.",
"c":"rp-v",
"fp":"7707953c"
}
],
"c":"rp-rec"
}
]
},
{
"c":"rp-find",
"k":[
{
"r":[
{
"s":"Rob: ZZ_decision."
}
],
"c":"rp-find-what",
"fp":"26b7e349"
},
{
"r":[
{
"s":"Recommend",
"c":"rp-k"
},
{
"s":" "
},
{
"s":"ZZ_decision_rec.",
"c":"rp-v",
"fp":"9ab02741"
}
],
"c":"rp-rec"
}
]
},
{
"c":"rp-find",
"k":[
{
"r":[
{
"s":"Only Rob knows: ZZ_fact."
}
],
"c":"rp-find-what",
"fp":"9b27d975"
},
{
"r":[
{
"s":"Recommend",
"c":"rp-k"
},
{
"s":" "
},
{
"s":"ZZ_fact_rec.",
"c":"rp-v",
"fp":"e621d591"
}
],
"c":"rp-rec"
}
]
},
{
"c":"rp-find",
"k":[
{
"r":[
{
"s":"Concession in draft 1 (credit, $50): \"ZZ_concession_text\"."
}
],
"c":"rp-find-what",
"fp":"336ae546"
}
]
},
{
"c":"rp-find",
"k":[
{
"r":[
{
"s":"Flag (ZZ_flagkind): ZZ_flag."
}
],
"c":"rp-find-what",
"fp":"aea551d2"
}
]
},
{
"r":[
{
"s":"2 more in the JSON read (without format=pickup)."
}
],
"c":"rp-foot"
}
]
},
{
"c":"rp-sec",
"k":[
{
"r":[
{
"s":"Links"
}
],
"c":"rp-h"
},
{
"c":"rp-links",
"k":[
{
"r":[
{
"s":"ZZ_link_label: "
},
{
"s":"https://x.example/zz_link",
"href":"https://x.example/zz_link"
}
],
"c":"rp-li"
},
{
"r":[
{
"s":"ZZ_source_title: "
},
{
"s":"https://x.example/zz_source",
"href":"https://x.example/zz_source"
}
],
"c":"rp-li"
},
{
"r":[
{
"s":"Draft 4 document: "
},
{
"s":"https://drive.google.com/open?id=1abcdefghijklmnopqrstuvwxyz",
"href":"https://drive.google.com/open?id=1abcdefghijklmnopqrstuvwxyz"
}
],
"c":"rp-li"
},
{
"r":[
{
"s":"Draft 4 preview: "
},
{
"s":"https://x.example/zz_preview",
"href":"https://x.example/zz_preview"
}
],
"c":"rp-li"
},
{
"r":[
{
"s":"Draft 4 live site: "
},
{
"s":"https://x.example/zz_prod",
"href":"https://x.example/zz_prod"
}
],
"c":"rp-li"
},
{
"r":[
{
"s":"Draft 4 before: zz_before · after: zz_after"
}
],
"c":"rp-li"
}
]
}
]
},
{
"c":"rp-go",
"k":[
{
"r":[
{
"s":"Deferred, not carried: the follow-ups keep running, and a client reply starts a new run. Questions: q1 (\"ZZ_q1_quote deferred?\")."
}
],
"c":"rp-banner rp-warn",
"fp":"89a4cba2"
},
{
"r":[
{
"s":"One go sends all 2 items and schedules 4 follow-ups, then closes this package with no reply. Package 3f1c9a7e5b2d."
}
],
"c":"rp-closing",
"fp":"1b702373"
},
{
"r":[
{
"s":"⚠ ",
"c":"rp-icon"
},
{
"s":"the last approval is stale: ZZ_stale_reason"
}
],
"c":"rp-banner rp-warn"
},
{
"c":"rp-actions",
"k":[
{
"sign":{
"label":"3f1c9a7e5b2d",
"signer":"Test Signer"
}
}
]
}
]
}
]
}
},
"closed no reply":{
"page":"## ZZ_client (Dana) · reply package · Package `3f1c9a7e5b2d`\n\n### Every question answered?\n| # | They asked | Our reply says | |\n|---|---|---|---|\n| 1 | ZZ_q1_quote deferred? | — | Deferred: ZZ_q_reason |\n\n### Their message\nEverything since our last reply, Mon Nov 2, 7:00 AM ET: ZZ_went_out_what.\n\n#### ZZ_inb_from · Thu Nov 5, 10:00 AM ET · gmail\nTo: zz_inb_to@x.example · Cc: zz_inb_cc@x.example · Subject: ZZ_hdr_subject\n> ```text\n> Hi team, ZZ_inbound_email_words, is it live? And Saturday?\n> ```\n\n_Quoted history below this point was removed: it starts \"On Mon Nov 2 2026 Rob wrote: > old stuff ZZ_quoted_history\". Source: doc `dddddddd`._\n\n#### Dana · Thu Nov 5, 11:00 AM ET · call\nTheir words, an excerpt the package stored; the whole document is doc `dddddddd`:\n> ```text\n> ZZ_call_excerpt\n> ```\n\n#### Dana · Thu Nov 5, 11:20 AM ET · portal\n_Doc `dddddddd` (document) is not the message itself, and the package stored none of their words for it. Summary from the package: ZZ_nonmsg_summary_\n\n**Attachment** (Thu Nov 5, 11:10 AM ET): ZZ_attach_summary · our transcription is doc `dddddddd`\n\nEarlier messages, already answered by our last reply:\n- Sun Nov 1, 11:20 AM ET, gmail: ZZ_older_summary (doc `dddddddd`)\n\n### Suggestion: no reply needed\nZZ_no_reply_why.\n\n### Team post\n\n#### 2. ZZ_d2_title\n**Channel:** 900000000000000099 · **Must act:** <@900000000000000002> · **FYI:** <@900000000000000004> · **Owners:** `aaaaaaaa` zz_ticket_owner@massmarket.ai · **In reply to:** 900000000000000077 · hash `e2e2e2e2e2e2`\n**The change:** ZZ_d2_diff\n```text\nUpdate from <@900000000000000003> ZZ_d2_body **ZZ_d2_bold**\n```\n\n### Added by the team\n\n#### zz_contrib@massmarket.ai · Thu Nov 5, 12:00 PM ET\n> ```text\n> ZZ_contribution\n> ```\n\n### Proposed follow-ups\nDry run: none of these steps will send while follow-ups are in dry run. The go still schedules them, so chase by hand until follow-ups go live.\nCounting from zz_anchor@massmarket.ai's email of Nov 3.\nEach one goes only if nothing has come from ZZ_fu_sms_name since the go. Any reply, booking or payment cancels the rest, and their message gets a new package with its own follow-ups.\nGoal: ZZ_goal_action. Done when: ZZ_goal_done.\n\n**1. Email · 2 business days after the go (Thu 11-05 if the go is today) · same thread**\nFrom: zz_fu_from@massmarket.ai · To: zz_fu_to@x.example · Cc: zz_fu_cc@x.example, support@letaidothehardwork.com, rob@massmarket.ai\nSubject: ZZ_fu_subject\n> ```text\n> ZZ_fu_email_body\n> ```\n\n**2. Text · 3 business days after the go (Fri 11-06 if the go is today)**\nTo: ZZ_fu_sms_name · HighLevel contact ZZ_fu_sms_contact · +1 555-555-0142\n> ```text\n> ZZ_fu_sms_body\n> ```\n\n**3. LinkedIn voice note · 4 business days after the go (Mon 11-09 if the go is today) · Rob's seat**\nTo: https://linkedin.example/zz_li\nTranscript:\n> ```text\n> ZZ_fu_voice_body\n> ```\nAudio: not made yet, so this step cannot send. Make it before the go.\n\n**4. Call task for ZZ_assignee · 5 business days after the go (Tue 11-10 if the go is today) · only if they still have not replied**\nWhy a call: ZZ_fu_call_why\n> ```text\n> ZZ_fu_call_body\n> ```\n\nNot shown: 1 cancelled step (ZZ_cancel_reason). Cancelled steps never send.\n\n### Other items\n\n#### 4. ZZ_d4_title\n**Kind:** HighLevel change · **location_id:** ZZ_d4_location · **thing:** ZZ_d4_thing · hash `e4e4e4e4e4e4`\n**The change:** ZZ_d4_diff\n```text\nZZ_d4_body\n```\n\n### Links\n- ZZ_link_label: https://x.example/zz_link\n- ZZ_source_title: https://x.example/zz_source\n- Draft 4 document: https://drive.google.com/open?id=1abcdefghijklmnopqrstuvwxyz\n- Draft 4 preview: https://x.example/zz_preview\n- Draft 4 live site: https://x.example/zz_prod\n- Draft 4 before: `zz_before` · after: `zz_after`\n\n### Findings\n- 1 item(s) added by the team. Recommend: fold them into the client reply before the go.\n- Rob: ZZ_decision. Recommend: ZZ_decision_rec.\n- Only Rob knows: ZZ_fact. Recommend: ZZ_fact_rec.\n- Concession in draft 1 (credit, $50): \"ZZ_concession_text\".\n- Flag (ZZ_flagkind): ZZ_flag.\n_2 more in the JSON read (without format=pickup)._\n\nClosed: no reply needed.\n",
"tree":{
"v":1,
"package_id":"aaaaaaaa-1111-4222-8333-444444444444",
"project_id":"bbbbbbbb-1111-4222-8333-444444444444",
"client":"ZZ_client (Dana)",
"package_sha256":"3f1c9a7e5b2d4c6a8e0f1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f",
"label":"3f1c9a7e5b2d",
"blocks":50,
"signer":"Test Signer",
"can_sign":false,
"images":0,
"rendered_at":"2026-11-06T15:00:00Z",
"nodes":[
{
"c":"rp-head",
"k":[
{
"r":[
{
"s":"ZC"
}
],
"c":"rp-av rp-av-client"
},
{
"c":"rp-grow",
"k":[
{
"r":[
{
"s":"ZZ_client (Dana)"
}
],
"c":"rp-title"
},
{
"r":[
{
"s":"Reply package · "
},
{
"s":"3f1c9a7e5b2d",
"c":"rp-mono"
}
],
"c":"rp-sub"
}
]
},
{
"r":[
{
"s":"Green",
"c":"rp-chip rp-ok"
},
{
"s":" "
},
{
"s":"no reply owed",
"c":"rp-chip rp-n"
}
],
"c":"rp-chips"
}
]
},
{
"c":"rp-note",
"k":[
{
"r":[
{
"s":"ZZ_whats_new"
}
],
"c":"rp-whatsnew",
"fp":"f3dd1078"
}
]
},
{
"c":"rp-sec",
"k":[
{
"r":[
{
"s":"Their message"
}
],
"c":"rp-h"
},
{
"r":[
{
"s":"Everything since our last reply, Mon Nov 2, 7:00 AM ET: ZZ_went_out_what."
}
],
"c":"rp-foot",
"fp":"0200ba3a"
},
{
"c":"rp-mail",
"k":[
{
"r":[
{
"s":"ZZ_hdr_subject",
"c":"rp-subj",
"fp":"2ddbffb7"
}
],
"c":"rp-mail-subj"
},
{
"c":"rp-mail-from",
"k":[
{
"r":[
{
"s":"ZI"
}
],
"c":"rp-av"
},
{
"c":"rp-grow",
"k":[
{
"r":[
{
"s":"ZZ_inb_from"
}
],
"c":"rp-from",
"fp":"f9fbc4b6"
},
{
"r":[
{
"s":"To",
"c":"rp-k"
},
{
"s":" "
},
{
"s":"zz_inb_to@x.example",
"c":"rp-v",
"fp":"8a3a7eeb"
}
],
"c":"rp-hdr"
},
{
"r":[
{
"s":"Cc",
"c":"rp-k"
},
{
"s":" "
},
{
"s":"zz_inb_cc@x.example",
"c":"rp-v",
"fp":"2e02030c"
}
],
"c":"rp-hdr"
}
]
},
{
"r":[
{
"s":"Thu Nov 5, 10:00 AM ET · gmail"
}
],
"c":"rp-when"
}
]
},
{
"r":[
{
"s":"Hi team, ZZ_inbound_email_words, is it live? And Saturday?"
}
],
"c":"rp-body rp-mail-body",
"fp":"3048517f"
}
]
},
{
"r":[
{
"s":"Quoted history below this point was removed: it starts \"On Mon Nov 2 2026 Rob wrote: > old stuff ZZ_quoted_history\". Source: doc dddddddd."
}
],
"c":"rp-foot",
"fp":"caa98759"
},
{
"c":"rp-call",
"k":[
{
"c":"rp-call-head",
"k":[
{
"r":[
{
"s":"📞",
"c":"rp-icon"
}
]
},
{
"c":"rp-grow",
"k":[
{
"r":[
{
"s":"ZZ_call_title"
}
],
"c":"rp-from"
},
{
"r":[
{
"s":"Dana · Thu Nov 5, 11:00 AM ET · call · transcript · doc "
},
{
"s":"dddddddd",
"c":"rp-mono"
}
],
"c":"rp-sub"
}
]
}
]
},
{
"r":[
{
"s":"Their words, an excerpt the package stored; the whole document is doc dddddddd:"
}
],
"c":"rp-foot",
"fp":"58d9ba54"
},
{
"c":"rp-turn rp-turn-q",
"k":[
{
"r":[
{
"s":"Dana"
}
],
"c":"rp-turn-who rp-them"
},
{
"r":[
{
"s":"ZZ_call_excerpt"
}
],
"c":"rp-turn-text",
"fp":"2d51b9c4"
}
]
},
{
"btn":"Read the whole transcript ↗",
"ask":"Show me doc dddddddd from package 3f1c9a7e5b2d in full.",
"c":"rp-btn rp-btn-s"
}
]
},
{
"r":[
{
"s":"📎 ",
"c":"rp-icon"
},
{
"s":"Attachment (Thu Nov 5, 11:10 AM ET): ZZ_attach_summary · our transcription is doc dddddddd",
"c":"rp-v",
"fp":"0ec579ca"
}
],
"c":"rp-att"
},
{
"r":[
{
"s":"Dana · Thu Nov 5, 11:20 AM ET · portal"
}
],
"c":"rp-from",
"fp":"6ae8ebd1"
},
{
"r":[
{
"s":"Doc dddddddd (document) is not the message itself, and the package stored none of their words for it. Summary from the package: ZZ_nonmsg_summary"
}
],
"c":"rp-foot",
"fp":"cbd4e7e9"
},
{
"r":[
{
"s":"Earlier messages, already answered by our last reply:"
}
],
"c":"rp-foot"
},
{
"r":[
{
"s":"Sun Nov 1, 11:20 AM ET, gmail: ZZ_older_summary (doc dddddddd)"
}
],
"c":"rp-foot",
"fp":"a64faa01"
}
]
},
{
"c":"rp-sec",
"k":[
{
"r":[
{
"s":"Our reply to the client"
}
],
"c":"rp-h"
},
{
"r":[
{
"s":"⊘ ",
"c":"rp-icon"
},
{
"s":"Suggestion: no reply needed"
}
],
"c":"rp-banner rp-n"
},
{
"r":[
{
"s":"ZZ_no_reply_why."
}
],
"c":"rp-foot",
"fp":"7a10dc0f"
}
]
},
{
"c":"rp-sec",
"k":[
{
"r":[
{
"s":"Team post"
}
],
"c":"rp-h"
},
{
"r":[
{
"s":"2. ZZ_d2_title "
},
{
"s":"e2e2e2e2e2e2",
"c":"rp-chip rp-n rp-mono"
}
],
"c":"rp-dtitle"
},
{
"r":[
{
"s":"The change: ZZ_d2_diff"
}
],
"c":"rp-foot",
"fp":"f43d2641"
},
{
"c":"rp-dc",
"k":[
{
"r":[
{
"s":"900000000000000099",
"c":"rp-mono"
},
{
"s":" · reply to "
},
{
"s":"900000000000000077",
"c":"rp-mono"
}
],
"c":"rp-dc-chan"
},
{
"c":"rp-dc-msg",
"k":[
{
"c":"rp-grow",
"k":[
{
"r":[
{
"s":"Jarvis "
},
{
"s":"APP",
"c":"rp-dc-bot"
},
{
"s":" "
},
{
"s":"not posted yet",
"c":"rp-dc-ts"
}
],
"c":"rp-dc-name"
},
{
"r":[
{
"s":"Update from "
},
{
"s":"@900000…",
"c":"rp-mention",
"m":"900000000000000003"
},
{
"s":" ZZ_d2_body "
},
{
"s":"ZZ_d2_bold",
"c":"rp-b"
}
],
"c":"rp-body rp-dc-body",
"fp":"3eee0738"
},
{
"r":[
{
"s":"Must act: "
},
{
"s":"@900000…",
"c":"rp-mention",
"m":"900000000000000002"
},
{
"s":" · FYI: "
},
{
"s":"@900000…",
"c":"rp-mention",
"m":"900000000000000004"
},
{
"s":" · Owners: aaaaaaaa zz_ticket_owner@massmarket.ai"
}
],
"c":"rp-dc-meta"
}
]
}
]
}
]
}
]
},
{
"c":"rp-sec",
"k":[
{
"r":[
{
"s":"Other items"
}
],
"c":"rp-h"
},
{
"c":"rp-item",
"k":[
{
"c":"rp-item-head",
"k":[
{
"c":"rp-grow",
"k":[
{
"r":[
{
"s":"4. ZZ_d4_title"
}
],
"c":"rp-from"
},
{
"r":[
{
"s":"HighLevel change"
}
],
"c":"rp-sub"
}
]
},
{
"r":[
{
"s":"e4e4e4e4e4e4",
"c":"rp-chip rp-n rp-mono"
}
]
}
]
},
{
"r":[
{
"s":"Kind: HighLevel change · location_id: ZZ_d4_location · thing: ZZ_d4_thing"
}
],
"c":"rp-foot",
"fp":"aebabfa1"
},
{
"r":[
{
"s":"The change: ZZ_d4_diff"
}
],
"c":"rp-foot",
"fp":"ff247b9f"
},
{
"r":[
{
"s":"ZZ_d4_body"
}
],
"c":"rp-body rp-pre",
"fp":"705be2cb"
}
]
}
]
},
{
"c":"rp-sec",
"k":[
{
"r":[
{
"s":"Proposed follow-ups"
}
],
"c":"rp-h"
},
{
"r":[
{
"s":"⚠ ",
"c":"rp-icon"
},
{
"s":"Dry run: none of these steps will send while follow-ups are in dry run. The go still schedules them, so chase by hand until follow-ups go live."
}
],
"c":"rp-banner rp-warn"
},
{
"r":[
{
"s":"Counting from zz_anchor@massmarket.ai's email of Nov 3."
}
],
"c":"rp-foot",
"fp":"7fadff35"
},
{
"r":[
{
"s":"Each one goes only if nothing has come from ZZ_fu_sms_name since the go. Any reply, booking or payment cancels the rest, and their message gets a new package with its own follow-ups."
}
],
"c":"rp-foot",
"fp":"bfba30d9"
},
{
"r":[
{
"s":"Goal: ZZ_goal_action. Done when: ZZ_goal_done."
}
],
"c":"rp-foot",
"fp":"98cf1afe"
},
{
"c":"rp-tl",
"k":[
{
"c":"rp-li",
"k":[
{
"c":"rp-grow",
"k":[
{
"r":[
{
"s":"1. Email · 2 business days after the go (Thu 11-05 if the go is today) · same thread"
}
],
"c":"rp-tl-head",
"fp":"89e317db"
},
{
"r":[
{
"s":"From: zz_fu_from@massmarket.ai · To: zz_fu_to@x.example · Cc: zz_fu_cc@x.example, support@letaidothehardwork.com, rob@massmarket.ai"
}
],
"c":"rp-foot",
"fp":"62094d70"
},
{
"r":[
{
"s":"Subject: ZZ_fu_subject"
}
],
"c":"rp-foot",
"fp":"e1630888"
},
{
"r":[
{
"s":"ZZ_fu_email_body"
}
],
"c":"rp-body rp-quote",
"fp":"9bb4ec0d"
}
]
}
]
},
{
"c":"rp-li",
"k":[
{
"c":"rp-grow",
"k":[
{
"r":[
{
"s":"2. Text · 3 business days after the go (Fri 11-06 if the go is today)"
}
],
"c":"rp-tl-head",
"fp":"0968a492"
},
{
"r":[
{
"s":"To: ZZ_fu_sms_name · HighLevel contact ZZ_fu_sms_contact · +1 555-555-0142"
}
],
"c":"rp-foot",
"fp":"5f02baa8"
},
{
"r":[
{
"s":"ZZ_fu_sms_body"
}
],
"c":"rp-bub rp-bub-out rp-inline",
"fp":"98333d92"
}
]
}
]
},
{
"c":"rp-li",
"k":[
{
"c":"rp-grow",
"k":[
{
"r":[
{
"s":"3. LinkedIn voice note · 4 business days after the go (Mon 11-09 if the go is today) · Rob's seat"
}
],
"c":"rp-tl-head",
"fp":"d31260a4"
},
{
"r":[
{
"s":"To: https://linkedin.example/zz_li"
}
],
"c":"rp-foot",
"fp":"95f5bca6"
},
{
"r":[
{
"s":"Audio: not made yet, so this step cannot send. Make it before the go."
}
],
"c":"rp-foot",
"fp":"19ae004b"
},
{
"r":[
{
"s":"ZZ_fu_voice_body"
}
],
"c":"rp-body rp-quote",
"fp":"0589618f"
}
]
}
]
},
{
"c":"rp-li",
"k":[
{
"c":"rp-grow",
"k":[
{
"r":[
{
"s":"4. Call task for ZZ_assignee · 5 business days after the go (Tue 11-10 if the go is today) · only if they still have not replied"
}
],
"c":"rp-tl-head",
"fp":"0dfe90a9"
},
{
"r":[
{
"s":"Why a call: ZZ_fu_call_why"
}
],
"c":"rp-foot",
"fp":"f0759ed8"
},
{
"r":[
{
"s":"ZZ_fu_call_body"
}
],
"c":"rp-body rp-quote",
"fp":"66330e45"
}
]
}
]
}
]
},
{
"r":[
{
"s":"Not shown: 1 cancelled step (ZZ_cancel_reason). Cancelled steps never send."
}
],
"c":"rp-foot",
"fp":"f9d7195e"
}
]
},
{
"c":"rp-sec",
"k":[
{
"r":[
{
"s":"Every question answered?"
}
],
"c":"rp-h"
},
{
"c":"rp-q",
"k":[
{
"r":[
{
"s":"Q1",
"c":"rp-qn"
}
]
},
{
"c":"rp-grow",
"k":[
{
"r":[
{
"s":"ZZ_q1_quote deferred?"
}
],
"c":"rp-qa rp-qa-them",
"fp":"62c4562b"
},
{
"r":[
{
"s":"Deferred: ZZ_q_reason"
}
],
"c":"rp-foot",
"fp":"33e92c69"
}
]
},
{
"r":[
{
"s":"– ",
"c":"rp-mark rp-n rp-icon"
},
{
"s":"Deferred",
"c":"rp-mark rp-n"
}
]
}
]
}
]
},
{
"c":"rp-sec",
"k":[
{
"r":[
{
"s":"Added by the team"
}
],
"c":"rp-h"
},
{
"r":[
{
"s":"zz_contrib@massmarket.ai · Thu Nov 5, 12:00 PM ET"
}
],
"c":"rp-noteby"
},
{
"r":[
{
"s":"ZZ_contribution"
}
],
"c":"rp-body rp-quote",
"fp":"99b3bf34"
}
]
},
{
"c":"rp-sec",
"k":[
{
"r":[
{
"s":"Findings"
}
],
"c":"rp-h"
},
{
"c":"rp-find",
"k":[
{
"r":[
{
"s":"1 item(s) added by the team."
}
],
"c":"rp-find-what",
"fp":"26aef38a"
},
{
"r":[
{
"s":"Recommend",
"c":"rp-k"
},
{
"s":" "
},
{
"s":"fold them into the client reply before the go.",
"c":"rp-v",
"fp":"7707953c"
}
],
"c":"rp-rec"
}
]
},
{
"c":"rp-find",
"k":[
{
"r":[
{
"s":"Rob: ZZ_decision."
}
],
"c":"rp-find-what",
"fp":"26b7e349"
},
{
"r":[
{
"s":"Recommend",
"c":"rp-k"
},
{
"s":" "
},
{
"s":"ZZ_decision_rec.",
"c":"rp-v",
"fp":"9ab02741"
}
],
"c":"rp-rec"
}
]
},
{
"c":"rp-find",
"k":[
{
"r":[
{
"s":"Only Rob knows: ZZ_fact."
}
],
"c":"rp-find-what",
"fp":"9b27d975"
},
{
"r":[
{
"s":"Recommend",
"c":"rp-k"
},
{
"s":" "
},
{
"s":"ZZ_fact_rec.",
"c":"rp-v",
"fp":"e621d591"
}
],
"c":"rp-rec"
}
]
},
{
"c":"rp-find",
"k":[
{
"r":[
{
"s":"Concession in draft 1 (credit, $50): \"ZZ_concession_text\"."
}
],
"c":"rp-find-what",
"fp":"336ae546"
}
]
},
{
"c":"rp-find",
"k":[
{
"r":[
{
"s":"Flag (ZZ_flagkind): ZZ_flag."
}
],
"c":"rp-find-what",
"fp":"aea551d2"
}
]
},
{
"r":[
{
"s":"2 more in the JSON read (without format=pickup)."
}
],
"c":"rp-foot"
}
]
},
{
"c":"rp-sec",
"k":[
{
"r":[
{
"s":"Links"
}
],
"c":"rp-h"
},
{
"c":"rp-links",
"k":[
{
"r":[
{
"s":"ZZ_link_label: "
},
{
"s":"https://x.example/zz_link",
"href":"https://x.example/zz_link"
}
],
"c":"rp-li"
},
{
"r":[
{
"s":"ZZ_source_title: "
},
{
"s":"https://x.example/zz_source",
"href":"https://x.example/zz_source"
}
],
"c":"rp-li"
},
{
"r":[
{
"s":"Draft 4 document: "
},
{
"s":"https://drive.google.com/open?id=1abcdefghijklmnopqrstuvwxyz",
"href":"https://drive.google.com/open?id=1abcdefghijklmnopqrstuvwxyz"
}
],
"c":"rp-li"
},
{
"r":[
{
"s":"Draft 4 preview: "
},
{
"s":"https://x.example/zz_preview",
"href":"https://x.example/zz_preview"
}
],
"c":"rp-li"
},
{
"r":[
{
"s":"Draft 4 live site: "
},
{
"s":"https://x.example/zz_prod",
"href":"https://x.example/zz_prod"
}
],
"c":"rp-li"
},
{
"r":[
{
"s":"Draft 4 before: zz_before · after: zz_after"
}
],
"c":"rp-li"
}
]
}
]
},
{
"c":"rp-go",
"k":[
{
"r":[
{
"s":"Closed: no reply needed."
}
],
"c":"rp-closing",
"fp":"83289771"
}
]
}
]
}
},
"later messages":{
"page":"## ZZ_client (Dana) · reply package · Package `3f1c9a7e5b2d`\n\n### Every question answered?\n| # | They asked | Our reply says | |\n|---|---|---|---|\n| 1 | ZZ_q1_quote is it live? | \"yes ZZ_answer\" | ✅ |\n\n### ETA or proof for every open ticket?\n| # | Ticket | Owner | The reply gives | Our reply says |\n|---|---|---|---|---|\n| 1 | `aaaaaaaa` ZZ_ticket_title | zz_owner@massmarket.ai | ETA Thu Nov 12, 3 h | \"ZZ_ticket_quote\" |\n| 2 | `aaaaaaaa` ZZ_ticket2_title | zz_owner2@massmarket.ai | ⛔ Missing | — |\n\n⛔ 1 of 2 open tickets have no ETA, proof or named wait from their owner in the drafts as they stand.\nOW only records this for now (observe). Get it before the go anyway.\n\n### Their message\nEverything since our last reply, Mon Nov 2, 7:00 AM ET: ZZ_went_out_what.\n\n#### ZZ_inb_from · Thu Nov 5, 10:00 AM ET · gmail\nTo: zz_inb_to@x.example · Cc: zz_inb_cc@x.example · Subject: ZZ_hdr_subject\n> ```text\n> Hi team, ZZ_inbound_email_words, is it live? And Saturday?\n> ```\n\n_Quoted history below this point was removed: it starts \"On Mon Nov 2 2026 Rob wrote: > old stuff ZZ_quoted_history\". Source: doc `dddddddd`._\n\n#### Dana · Thu Nov 5, 11:00 AM ET · call\nTheir words, an excerpt the package stored; the whole document is doc `dddddddd`:\n> ```text\n> ZZ_call_excerpt\n> ```\n\n#### Dana · Thu Nov 5, 11:20 AM ET · portal\n_Doc `dddddddd` (document) is not the message itself, and the package stored none of their words for it. Summary from the package: ZZ_nonmsg_summary_\n\n**Attachment** (Thu Nov 5, 11:10 AM ET): ZZ_attach_summary · our transcription is doc `dddddddd`\n\n#### Dana · Thu Nov 5, 1:00 PM ET · sms · arrived after these drafts were written\n_An excerpt only._\n> ```text\n> ZZ_nm_excerpt\n> ```\n\nEarlier messages, already answered by our last reply:\n- Sun Nov 1, 11:20 AM ET, gmail: ZZ_older_summary (doc `dddddddd`)\n\n### Client reply\nZZ_reply_owed_why.\n\n#### 1. ZZ_d1_title\n**To:** zz_d1_to@x.example · **Cc:** zz_d1_cc@x.example, support@letaidothehardwork.com, rob@massmarket.ai · **Subject:** ZZ_d1_subject · **From:** zz_d1_from@massmarket.ai · **Channel:** gmail · hash `e1e1e1e1e1e1` · ⚠️ needs Rob's OK\n**The change:** ZZ_d1_diff\n```text\nHi Dana, ZZ_d1_body yes ZZ_answer.\n\nSecond paragraph ZZ_d1_body2.\n```\n\n#### 5. ZZ_d5_title\n_Already sent Thu Nov 5, 7:00 AM ET by zz_sent_by@massmarket.ai (zz_sent_ref). One go does not send it again._\n\n### Team post\n\n#### 2. ZZ_d2_title\n**Channel:** 900000000000000099 · **Must act:** <@900000000000000002> · **FYI:** <@900000000000000004> · **Owners:** `aaaaaaaa` zz_ticket_owner@massmarket.ai · **In reply to:** 900000000000000077 · hash `e2e2e2e2e2e2`\n**The change:** ZZ_d2_diff\n```text\nUpdate from <@900000000000000003> ZZ_d2_body **ZZ_d2_bold**\n```\n\n### Added by the team\n\n#### zz_contrib@massmarket.ai · Thu Nov 5, 12:00 PM ET\n> ```text\n> ZZ_contribution\n> ```\n\n### Follow-ups (sent only if they have not replied)\nDry run: none of these steps will send while follow-ups are in dry run. The go still schedules them, so chase by hand until follow-ups go live.\nCounting from zz_anchor@massmarket.ai's email of Nov 3.\nEach one goes only if nothing has come from ZZ_fu_sms_name since our reply. Any reply, booking or payment cancels the rest, and their message gets a new package with its own follow-ups.\nGoal: ZZ_goal_action. Done when: ZZ_goal_done.\n\n**1. Email · 2 business days after our reply (Thu 11-05 if the reply goes today) · same thread**\nFrom: zz_fu_from@massmarket.ai · To: zz_fu_to@x.example · Cc: zz_fu_cc@x.example, support@letaidothehardwork.com, rob@massmarket.ai\nSubject: ZZ_fu_subject\n> ```text\n> ZZ_fu_email_body\n> ```\n\n**2. Text · 3 business days after our reply (Fri 11-06 if the reply goes today)**\nTo: ZZ_fu_sms_name · HighLevel contact ZZ_fu_sms_contact · +1 555-555-0142\n> ```text\n> ZZ_fu_sms_body\n> ```\n\n**3. LinkedIn voice note · 4 business days after our reply (Mon 11-09 if the reply goes today) · Rob's seat**\nTo: https://linkedin.example/zz_li\nTranscript:\n> ```text\n> ZZ_fu_voice_body\n> ```\nAudio: not made yet, so this step cannot send. Make it before the go.\n\n**4. Call task for ZZ_assignee · 5 business days after our reply (Tue 11-10 if the reply goes today) · only if they still have not replied**\nWhy a call: ZZ_fu_call_why\n> ```text\n> ZZ_fu_call_body\n> ```\n\nNot shown: 1 cancelled step (ZZ_cancel_reason). Cancelled steps never send.\n\n### Other items\n\n#### 3. ZZ_d3_title\n**Kind:** Text message · **channel:** highlevel_sms · **location_id:** ZZ_d3_location · **contact_id:** ZZ_d3_contact · **to_phone:** +15555550143 · **to_name:** ZZ_d3_name · hash `e3e3e3e3e3e3`\n**The change:** ZZ_d3_diff\n```text\nZZ_d3_sms_body\n```\n\n#### 4. ZZ_d4_title\n**Kind:** HighLevel change · **location_id:** ZZ_d4_location · **thing:** ZZ_d4_thing · hash `e4e4e4e4e4e4`\n**The change:** ZZ_d4_diff\n```text\nZZ_d4_body\n```\n\n### Links\n- ZZ_link_label: https://x.example/zz_link\n- ZZ_source_title: https://x.example/zz_source\n- Draft 1 attachment: `p/zz_attach_path.pdf`\n- Draft 4 document: https://drive.google.com/open?id=1abcdefghijklmnopqrstuvwxyz\n- Draft 4 preview: https://x.example/zz_preview\n- Draft 4 live site: https://x.example/zz_prod\n- Draft 4 before: `zz_before` · after: `zz_after`\n- Draft 5 sent: `zz_sent_ref`\n\n### Findings\n- 1 item(s) added by the team. Recommend: fold them into the client reply before the go.\n- Rob: ZZ_decision. Recommend: ZZ_decision_rec.\n- Only Rob knows: ZZ_fact. Recommend: ZZ_fact_rec.\n- New since the drafts were written: ZZ_nm_new.\n- New since the drafts were written.\n_4 more in the JSON read (without format=pickup)._\n\nOne go sends all 4 items now and schedules 4 follow-ups. Package `3f1c9a7e5b2d`.\n",
"tree":{
"v":1,
"package_id":"aaaaaaaa-1111-4222-8333-444444444444",
"project_id":"bbbbbbbb-1111-4222-8333-444444444444",
"client":"ZZ_client (Dana)",
"package_sha256":"3f1c9a7e5b2d4c6a8e0f1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f",
"label":"3f1c9a7e5b2d",
"blocks":72,
"signer":"Test Signer",
"can_sign":false,
"images":0,
"rendered_at":"2026-11-06T15:00:00Z",
"nodes":[
{
"c":"rp-head",
"k":[
{
"r":[
{
"s":"ZC"
}
],
"c":"rp-av rp-av-client"
},
{
"c":"rp-grow",
"k":[
{
"r":[
{
"s":"ZZ_client (Dana)"
}
],
"c":"rp-title"
},
{
"r":[
{
"s":"Reply package · "
},
{
"s":"3f1c9a7e5b2d",
"c":"rp-mono"
}
],
"c":"rp-sub"
}
]
},
{
"r":[
{
"s":"Green",
"c":"rp-chip rp-ok"
},
{
"s":" "
},
{
"s":"prepared",
"c":"rp-chip rp-n"
}
],
"c":"rp-chips"
}
]
},
{
"c":"rp-note",
"k":[
{
"r":[
{
"s":"ZZ_whats_new"
}
],
"c":"rp-whatsnew",
"fp":"f3dd1078"
}
]
},
{
"c":"rp-sec",
"k":[
{
"r":[
{
"s":"Their message"
}
],
"c":"rp-h"
},
{
"r":[
{
"s":"Everything since our last reply, Mon Nov 2, 7:00 AM ET: ZZ_went_out_what."
}
],
"c":"rp-foot",
"fp":"0200ba3a"
},
{
"c":"rp-mail",
"k":[
{
"r":[
{
"s":"ZZ_hdr_subject",
"c":"rp-subj",
"fp":"2ddbffb7"
}
],
"c":"rp-mail-subj"
},
{
"c":"rp-mail-from",
"k":[
{
"r":[
{
"s":"ZI"
}
],
"c":"rp-av"
},
{
"c":"rp-grow",
"k":[
{
"r":[
{
"s":"ZZ_inb_from"
}
],
"c":"rp-from",
"fp":"f9fbc4b6"
},
{
"r":[
{
"s":"To",
"c":"rp-k"
},
{
"s":" "
},
{
"s":"zz_inb_to@x.example",
"c":"rp-v",
"fp":"8a3a7eeb"
}
],
"c":"rp-hdr"
},
{
"r":[
{
"s":"Cc",
"c":"rp-k"
},
{
"s":" "
},
{
"s":"zz_inb_cc@x.example",
"c":"rp-v",
"fp":"2e02030c"
}
],
"c":"rp-hdr"
}
]
},
{
"r":[
{
"s":"Thu Nov 5, 10:00 AM ET · gmail"
}
],
"c":"rp-when"
}
]
},
{
"r":[
{
"s":"Hi team, ZZ_inbound_email_words, is it live? And Saturday?"
}
],
"c":"rp-body rp-mail-body",
"fp":"3048517f"
}
]
},
{
"r":[
{
"s":"Quoted history below this point was removed: it starts \"On Mon Nov 2 2026 Rob wrote: > old stuff ZZ_quoted_history\". Source: doc dddddddd."
}
],
"c":"rp-foot",
"fp":"caa98759"
},
{
"c":"rp-call",
"k":[
{
"c":"rp-call-head",
"k":[
{
"r":[
{
"s":"📞",
"c":"rp-icon"
}
]
},
{
"c":"rp-grow",
"k":[
{
"r":[
{
"s":"ZZ_call_title"
}
],
"c":"rp-from"
},
{
"r":[
{
"s":"Dana · Thu Nov 5, 11:00 AM ET · call · transcript · doc "
},
{
"s":"dddddddd",
"c":"rp-mono"
}
],
"c":"rp-sub"
}
]
}
]
},
{
"r":[
{
"s":"Their words, an excerpt the package stored; the whole document is doc dddddddd:"
}
],
"c":"rp-foot",
"fp":"58d9ba54"
},
{
"c":"rp-turn rp-turn-q",
"k":[
{
"r":[
{
"s":"Dana"
}
],
"c":"rp-turn-who rp-them"
},
{
"r":[
{
"s":"ZZ_call_excerpt"
}
],
"c":"rp-turn-text",
"fp":"2d51b9c4"
}
]
},
{
"btn":"Read the whole transcript ↗",
"ask":"Show me doc dddddddd from package 3f1c9a7e5b2d in full.",
"c":"rp-btn rp-btn-s"
}
]
},
{
"r":[
{
"s":"📎 ",
"c":"rp-icon"
},
{
"s":"Attachment (Thu Nov 5, 11:10 AM ET): ZZ_attach_summary · our transcription is doc dddddddd",
"c":"rp-v",
"fp":"0ec579ca"
}
],
"c":"rp-att"
},
{
"r":[
{
"s":"Dana · Thu Nov 5, 11:20 AM ET · portal"
}
],
"c":"rp-from",
"fp":"6ae8ebd1"
},
{
"r":[
{
"s":"Doc dddddddd (document) is not the message itself, and the package stored none of their words for it. Summary from the package: ZZ_nonmsg_summary"
}
],
"c":"rp-foot",
"fp":"cbd4e7e9"
},
{
"r":[
{
"s":"⚠ ",
"c":"rp-icon"
},
{
"s":"Dana · Thu Nov 5, 1:00 PM ET · sms · arrived after these drafts were written"
}
],
"c":"rp-banner rp-warn"
},
{
"r":[
{
"s":"An excerpt only."
}
],
"c":"rp-foot"
},
{
"r":[
{
"s":"ZZ_nm_excerpt"
}
],
"c":"rp-body rp-quote",
"fp":"a88fac29"
},
{
"r":[
{
"s":"Earlier messages, already answered by our last reply:"
}
],
"c":"rp-foot"
},
{
"r":[
{
"s":"Sun Nov 1, 11:20 AM ET, gmail: ZZ_older_summary (doc dddddddd)"
}
],
"c":"rp-foot",
"fp":"a64faa01"
}
]
},
{
"c":"rp-sec",
"k":[
{
"r":[
{
"s":"Our reply to the client"
}
],
"c":"rp-h"
},
{
"r":[
{
"s":"ZZ_reply_owed_why."
}
],
"c":"rp-foot",
"fp":"df5a8011"
},
{
"r":[
{
"s":"1. ZZ_d1_title"
}
],
"c":"rp-dtitle"
},
{
"r":[
{
"s":"The change: ZZ_d1_diff"
}
],
"c":"rp-foot",
"fp":"a60a702a"
},
{
"c":"rp-mail",
"k":[
{
"r":[
{
"s":"ZZ_d1_subject",
"c":"rp-subj",
"fp":"95cba2fa"
},
{
"s":" "
},
{
"s":"👤 ",
"c":"rp-chip rp-warn rp-icon"
},
{
"s":"needs Rob's OK",
"c":"rp-chip rp-warn"
},
{
"s":" "
},
{
"s":"e1e1e1e1e1e1",
"c":"rp-chip rp-n rp-mono"
}
],
"c":"rp-mail-subj"
},
{
"c":"rp-mail-from",
"k":[
{
"r":[
{
"s":"ZD"
}
],
"c":"rp-av"
},
{
"c":"rp-grow",
"k":[
{
"r":[
{
"s":"zz_d1_from@massmarket.ai"
}
],
"c":"rp-from",
"fp":"e2bd06ae"
},
{
"r":[
{
"s":"To",
"c":"rp-k"
},
{
"s":" "
},
{
"s":"zz_d1_to@x.example",
"c":"rp-v",
"fp":"b9c594e7"
}
],
"c":"rp-hdr"
},
{
"r":[
{
"s":"Cc",
"c":"rp-k"
},
{
"s":" "
},
{
"s":"zz_d1_cc@x.example, support@letaidothehardwork.com, rob@massmarket.ai",
"c":"rp-v",
"fp":"2028ca06"
}
],
"c":"rp-hdr"
},
{
"r":[
{
"s":"Bcc",
"c":"rp-k"
},
{
"s":" "
},
{
"s":"zz_d1_bcc@x.example",
"c":"rp-v",
"fp":"1f33a60a"
}
],
"c":"rp-hdr"
},
{
"r":[
{
"s":"Attached",
"c":"rp-k"
},
{
"s":" "
},
{
"s":"ZZ_d1_attach.pdf",
"c":"rp-v",
"fp":"4927ecd3"
}
],
"c":"rp-hdr"
}
]
},
{
"r":[
{
"s":"in thread · gmail"
}
],
"c":"rp-when"
}
]
},
{
"r":[
{
"s":"Hi Dana, ZZ_d1_body yes ZZ_answer.\n\nSecond paragraph ZZ_d1_body2."
}
],
"c":"rp-body rp-mail-body",
"fp":"1d0a305c"
}
]
},
{
"r":[
{
"s":"3. ZZ_d3_title "
},
{
"s":"e3e3e3e3e3e3",
"c":"rp-chip rp-n rp-mono"
}
],
"c":"rp-dtitle"
},
{
"r":[
{
"s":"Kind: Text message · channel: highlevel_sms · location_id: ZZ_d3_location · contact_id: ZZ_d3_contact · to_phone: +15555550143 · to_name: ZZ_d3_name"
}
],
"c":"rp-foot",
"fp":"d6e38edc"
},
{
"r":[
{
"s":"The change: ZZ_d3_diff"
}
],
"c":"rp-foot",
"fp":"63472b00"
},
{
"c":"rp-phone rp-sms",
"k":[
{
"r":[
{
"s":"ZZ_d3_name · +1 555-555-0143 · HighLevel contact ZZ_d3_contact"
}
],
"c":"rp-phone-head"
},
{
"c":"rp-row rp-out",
"k":[
{
"r":[
{
"s":"ZZ_d3_sms_body"
}
],
"c":"rp-bub rp-bub-out",
"fp":"6de05c72"
},
{
"r":[
{
"s":"Our reply · sends on the go"
}
],
"c":"rp-bmeta"
}
]
}
]
},
{
"r":[
{
"s":"5. ZZ_d5_title"
}
],
"c":"rp-dtitle"
},
{
"r":[
{
"s":"Already sent Thu Nov 5, 7:00 AM ET by zz_sent_by@massmarket.ai (zz_sent_ref). One go does not send it again."
}
],
"c":"rp-foot",
"fp":"a56879e3"
},
{
"c":"rp-mail",
"k":[
{
"r":[
{
"s":"ZZ_d5_subject",
"c":"rp-subj",
"fp":"fabe4bae"
},
{
"s":" "
},
{
"s":"✓ ",
"c":"rp-chip rp-ok rp-icon"
},
{
"s":"already sent",
"c":"rp-chip rp-ok"
},
{
"s":" "
},
{
"s":"e5e5e5e5e5e5",
"c":"rp-chip rp-n rp-mono"
}
],
"c":"rp-mail-subj"
},
{
"c":"rp-mail-from",
"k":[
{
"r":[
{
"s":"?"
}
],
"c":"rp-av"
},
{
"c":"rp-grow",
"k":[
{
"r":[
{
"s":"(sender not named)"
}
],
"c":"rp-from",
"fp":"c8148d99"
},
{
"r":[
{
"s":"To",
"c":"rp-k"
},
{
"s":" "
},
{
"s":"zz_d5_to@x.example",
"c":"rp-v",
"fp":"8eff76f3"
}
],
"c":"rp-hdr"
},
{
"r":[
{
"s":"Cc",
"c":"rp-k"
},
{
"s":" "
},
{
"s":"(none)",
"c":"rp-v",
"fp":"90458a20"
}
],
"c":"rp-hdr"
}
]
},
{
"r":[
{
"s":"sent Thu Nov 5, 7:00 AM ET"
}
],
"c":"rp-when"
}
]
},
{
"r":[
{
"s":"ZZ_d5_body"
}
],
"c":"rp-body rp-mail-body",
"fp":"4c8b69be"
}
]
}
]
},
{
"c":"rp-sec",
"k":[
{
"r":[
{
"s":"Team post"
}
],
"c":"rp-h"
},
{
"r":[
{
"s":"2. ZZ_d2_title "
},
{
"s":"e2e2e2e2e2e2",
"c":"rp-chip rp-n rp-mono"
}
],
"c":"rp-dtitle"
},
{
"r":[
{
"s":"The change: ZZ_d2_diff"
}
],
"c":"rp-foot",
"fp":"f43d2641"
},
{
"c":"rp-dc",
"k":[
{
"r":[
{
"s":"900000000000000099",
"c":"rp-mono"
},
{
"s":" · reply to "
},
{
"s":"900000000000000077",
"c":"rp-mono"
}
],
"c":"rp-dc-chan"
},
{
"c":"rp-dc-msg",
"k":[
{
"c":"rp-grow",
"k":[
{
"r":[
{
"s":"Jarvis "
},
{
"s":"APP",
"c":"rp-dc-bot"
},
{
"s":" "
},
{
"s":"not posted yet",
"c":"rp-dc-ts"
}
],
"c":"rp-dc-name"
},
{
"r":[
{
"s":"Update from "
},
{
"s":"@900000…",
"c":"rp-mention",
"m":"900000000000000003"
},
{
"s":" ZZ_d2_body "
},
{
"s":"ZZ_d2_bold",
"c":"rp-b"
}
],
"c":"rp-body rp-dc-body",
"fp":"3eee0738"
},
{
"r":[
{
"s":"Must act: "
},
{
"s":"@900000…",
"c":"rp-mention",
"m":"900000000000000002"
},
{
"s":" · FYI: "
},
{
"s":"@900000…",
"c":"rp-mention",
"m":"900000000000000004"
},
{
"s":" · Owners: aaaaaaaa zz_ticket_owner@massmarket.ai"
}
],
"c":"rp-dc-meta"
}
]
}
]
}
]
}
]
},
{
"c":"rp-sec",
"k":[
{
"r":[
{
"s":"Other items"
}
],
"c":"rp-h"
},
{
"c":"rp-item",
"k":[
{
"c":"rp-item-head",
"k":[
{
"c":"rp-grow",
"k":[
{
"r":[
{
"s":"4. ZZ_d4_title"
}
],
"c":"rp-from"
},
{
"r":[
{
"s":"HighLevel change"
}
],
"c":"rp-sub"
}
]
},
{
"r":[
{
"s":"e4e4e4e4e4e4",
"c":"rp-chip rp-n rp-mono"
}
]
}
]
},
{
"r":[
{
"s":"Kind: HighLevel change · location_id: ZZ_d4_location · thing: ZZ_d4_thing"
}
],
"c":"rp-foot",
"fp":"aebabfa1"
},
{
"r":[
{
"s":"The change: ZZ_d4_diff"
}
],
"c":"rp-foot",
"fp":"ff247b9f"
},
{
"r":[
{
"s":"ZZ_d4_body"
}
],
"c":"rp-body rp-pre",
"fp":"705be2cb"
}
]
}
]
},
{
"c":"rp-sec",
"k":[
{
"r":[
{
"s":"Follow-ups, sent only if they have not replied"
}
],
"c":"rp-h"
},
{
"r":[
{
"s":"⚠ ",
"c":"rp-icon"
},
{
"s":"Dry run: none of these steps will send while follow-ups are in dry run. The go still schedules them, so chase by hand until follow-ups go live."
}
],
"c":"rp-banner rp-warn"
},
{
"r":[
{
"s":"Counting from zz_anchor@massmarket.ai's email of Nov 3."
}
],
"c":"rp-foot",
"fp":"7fadff35"
},
{
"r":[
{
"s":"Each one goes only if nothing has come from ZZ_fu_sms_name since our reply. Any reply, booking or payment cancels the rest, and their message gets a new package with its own follow-ups."
}
],
"c":"rp-foot",
"fp":"999d540e"
},
{
"r":[
{
"s":"Goal: ZZ_goal_action. Done when: ZZ_goal_done."
}
],
"c":"rp-foot",
"fp":"98cf1afe"
},
{
"c":"rp-tl",
"k":[
{
"c":"rp-li",
"k":[
{
"c":"rp-grow",
"k":[
{
"r":[
{
"s":"1. Email · 2 business days after our reply (Thu 11-05 if the reply goes today) · same thread"
}
],
"c":"rp-tl-head",
"fp":"6bc61770"
},
{
"r":[
{
"s":"From: zz_fu_from@massmarket.ai · To: zz_fu_to@x.example · Cc: zz_fu_cc@x.example, support@letaidothehardwork.com, rob@massmarket.ai"
}
],
"c":"rp-foot",
"fp":"62094d70"
},
{
"r":[
{
"s":"Subject: ZZ_fu_subject"
}
],
"c":"rp-foot",
"fp":"e1630888"
},
{
"r":[
{
"s":"ZZ_fu_email_body"
}
],
"c":"rp-body rp-quote",
"fp":"9bb4ec0d"
}
]
}
]
},
{
"c":"rp-li",
"k":[
{
"c":"rp-grow",
"k":[
{
"r":[
{
"s":"2. Text · 3 business days after our reply (Fri 11-06 if the reply goes today)"
}
],
"c":"rp-tl-head",
"fp":"4563e3c9"
},
{
"r":[
{
"s":"To: ZZ_fu_sms_name · HighLevel contact ZZ_fu_sms_contact · +1 555-555-0142"
}
],
"c":"rp-foot",
"fp":"5f02baa8"
},
{
"r":[
{
"s":"ZZ_fu_sms_body"
}
],
"c":"rp-bub rp-bub-out rp-inline",
"fp":"98333d92"
}
]
}
]
},
{
"c":"rp-li",
"k":[
{
"c":"rp-grow",
"k":[
{
"r":[
{
"s":"3. LinkedIn voice note · 4 business days after our reply (Mon 11-09 if the reply goes today) · Rob's seat"
}
],
"c":"rp-tl-head",
"fp":"8d60b4ef"
},
{
"r":[
{
"s":"To: https://linkedin.example/zz_li"
}
],
"c":"rp-foot",
"fp":"95f5bca6"
},
{
"r":[
{
"s":"Audio: not made yet, so this step cannot send. Make it before the go."
}
],
"c":"rp-foot",
"fp":"19ae004b"
},
{
"r":[
{
"s":"ZZ_fu_voice_body"
}
],
"c":"rp-body rp-quote",
"fp":"0589618f"
}
]
}
]
},
{
"c":"rp-li",
"k":[
{
"c":"rp-grow",
"k":[
{
"r":[
{
"s":"4. Call task for ZZ_assignee · 5 business days after our reply (Tue 11-10 if the reply goes today) · only if they still have not replied"
}
],
"c":"rp-tl-head",
"fp":"3c57dae0"
},
{
"r":[
{
"s":"Why a call: ZZ_fu_call_why"
}
],
"c":"rp-foot",
"fp":"f0759ed8"
},
{
"r":[
{
"s":"ZZ_fu_call_body"
}
],
"c":"rp-body rp-quote",
"fp":"66330e45"
}
]
}
]
}
]
},
{
"r":[
{
"s":"Not shown: 1 cancelled step (ZZ_cancel_reason). Cancelled steps never send."
}
],
"c":"rp-foot",
"fp":"f9d7195e"
}
]
},
{
"c":"rp-sec",
"k":[
{
"r":[
{
"s":"Every question answered?"
}
],
"c":"rp-h"
},
{
"c":"rp-q",
"k":[
{
"r":[
{
"s":"Q1",
"c":"rp-qn"
}
]
},
{
"c":"rp-grow",
"k":[
{
"r":[
{
"s":"ZZ_q1_quote is it live?"
}
],
"c":"rp-qa rp-qa-them",
"fp":"10a5091d"
},
{
"r":[
{
"s":"yes ZZ_answer"
}
],
"c":"rp-qa rp-qa-us",
"fp":"006fbc6b"
}
]
},
{
"r":[
{
"s":"✓ ",
"c":"rp-mark rp-ok rp-icon"
},
{
"s":"answered",
"c":"rp-mark rp-ok"
}
]
}
]
}
]
},
{
"c":"rp-sec",
"k":[
{
"r":[
{
"s":"ETA or proof for every open ticket?"
}
],
"c":"rp-h"
},
{
"c":"rp-q",
"k":[
{
"r":[
{
"s":"aaaaaaaa",
"c":"rp-qn rp-mono"
}
]
},
{
"c":"rp-grow",
"k":[
{
"r":[
{
"s":"ZZ_ticket_title"
}
],
"c":"rp-qa",
"fp":"004bd9b7"
},
{
"r":[
{
"s":"Owner: zz_owner@massmarket.ai · Reply says: \"ZZ_ticket_quote\""
}
],
"c":"rp-foot",
"fp":"882634e1"
}
]
},
{
"r":[
{
"s":"✓ ",
"c":"rp-mark rp-ok rp-icon"
},
{
"s":"ETA Thu Nov 12, 3 h",
"c":"rp-mark rp-ok"
}
]
}
]
},
{
"c":"rp-q",
"k":[
{
"r":[
{
"s":"aaaaaaaa",
"c":"rp-qn rp-mono"
}
]
},
{
"c":"rp-grow",
"k":[
{
"r":[
{
"s":"ZZ_ticket2_title"
}
],
"c":"rp-qa",
"fp":"5cafda09"
},
{
"r":[
{
"s":"Owner: zz_owner2@massmarket.ai"
}
],
"c":"rp-foot",
"fp":"a5c4dc20"
}
]
},
{
"r":[
{
"s":"✗ ",
"c":"rp-mark rp-bad rp-icon"
},
{
"s":"Missing",
"c":"rp-mark rp-bad"
}
]
}
]
},
{
"r":[
{
"s":"⛔ ",
"c":"rp-icon"
},
{
"s":"1 of 2 open tickets have no ETA, proof or named wait from their owner in the drafts as they stand."
}
],
"c":"rp-banner rp-bad"
},
{
"r":[
{
"s":"OW only records this for now (observe). Get it before the go anyway."
}
],
"c":"rp-foot"
}
]
},
{
"c":"rp-sec",
"k":[
{
"r":[
{
"s":"Added by the team"
}
],
"c":"rp-h"
},
{
"r":[
{
"s":"zz_contrib@massmarket.ai · Thu Nov 5, 12:00 PM ET"
}
],
"c":"rp-noteby"
},
{
"r":[
{
"s":"ZZ_contribution"
}
],
"c":"rp-body rp-quote",
"fp":"99b3bf34"
}
]
},
{
"c":"rp-sec",
"k":[
{
"r":[
{
"s":"Findings"
}
],
"c":"rp-h"
},
{
"c":"rp-find",
"k":[
{
"r":[
{
"s":"1 item(s) added by the team."
}
],
"c":"rp-find-what",
"fp":"26aef38a"
},
{
"r":[
{
"s":"Recommend",
"c":"rp-k"
},
{
"s":" "
},
{
"s":"fold them into the client reply before the go.",
"c":"rp-v",
"fp":"7707953c"
}
],
"c":"rp-rec"
}
]
},
{
"c":"rp-find",
"k":[
{
"r":[
{
"s":"Rob: ZZ_decision."
}
],
"c":"rp-find-what",
"fp":"26b7e349"
},
{
"r":[
{
"s":"Recommend",
"c":"rp-k"
},
{
"s":" "
},
{
"s":"ZZ_decision_rec.",
"c":"rp-v",
"fp":"9ab02741"
}
],
"c":"rp-rec"
}
]
},
{
"c":"rp-find",
"k":[
{
"r":[
{
"s":"Only Rob knows: ZZ_fact."
}
],
"c":"rp-find-what",
"fp":"9b27d975"
},
{
"r":[
{
"s":"Recommend",
"c":"rp-k"
},
{
"s":" "
},
{
"s":"ZZ_fact_rec.",
"c":"rp-v",
"fp":"e621d591"
}
],
"c":"rp-rec"
}
]
},
{
"c":"rp-find",
"k":[
{
"r":[
{
"s":"New since the drafts were written: ZZ_nm_new."
}
],
"c":"rp-find-what",
"fp":"a0d70ea1"
}
]
},
{
"c":"rp-find",
"k":[
{
"r":[
{
"s":"New since the drafts were written."
}
],
"c":"rp-find-what",
"fp":"76edc660"
}
]
},
{
"r":[
{
"s":"4 more in the JSON read (without format=pickup)."
}
],
"c":"rp-foot"
}
]
},
{
"c":"rp-sec",
"k":[
{
"r":[
{
"s":"Links"
}
],
"c":"rp-h"
},
{
"c":"rp-links",
"k":[
{
"r":[
{
"s":"ZZ_link_label: "
},
{
"s":"https://x.example/zz_link",
"href":"https://x.example/zz_link"
}
],
"c":"rp-li"
},
{
"r":[
{
"s":"ZZ_source_title: "
},
{
"s":"https://x.example/zz_source",
"href":"https://x.example/zz_source"
}
],
"c":"rp-li"
},
{
"r":[
{
"s":"Draft 1 attachment: p/zz_attach_path.pdf"
}
],
"c":"rp-li"
},
{
"r":[
{
"s":"Draft 4 document: "
},
{
"s":"https://drive.google.com/open?id=1abcdefghijklmnopqrstuvwxyz",
"href":"https://drive.google.com/open?id=1abcdefghijklmnopqrstuvwxyz"
}
],
"c":"rp-li"
},
{
"r":[
{
"s":"Draft 4 preview: "
},
{
"s":"https://x.example/zz_preview",
"href":"https://x.example/zz_preview"
}
],
"c":"rp-li"
},
{
"r":[
{
"s":"Draft 4 live site: "
},
{
"s":"https://x.example/zz_prod",
"href":"https://x.example/zz_prod"
}
],
"c":"rp-li"
},
{
"r":[
{
"s":"Draft 4 before: zz_before · after: zz_after"
}
],
"c":"rp-li"
},
{
"r":[
{
"s":"Draft 5 sent: zz_sent_ref"
}
],
"c":"rp-li"
}
]
}
]
},
{
"c":"rp-go",
"k":[
{
"r":[
{
"s":"One go sends all 4 items now and schedules 4 follow-ups. Package 3f1c9a7e5b2d."
}
],
"c":"rp-closing",
"fp":"5a1f9758"
},
{
"r":[
{
"s":"⚠ ",
"c":"rp-icon"
},
{
"s":"1 open ticket(s) have no ETA, proof or named wait"
}
],
"c":"rp-banner rp-warn"
},
{
"r":[
{
"s":"⚠ ",
"c":"rp-icon"
},
{
"s":"the last approval is stale: ZZ_stale_reason"
}
],
"c":"rp-banner rp-warn"
},
{
"r":[
{
"s":"⚠ ",
"c":"rp-icon"
},
{
"s":"needs Rob's OK: draft 1 (in Rob's session his go records it)"
}
],
"c":"rp-banner rp-warn"
},
{
"r":[
{
"s":"⛔ ",
"c":"rp-icon"
},
{
"s":"Not ready for the go: 2 client message(s) arrived after the drafts were written: fold them in, or say why the drafts already answer them."
}
],
"c":"rp-banner rp-bad"
},
{
"c":"rp-actions",
"k":[
{
"btn":"Fix these first ↗",
"ask":"Fix what blocks package 3f1c9a7e5b2d before the go: 2 client message(s) arrived after the drafts were written: fold them in, or say why the drafts already answer them.",
"c":"rp-btn"
}
]
}
]
}
]
}
},
"ticket check unreadable":{
"page":"## ZZ_client (Dana) · reply package · Package `3f1c9a7e5b2d`\n\n### Every question answered?\n| # | They asked | Our reply says | |\n|---|---|---|---|\n| 1 | ZZ_q1_quote is it live? | \"yes ZZ_answer\" | ✅ |\n\n### ETA or proof for every open ticket?\n⛔ The ticket check could not be read. Read the package again before the go.\n\n### Their message\nEverything since our last reply, Mon Nov 2, 7:00 AM ET: ZZ_went_out_what.\n\n#### ZZ_inb_from · Thu Nov 5, 10:00 AM ET · gmail\nTo: zz_inb_to@x.example · Cc: zz_inb_cc@x.example · Subject: ZZ_hdr_subject\n> ```text\n> Hi team, ZZ_inbound_email_words, is it live? And Saturday?\n> ```\n\n_Quoted history below this point was removed: it starts \"On Mon Nov 2 2026 Rob wrote: > old stuff ZZ_quoted_history\". Source: doc `dddddddd`._\n\n#### Dana · Thu Nov 5, 11:00 AM ET · call\nTheir words, an excerpt the package stored; the whole document is doc `dddddddd`:\n> ```text\n> ZZ_call_excerpt\n> ```\n\n#### Dana · Thu Nov 5, 11:20 AM ET · portal\n_Doc `dddddddd` (document) is not the message itself, and the package stored none of their words for it. Summary from the package: ZZ_nonmsg_summary_\n\n**Attachment** (Thu Nov 5, 11:10 AM ET): ZZ_attach_summary · our transcription is doc `dddddddd`\n\nEarlier messages, already answered by our last reply:\n- Sun Nov 1, 11:20 AM ET, gmail: ZZ_older_summary (doc `dddddddd`)\n\n### Client reply\nZZ_reply_owed_why.\n\n#### 1. ZZ_d1_title\n**To:** zz_d1_to@x.example · **Cc:** zz_d1_cc@x.example, support@letaidothehardwork.com, rob@massmarket.ai · **Subject:** ZZ_d1_subject · **From:** zz_d1_from@massmarket.ai · **Channel:** gmail · hash `e1e1e1e1e1e1` · ⚠️ needs Rob's OK\n**The change:** ZZ_d1_diff\n```text\nHi Dana, ZZ_d1_body yes ZZ_answer.\n\nSecond paragraph ZZ_d1_body2.\n```\n\n#### 5. ZZ_d5_title\n_Already sent Thu Nov 5, 7:00 AM ET by zz_sent_by@massmarket.ai (zz_sent_ref). One go does not send it again._\n\n### Team post\n\n#### 2. ZZ_d2_title\n**Channel:** 900000000000000099 · **Must act:** <@900000000000000002> · **FYI:** <@900000000000000004> · **Owners:** `aaaaaaaa` zz_ticket_owner@massmarket.ai · **In reply to:** 900000000000000077 · hash `e2e2e2e2e2e2`\n**The change:** ZZ_d2_diff\n```text\nUpdate from <@900000000000000003> ZZ_d2_body **ZZ_d2_bold**\n```\n\n### Added by the team\n\n#### zz_contrib@massmarket.ai · Thu Nov 5, 12:00 PM ET\n> ```text\n> ZZ_contribution\n> ```\n\n### Follow-ups (sent only if they have not replied)\nDry run: none of these steps will send while follow-ups are in dry run. The go still schedules them, so chase by hand until follow-ups go live.\nCounting from zz_anchor@massmarket.ai's email of Nov 3.\nEach one goes only if nothing has come from ZZ_fu_sms_name since our reply. Any reply, booking or payment cancels the rest, and their message gets a new package with its own follow-ups.\nGoal: ZZ_goal_action. Done when: ZZ_goal_done.\n\n**1. Email · 2 business days after our reply (Thu 11-05 if the reply goes today) · same thread**\nFrom: zz_fu_from@massmarket.ai · To: zz_fu_to@x.example · Cc: zz_fu_cc@x.example, support@letaidothehardwork.com, rob@massmarket.ai\nSubject: ZZ_fu_subject\n> ```text\n> ZZ_fu_email_body\n> ```\n\n**2. Text · 3 business days after our reply (Fri 11-06 if the reply goes today)**\nTo: ZZ_fu_sms_name · HighLevel contact ZZ_fu_sms_contact · +1 555-555-0142\n> ```text\n> ZZ_fu_sms_body\n> ```\n\n**3. LinkedIn voice note · 4 business days after our reply (Mon 11-09 if the reply goes today) · Rob's seat**\nTo: https://linkedin.example/zz_li\nTranscript:\n> ```text\n> ZZ_fu_voice_body\n> ```\nAudio: not made yet, so this step cannot send. Make it before the go.\n\n**4. Call task for ZZ_assignee · 5 business days after our reply (Tue 11-10 if the reply goes today) · only if they still have not replied**\nWhy a call: ZZ_fu_call_why\n> ```text\n> ZZ_fu_call_body\n> ```\n\nNot shown: 1 cancelled step (ZZ_cancel_reason). Cancelled steps never send.\n\n### Other items\n\n#### 3. ZZ_d3_title\n**Kind:** Text message · **channel:** highlevel_sms · **location_id:** ZZ_d3_location · **contact_id:** ZZ_d3_contact · **to_phone:** +15555550143 · **to_name:** ZZ_d3_name · hash `e3e3e3e3e3e3`\n**The change:** ZZ_d3_diff\n```text\nZZ_d3_sms_body\n```\n\n#### 4. ZZ_d4_title\n**Kind:** HighLevel change · **location_id:** ZZ_d4_location · **thing:** ZZ_d4_thing · hash `e4e4e4e4e4e4`\n**The change:** ZZ_d4_diff\n```text\nZZ_d4_body\n```\n\n### Links\n- ZZ_link_label: https://x.example/zz_link\n- ZZ_source_title: https://x.example/zz_source\n- Draft 1 attachment: `p/zz_attach_path.pdf`\n- Draft 4 document: https://drive.google.com/open?id=1abcdefghijklmnopqrstuvwxyz\n- Draft 4 preview: https://x.example/zz_preview\n- Draft 4 live site: https://x.example/zz_prod\n- Draft 4 before: `zz_before` · after: `zz_after`\n- Draft 5 sent: `zz_sent_ref`\n\n### Findings\n- 1 item(s) added by the team. Recommend: fold them into the client reply before the go.\n- Rob: ZZ_decision. Recommend: ZZ_decision_rec.\n- Only Rob knows: ZZ_fact. Recommend: ZZ_fact_rec.\n- Concession in draft 1 (credit, $50): \"ZZ_concession_text\".\n- Flag (ZZ_flagkind): ZZ_flag.\n_2 more in the JSON read (without format=pickup)._\n\nOne go sends all 4 items now and schedules 4 follow-ups. Package `3f1c9a7e5b2d`.\n",
"tree":{
"v":1,
"package_id":"aaaaaaaa-1111-4222-8333-444444444444",
"project_id":"bbbbbbbb-1111-4222-8333-444444444444",
"client":"ZZ_client (Dana)",
"package_sha256":"3f1c9a7e5b2d4c6a8e0f1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f",
"label":"3f1c9a7e5b2d",
"blocks":67,
"signer":"Test Signer",
"can_sign":false,
"images":0,
"rendered_at":"2026-11-06T15:00:00Z",
"nodes":[
{
"c":"rp-head",
"k":[
{
"r":[
{
"s":"ZC"
}
],
"c":"rp-av rp-av-client"
},
{
"c":"rp-grow",
"k":[
{
"r":[
{
"s":"ZZ_client (Dana)"
}
],
"c":"rp-title"
},
{
"r":[
{
"s":"Reply package · "
},
{
"s":"3f1c9a7e5b2d",
"c":"rp-mono"
}
],
"c":"rp-sub"
}
]
},
{
"r":[
{
"s":"Green",
"c":"rp-chip rp-ok"
},
{
"s":" "
},
{
"s":"prepared",
"c":"rp-chip rp-n"
}
],
"c":"rp-chips"
}
]
},
{
"c":"rp-note",
"k":[
{
"r":[
{
"s":"ZZ_whats_new"
}
],
"c":"rp-whatsnew",
"fp":"f3dd1078"
}
]
},
{
"c":"rp-sec",
"k":[
{
"r":[
{
"s":"Their message"
}
],
"c":"rp-h"
},
{
"r":[
{
"s":"Everything since our last reply, Mon Nov 2, 7:00 AM ET: ZZ_went_out_what."
}
],
"c":"rp-foot",
"fp":"0200ba3a"
},
{
"c":"rp-mail",
"k":[
{
"r":[
{
"s":"ZZ_hdr_subject",
"c":"rp-subj",
"fp":"2ddbffb7"
}
],
"c":"rp-mail-subj"
},
{
"c":"rp-mail-from",
"k":[
{
"r":[
{
"s":"ZI"
}
],
"c":"rp-av"
},
{
"c":"rp-grow",
"k":[
{
"r":[
{
"s":"ZZ_inb_from"
}
],
"c":"rp-from",
"fp":"f9fbc4b6"
},
{
"r":[
{
"s":"To",
"c":"rp-k"
},
{
"s":" "
},
{
"s":"zz_inb_to@x.example",
"c":"rp-v",
"fp":"8a3a7eeb"
}
],
"c":"rp-hdr"
},
{
"r":[
{
"s":"Cc",
"c":"rp-k"
},
{
"s":" "
},
{
"s":"zz_inb_cc@x.example",
"c":"rp-v",
"fp":"2e02030c"
}
],
"c":"rp-hdr"
}
]
},
{
"r":[
{
"s":"Thu Nov 5, 10:00 AM ET · gmail"
}
],
"c":"rp-when"
}
]
},
{
"r":[
{
"s":"Hi team, ZZ_inbound_email_words, is it live? And Saturday?"
}
],
"c":"rp-body rp-mail-body",
"fp":"3048517f"
}
]
},
{
"r":[
{
"s":"Quoted history below this point was removed: it starts \"On Mon Nov 2 2026 Rob wrote: > old stuff ZZ_quoted_history\". Source: doc dddddddd."
}
],
"c":"rp-foot",
"fp":"caa98759"
},
{
"c":"rp-call",
"k":[
{
"c":"rp-call-head",
"k":[
{
"r":[
{
"s":"📞",
"c":"rp-icon"
}
]
},
{
"c":"rp-grow",
"k":[
{
"r":[
{
"s":"ZZ_call_title"
}
],
"c":"rp-from"
},
{
"r":[
{
"s":"Dana · Thu Nov 5, 11:00 AM ET · call · transcript · doc "
},
{
"s":"dddddddd",
"c":"rp-mono"
}
],
"c":"rp-sub"
}
]
}
]
},
{
"r":[
{
"s":"Their words, an excerpt the package stored; the whole document is doc dddddddd:"
}
],
"c":"rp-foot",
"fp":"58d9ba54"
},
{
"c":"rp-turn rp-turn-q",
"k":[
{
"r":[
{
"s":"Dana"
}
],
"c":"rp-turn-who rp-them"
},
{
"r":[
{
"s":"ZZ_call_excerpt"
}
],
"c":"rp-turn-text",
"fp":"2d51b9c4"
}
]
},
{
"btn":"Read the whole transcript ↗",
"ask":"Show me doc dddddddd from package 3f1c9a7e5b2d in full.",
"c":"rp-btn rp-btn-s"
}
]
},
{
"r":[
{
"s":"📎 ",
"c":"rp-icon"
},
{
"s":"Attachment (Thu Nov 5, 11:10 AM ET): ZZ_attach_summary · our transcription is doc dddddddd",
"c":"rp-v",
"fp":"0ec579ca"
}
],
"c":"rp-att"
},
{
"r":[
{
"s":"Dana · Thu Nov 5, 11:20 AM ET · portal"
}
],
"c":"rp-from",
"fp":"6ae8ebd1"
},
{
"r":[
{
"s":"Doc dddddddd (document) is not the message itself, and the package stored none of their words for it. Summary from the package: ZZ_nonmsg_summary"
}
],
"c":"rp-foot",
"fp":"cbd4e7e9"
},
{
"r":[
{
"s":"Earlier messages, already answered by our last reply:"
}
],
"c":"rp-foot"
},
{
"r":[
{
"s":"Sun Nov 1, 11:20 AM ET, gmail: ZZ_older_summary (doc dddddddd)"
}
],
"c":"rp-foot",
"fp":"a64faa01"
}
]
},
{
"c":"rp-sec",
"k":[
{
"r":[
{
"s":"Our reply to the client"
}
],
"c":"rp-h"
},
{
"r":[
{
"s":"ZZ_reply_owed_why."
}
],
"c":"rp-foot",
"fp":"df5a8011"
},
{
"r":[
{
"s":"1. ZZ_d1_title"
}
],
"c":"rp-dtitle"
},
{
"r":[
{
"s":"The change: ZZ_d1_diff"
}
],
"c":"rp-foot",
"fp":"a60a702a"
},
{
"c":"rp-mail",
"k":[
{
"r":[
{
"s":"ZZ_d1_subject",
"c":"rp-subj",
"fp":"95cba2fa"
},
{
"s":" "
},
{
"s":"👤 ",
"c":"rp-chip rp-warn rp-icon"
},
{
"s":"needs Rob's OK",
"c":"rp-chip rp-warn"
},
{
"s":" "
},
{
"s":"e1e1e1e1e1e1",
"c":"rp-chip rp-n rp-mono"
}
],
"c":"rp-mail-subj"
},
{
"c":"rp-mail-from",
"k":[
{
"r":[
{
"s":"ZD"
}
],
"c":"rp-av"
},
{
"c":"rp-grow",
"k":[
{
"r":[
{
"s":"zz_d1_from@massmarket.ai"
}
],
"c":"rp-from",
"fp":"e2bd06ae"
},
{
"r":[
{
"s":"To",
"c":"rp-k"
},
{
"s":" "
},
{
"s":"zz_d1_to@x.example",
"c":"rp-v",
"fp":"b9c594e7"
}
],
"c":"rp-hdr"
},
{
"r":[
{
"s":"Cc",
"c":"rp-k"
},
{
"s":" "
},
{
"s":"zz_d1_cc@x.example, support@letaidothehardwork.com, rob@massmarket.ai",
"c":"rp-v",
"fp":"2028ca06"
}
],
"c":"rp-hdr"
},
{
"r":[
{
"s":"Bcc",
"c":"rp-k"
},
{
"s":" "
},
{
"s":"zz_d1_bcc@x.example",
"c":"rp-v",
"fp":"1f33a60a"
}
],
"c":"rp-hdr"
},
{
"r":[
{
"s":"Attached",
"c":"rp-k"
},
{
"s":" "
},
{
"s":"ZZ_d1_attach.pdf",
"c":"rp-v",
"fp":"4927ecd3"
}
],
"c":"rp-hdr"
}
]
},
{
"r":[
{
"s":"in thread · gmail"
}
],
"c":"rp-when"
}
]
},
{
"r":[
{
"s":"Hi Dana, ZZ_d1_body yes ZZ_answer.\n\nSecond paragraph ZZ_d1_body2."
}
],
"c":"rp-body rp-mail-body",
"fp":"1d0a305c"
}
]
},
{
"r":[
{
"s":"3. ZZ_d3_title "
},
{
"s":"e3e3e3e3e3e3",
"c":"rp-chip rp-n rp-mono"
}
],
"c":"rp-dtitle"
},
{
"r":[
{
"s":"Kind: Text message · channel: highlevel_sms · location_id: ZZ_d3_location · contact_id: ZZ_d3_contact · to_phone: +15555550143 · to_name: ZZ_d3_name"
}
],
"c":"rp-foot",
"fp":"d6e38edc"
},
{
"r":[
{
"s":"The change: ZZ_d3_diff"
}
],
"c":"rp-foot",
"fp":"63472b00"
},
{
"c":"rp-phone rp-sms",
"k":[
{
"r":[
{
"s":"ZZ_d3_name · +1 555-555-0143 · HighLevel contact ZZ_d3_contact"
}
],
"c":"rp-phone-head"
},
{
"c":"rp-row rp-out",
"k":[
{
"r":[
{
"s":"ZZ_d3_sms_body"
}
],
"c":"rp-bub rp-bub-out",
"fp":"6de05c72"
},
{
"r":[
{
"s":"Our reply · sends on the go"
}
],
"c":"rp-bmeta"
}
]
}
]
},
{
"r":[
{
"s":"5. ZZ_d5_title"
}
],
"c":"rp-dtitle"
},
{
"r":[
{
"s":"Already sent Thu Nov 5, 7:00 AM ET by zz_sent_by@massmarket.ai (zz_sent_ref). One go does not send it again."
}
],
"c":"rp-foot",
"fp":"a56879e3"
},
{
"c":"rp-mail",
"k":[
{
"r":[
{
"s":"ZZ_d5_subject",
"c":"rp-subj",
"fp":"fabe4bae"
},
{
"s":" "
},
{
"s":"✓ ",
"c":"rp-chip rp-ok rp-icon"
},
{
"s":"already sent",
"c":"rp-chip rp-ok"
},
{
"s":" "
},
{
"s":"e5e5e5e5e5e5",
"c":"rp-chip rp-n rp-mono"
}
],
"c":"rp-mail-subj"
},
{
"c":"rp-mail-from",
"k":[
{
"r":[
{
"s":"?"
}
],
"c":"rp-av"
},
{
"c":"rp-grow",
"k":[
{
"r":[
{
"s":"(sender not named)"
}
],
"c":"rp-from",
"fp":"c8148d99"
},
{
"r":[
{
"s":"To",
"c":"rp-k"
},
{
"s":" "
},
{
"s":"zz_d5_to@x.example",
"c":"rp-v",
"fp":"8eff76f3"
}
],
"c":"rp-hdr"
},
{
"r":[
{
"s":"Cc",
"c":"rp-k"
},
{
"s":" "
},
{
"s":"(none)",
"c":"rp-v",
"fp":"90458a20"
}
],
"c":"rp-hdr"
}
]
},
{
"r":[
{
"s":"sent Thu Nov 5, 7:00 AM ET"
}
],
"c":"rp-when"
}
]
},
{
"r":[
{
"s":"ZZ_d5_body"
}
],
"c":"rp-body rp-mail-body",
"fp":"4c8b69be"
}
]
}
]
},
{
"c":"rp-sec",
"k":[
{
"r":[
{
"s":"Team post"
}
],
"c":"rp-h"
},
{
"r":[
{
"s":"2. ZZ_d2_title "
},
{
"s":"e2e2e2e2e2e2",
"c":"rp-chip rp-n rp-mono"
}
],
"c":"rp-dtitle"
},
{
"r":[
{
"s":"The change: ZZ_d2_diff"
}
],
"c":"rp-foot",
"fp":"f43d2641"
},
{
"c":"rp-dc",
"k":[
{
"r":[
{
"s":"900000000000000099",
"c":"rp-mono"
},
{
"s":" · reply to "
},
{
"s":"900000000000000077",
"c":"rp-mono"
}
],
"c":"rp-dc-chan"
},
{
"c":"rp-dc-msg",
"k":[
{
"c":"rp-grow",
"k":[
{
"r":[
{
"s":"Jarvis "
},
{
"s":"APP",
"c":"rp-dc-bot"
},
{
"s":" "
},
{
"s":"not posted yet",
"c":"rp-dc-ts"
}
],
"c":"rp-dc-name"
},
{
"r":[
{
"s":"Update from "
},
{
"s":"@900000…",
"c":"rp-mention",
"m":"900000000000000003"
},
{
"s":" ZZ_d2_body "
},
{
"s":"ZZ_d2_bold",
"c":"rp-b"
}
],
"c":"rp-body rp-dc-body",
"fp":"3eee0738"
},
{
"r":[
{
"s":"Must act: "
},
{
"s":"@900000…",
"c":"rp-mention",
"m":"900000000000000002"
},
{
"s":" · FYI: "
},
{
"s":"@900000…",
"c":"rp-mention",
"m":"900000000000000004"
},
{
"s":" · Owners: aaaaaaaa zz_ticket_owner@massmarket.ai"
}
],
"c":"rp-dc-meta"
}
]
}
]
}
]
}
]
},
{
"c":"rp-sec",
"k":[
{
"r":[
{
"s":"Other items"
}
],
"c":"rp-h"
},
{
"c":"rp-item",
"k":[
{
"c":"rp-item-head",
"k":[
{
"c":"rp-grow",
"k":[
{
"r":[
{
"s":"4. ZZ_d4_title"
}
],
"c":"rp-from"
},
{
"r":[
{
"s":"HighLevel change"
}
],
"c":"rp-sub"
}
]
},
{
"r":[
{
"s":"e4e4e4e4e4e4",
"c":"rp-chip rp-n rp-mono"
}
]
}
]
},
{
"r":[
{
"s":"Kind: HighLevel change · location_id: ZZ_d4_location · thing: ZZ_d4_thing"
}
],
"c":"rp-foot",
"fp":"aebabfa1"
},
{
"r":[
{
"s":"The change: ZZ_d4_diff"
}
],
"c":"rp-foot",
"fp":"ff247b9f"
},
{
"r":[
{
"s":"ZZ_d4_body"
}
],
"c":"rp-body rp-pre",
"fp":"705be2cb"
}
]
}
]
},
{
"c":"rp-sec",
"k":[
{
"r":[
{
"s":"Follow-ups, sent only if they have not replied"
}
],
"c":"rp-h"
},
{
"r":[
{
"s":"⚠ ",
"c":"rp-icon"
},
{
"s":"Dry run: none of these steps will send while follow-ups are in dry run. The go still schedules them, so chase by hand until follow-ups go live."
}
],
"c":"rp-banner rp-warn"
},
{
"r":[
{
"s":"Counting from zz_anchor@massmarket.ai's email of Nov 3."
}
],
"c":"rp-foot",
"fp":"7fadff35"
},
{
"r":[
{
"s":"Each one goes only if nothing has come from ZZ_fu_sms_name since our reply. Any reply, booking or payment cancels the rest, and their message gets a new package with its own follow-ups."
}
],
"c":"rp-foot",
"fp":"999d540e"
},
{
"r":[
{
"s":"Goal: ZZ_goal_action. Done when: ZZ_goal_done."
}
],
"c":"rp-foot",
"fp":"98cf1afe"
},
{
"c":"rp-tl",
"k":[
{
"c":"rp-li",
"k":[
{
"c":"rp-grow",
"k":[
{
"r":[
{
"s":"1. Email · 2 business days after our reply (Thu 11-05 if the reply goes today) · same thread"
}
],
"c":"rp-tl-head",
"fp":"6bc61770"
},
{
"r":[
{
"s":"From: zz_fu_from@massmarket.ai · To: zz_fu_to@x.example · Cc: zz_fu_cc@x.example, support@letaidothehardwork.com, rob@massmarket.ai"
}
],
"c":"rp-foot",
"fp":"62094d70"
},
{
"r":[
{
"s":"Subject: ZZ_fu_subject"
}
],
"c":"rp-foot",
"fp":"e1630888"
},
{
"r":[
{
"s":"ZZ_fu_email_body"
}
],
"c":"rp-body rp-quote",
"fp":"9bb4ec0d"
}
]
}
]
},
{
"c":"rp-li",
"k":[
{
"c":"rp-grow",
"k":[
{
"r":[
{
"s":"2. Text · 3 business days after our reply (Fri 11-06 if the reply goes today)"
}
],
"c":"rp-tl-head",
"fp":"4563e3c9"
},
{
"r":[
{
"s":"To: ZZ_fu_sms_name · HighLevel contact ZZ_fu_sms_contact · +1 555-555-0142"
}
],
"c":"rp-foot",
"fp":"5f02baa8"
},
{
"r":[
{
"s":"ZZ_fu_sms_body"
}
],
"c":"rp-bub rp-bub-out rp-inline",
"fp":"98333d92"
}
]
}
]
},
{
"c":"rp-li",
"k":[
{
"c":"rp-grow",
"k":[
{
"r":[
{
"s":"3. LinkedIn voice note · 4 business days after our reply (Mon 11-09 if the reply goes today) · Rob's seat"
}
],
"c":"rp-tl-head",
"fp":"8d60b4ef"
},
{
"r":[
{
"s":"To: https://linkedin.example/zz_li"
}
],
"c":"rp-foot",
"fp":"95f5bca6"
},
{
"r":[
{
"s":"Audio: not made yet, so this step cannot send. Make it before the go."
}
],
"c":"rp-foot",
"fp":"19ae004b"
},
{
"r":[
{
"s":"ZZ_fu_voice_body"
}
],
"c":"rp-body rp-quote",
"fp":"0589618f"
}
]
}
]
},
{
"c":"rp-li",
"k":[
{
"c":"rp-grow",
"k":[
{
"r":[
{
"s":"4. Call task for ZZ_assignee · 5 business days after our reply (Tue 11-10 if the reply goes today) · only if they still have not replied"
}
],
"c":"rp-tl-head",
"fp":"3c57dae0"
},
{
"r":[
{
"s":"Why a call: ZZ_fu_call_why"
}
],
"c":"rp-foot",
"fp":"f0759ed8"
},
{
"r":[
{
"s":"ZZ_fu_call_body"
}
],
"c":"rp-body rp-quote",
"fp":"66330e45"
}
]
}
]
}
]
},
{
"r":[
{
"s":"Not shown: 1 cancelled step (ZZ_cancel_reason). Cancelled steps never send."
}
],
"c":"rp-foot",
"fp":"f9d7195e"
}
]
},
{
"c":"rp-sec",
"k":[
{
"r":[
{
"s":"Every question answered?"
}
],
"c":"rp-h"
},
{
"c":"rp-q",
"k":[
{
"r":[
{
"s":"Q1",
"c":"rp-qn"
}
]
},
{
"c":"rp-grow",
"k":[
{
"r":[
{
"s":"ZZ_q1_quote is it live?"
}
],
"c":"rp-qa rp-qa-them",
"fp":"10a5091d"
},
{
"r":[
{
"s":"yes ZZ_answer"
}
],
"c":"rp-qa rp-qa-us",
"fp":"006fbc6b"
}
]
},
{
"r":[
{
"s":"✓ ",
"c":"rp-mark rp-ok rp-icon"
},
{
"s":"answered",
"c":"rp-mark rp-ok"
}
]
}
]
}
]
},
{
"c":"rp-sec",
"k":[
{
"r":[
{
"s":"ETA or proof for every open ticket?"
}
],
"c":"rp-h"
},
{
"r":[
{
"s":"⛔ ",
"c":"rp-icon"
},
{
"s":"The ticket check could not be read. Read the package again before the go."
}
],
"c":"rp-banner rp-bad"
}
]
},
{
"c":"rp-sec",
"k":[
{
"r":[
{
"s":"Added by the team"
}
],
"c":"rp-h"
},
{
"r":[
{
"s":"zz_contrib@massmarket.ai · Thu Nov 5, 12:00 PM ET"
}
],
"c":"rp-noteby"
},
{
"r":[
{
"s":"ZZ_contribution"
}
],
"c":"rp-body rp-quote",
"fp":"99b3bf34"
}
]
},
{
"c":"rp-sec",
"k":[
{
"r":[
{
"s":"Findings"
}
],
"c":"rp-h"
},
{
"c":"rp-find",
"k":[
{
"r":[
{
"s":"1 item(s) added by the team."
}
],
"c":"rp-find-what",
"fp":"26aef38a"
},
{
"r":[
{
"s":"Recommend",
"c":"rp-k"
},
{
"s":" "
},
{
"s":"fold them into the client reply before the go.",
"c":"rp-v",
"fp":"7707953c"
}
],
"c":"rp-rec"
}
]
},
{
"c":"rp-find",
"k":[
{
"r":[
{
"s":"Rob: ZZ_decision."
}
],
"c":"rp-find-what",
"fp":"26b7e349"
},
{
"r":[
{
"s":"Recommend",
"c":"rp-k"
},
{
"s":" "
},
{
"s":"ZZ_decision_rec.",
"c":"rp-v",
"fp":"9ab02741"
}
],
"c":"rp-rec"
}
]
},
{
"c":"rp-find",
"k":[
{
"r":[
{
"s":"Only Rob knows: ZZ_fact."
}
],
"c":"rp-find-what",
"fp":"9b27d975"
},
{
"r":[
{
"s":"Recommend",
"c":"rp-k"
},
{
"s":" "
},
{
"s":"ZZ_fact_rec.",
"c":"rp-v",
"fp":"e621d591"
}
],
"c":"rp-rec"
}
]
},
{
"c":"rp-find",
"k":[
{
"r":[
{
"s":"Concession in draft 1 (credit, $50): \"ZZ_concession_text\"."
}
],
"c":"rp-find-what",
"fp":"336ae546"
}
]
},
{
"c":"rp-find",
"k":[
{
"r":[
{
"s":"Flag (ZZ_flagkind): ZZ_flag."
}
],
"c":"rp-find-what",
"fp":"aea551d2"
}
]
},
{
"r":[
{
"s":"2 more in the JSON read (without format=pickup)."
}
],
"c":"rp-foot"
}
]
},
{
"c":"rp-sec",
"k":[
{
"r":[
{
"s":"Links"
}
],
"c":"rp-h"
},
{
"c":"rp-links",
"k":[
{
"r":[
{
"s":"ZZ_link_label: "
},
{
"s":"https://x.example/zz_link",
"href":"https://x.example/zz_link"
}
],
"c":"rp-li"
},
{
"r":[
{
"s":"ZZ_source_title: "
},
{
"s":"https://x.example/zz_source",
"href":"https://x.example/zz_source"
}
],
"c":"rp-li"
},
{
"r":[
{
"s":"Draft 1 attachment: p/zz_attach_path.pdf"
}
],
"c":"rp-li"
},
{
"r":[
{
"s":"Draft 4 document: "
},
{
"s":"https://drive.google.com/open?id=1abcdefghijklmnopqrstuvwxyz",
"href":"https://drive.google.com/open?id=1abcdefghijklmnopqrstuvwxyz"
}
],
"c":"rp-li"
},
{
"r":[
{
"s":"Draft 4 preview: "
},
{
"s":"https://x.example/zz_preview",
"href":"https://x.example/zz_preview"
}
],
"c":"rp-li"
},
{
"r":[
{
"s":"Draft 4 live site: "
},
{
"s":"https://x.example/zz_prod",
"href":"https://x.example/zz_prod"
}
],
"c":"rp-li"
},
{
"r":[
{
"s":"Draft 4 before: zz_before · after: zz_after"
}
],
"c":"rp-li"
},
{
"r":[
{
"s":"Draft 5 sent: zz_sent_ref"
}
],
"c":"rp-li"
}
]
}
]
},
{
"c":"rp-go",
"k":[
{
"r":[
{
"s":"One go sends all 4 items now and schedules 4 follow-ups. Package 3f1c9a7e5b2d."
}
],
"c":"rp-closing",
"fp":"5a1f9758"
},
{
"r":[
{
"s":"⚠ ",
"c":"rp-icon"
},
{
"s":"the last approval is stale: ZZ_stale_reason"
}
],
"c":"rp-banner rp-warn"
},
{
"r":[
{
"s":"⚠ ",
"c":"rp-icon"
},
{
"s":"needs Rob's OK: draft 1 (in Rob's session his go records it)"
}
],
"c":"rp-banner rp-warn"
},
{
"r":[
{
"s":"⛔ ",
"c":"rp-icon"
},
{
"s":"Not ready for the go: the ticket check could not be read: read the package again."
}
],
"c":"rp-banner rp-bad"
},
{
"c":"rp-actions",
"k":[
{
"btn":"Fix these first ↗",
"ask":"Fix what blocks package 3f1c9a7e5b2d before the go: the ticket check could not be read: read the package again.",
"c":"rp-btn"
}
]
}
]
}
]
}
},
"html email":{
"page":"## ZZ_client (Dana) · reply package · Package `3f1c9a7e5b2d`\n\n### Every question answered?\n| # | They asked | Our reply says | |\n|---|---|---|---|\n| 1 | ZZ_q1_quote is it live? | \"yes ZZ_answer\" | ✅ |\n\n### ETA or proof for every open ticket?\n| # | Ticket | Owner | The reply gives | Our reply says |\n|---|---|---|---|---|\n| 1 | `aaaaaaaa` ZZ_ticket_title | zz_owner@massmarket.ai | ETA Thu Nov 12, 3 h | \"ZZ_ticket_quote\" |\n| 2 | `aaaaaaaa` ZZ_ticket2_title | zz_owner2@massmarket.ai | ⛔ Missing | — |\n\n⛔ 1 of 2 open tickets have no ETA, proof or named wait from their owner in the drafts as they stand.\nOW only records this for now (observe). Get it before the go anyway.\n\n### Their message\nEverything since our last reply, Mon Nov 2, 7:00 AM ET: ZZ_went_out_what.\n\n#### ZZ_inb_from · Thu Nov 5, 10:00 AM ET · gmail\nTo: zz_inb_to@x.example · Cc: zz_inb_cc@x.example · Subject: ZZ_hdr_subject\n> ```text\n> Hi team, ZZ_inbound_email_words, is it live? And Saturday?\n> ```\n\n_Quoted history below this point was removed: it starts \"On Mon Nov 2 2026 Rob wrote: > old stuff ZZ_quoted_history\". Source: doc `dddddddd`._\n\n#### Dana · Thu Nov 5, 11:00 AM ET · call\nTheir words, an excerpt the package stored; the whole document is doc `dddddddd`:\n> ```text\n> ZZ_call_excerpt\n> ```\n\n#### Dana · Thu Nov 5, 11:20 AM ET · portal\n_Doc `dddddddd` (document) is not the message itself, and the package stored none of their words for it. Summary from the package: ZZ_nonmsg_summary_\n\n**Attachment** (Thu Nov 5, 11:10 AM ET): ZZ_attach_summary · our transcription is doc `dddddddd`\n\nEarlier messages, already answered by our last reply:\n- Sun Nov 1, 11:20 AM ET, gmail: ZZ_older_summary (doc `dddddddd`)\n\n### Client reply\nZZ_reply_owed_why.\n\n#### 1. ZZ_d1_title\n**To:** zz_d1_to@x.example · **Cc:** zz_d1_cc@x.example, support@letaidothehardwork.com, rob@massmarket.ai · **Subject:** ZZ_d1_subject · **From:** zz_d1_from@massmarket.ai · **Channel:** gmail · hash `e1e1e1e1e1e1` · ⚠️ needs Rob's OK\n**The change:** ZZ_d1_diff\n```text\n<!doctype html><html><head><title>ZZ_html_title</title><style>p{color:red}</style></head><body><p>Hi Dana &amp; team, yes ZZ_answer.</p><p>The <a href=\"https://x.example/zz_book\">booking link</a> is <b>live</b>.</p><ul><li>ZZ_html_first</li><li>ZZ_html_second</li></ul></body></html>\n```\n\n#### 5. ZZ_d5_title\n_Already sent Thu Nov 5, 7:00 AM ET by zz_sent_by@massmarket.ai (zz_sent_ref). One go does not send it again._\n\n### Team post\n\n#### 2. ZZ_d2_title\n**Channel:** 900000000000000099 · **Must act:** <@900000000000000002> · **FYI:** <@900000000000000004> · **Owners:** `aaaaaaaa` zz_ticket_owner@massmarket.ai · **In reply to:** 900000000000000077 · hash `e2e2e2e2e2e2`\n**The change:** ZZ_d2_diff\n```text\nUpdate from <@900000000000000003> ZZ_d2_body **ZZ_d2_bold**\n```\n\n### Added by the team\n\n#### zz_contrib@massmarket.ai · Thu Nov 5, 12:00 PM ET\n> ```text\n> ZZ_contribution\n> ```\n\n### Follow-ups (sent only if they have not replied)\nDry run: none of these steps will send while follow-ups are in dry run. The go still schedules them, so chase by hand until follow-ups go live.\nCounting from zz_anchor@massmarket.ai's email of Nov 3.\nEach one goes only if nothing has come from ZZ_fu_sms_name since our reply. Any reply, booking or payment cancels the rest, and their message gets a new package with its own follow-ups.\nGoal: ZZ_goal_action. Done when: ZZ_goal_done.\n\n**1. Email · 2 business days after our reply (Thu 11-05 if the reply goes today) · same thread**\nFrom: zz_fu_from@massmarket.ai · To: zz_fu_to@x.example · Cc: zz_fu_cc@x.example, support@letaidothehardwork.com, rob@massmarket.ai\nSubject: ZZ_fu_subject\n> ```text\n> ZZ_fu_email_body\n> ```\n\n**2. Text · 3 business days after our reply (Fri 11-06 if the reply goes today)**\nTo: ZZ_fu_sms_name · HighLevel contact ZZ_fu_sms_contact · +1 555-555-0142\n> ```text\n> ZZ_fu_sms_body\n> ```\n\n**3. LinkedIn voice note · 4 business days after our reply (Mon 11-09 if the reply goes today) · Rob's seat**\nTo: https://linkedin.example/zz_li\nTranscript:\n> ```text\n> ZZ_fu_voice_body\n> ```\nAudio: not made yet, so this step cannot send. Make it before the go.\n\n**4. Call task for ZZ_assignee · 5 business days after our reply (Tue 11-10 if the reply goes today) · only if they still have not replied**\nWhy a call: ZZ_fu_call_why\n> ```text\n> ZZ_fu_call_body\n> ```\n\nNot shown: 1 cancelled step (ZZ_cancel_reason). Cancelled steps never send.\n\n### Other items\n\n#### 3. ZZ_d3_title\n**Kind:** Text message · **channel:** highlevel_sms · **location_id:** ZZ_d3_location · **contact_id:** ZZ_d3_contact · **to_phone:** +15555550143 · **to_name:** ZZ_d3_name · hash `e3e3e3e3e3e3`\n**The change:** ZZ_d3_diff\n```text\nZZ_d3_sms_body\n```\n\n#### 4. ZZ_d4_title\n**Kind:** HighLevel change · **location_id:** ZZ_d4_location · **thing:** ZZ_d4_thing · hash `e4e4e4e4e4e4`\n**The change:** ZZ_d4_diff\n```text\nZZ_d4_body\n```\n\n### Links\n- ZZ_link_label: https://x.example/zz_link\n- ZZ_source_title: https://x.example/zz_source\n- Draft 1 attachment: `p/zz_attach_path.pdf`\n- Draft 4 document: https://drive.google.com/open?id=1abcdefghijklmnopqrstuvwxyz\n- Draft 4 preview: https://x.example/zz_preview\n- Draft 4 live site: https://x.example/zz_prod\n- Draft 4 before: `zz_before` · after: `zz_after`\n- Draft 5 sent: `zz_sent_ref`\n\n### Findings\n- 1 item(s) added by the team. Recommend: fold them into the client reply before the go.\n- Rob: ZZ_decision. Recommend: ZZ_decision_rec.\n- Only Rob knows: ZZ_fact. Recommend: ZZ_fact_rec.\n- Concession in draft 1 (credit, $50): \"ZZ_concession_text\".\n- Flag (ZZ_flagkind): ZZ_flag.\n_2 more in the JSON read (without format=pickup)._\n\nOne go sends all 4 items now and schedules 4 follow-ups. Package `3f1c9a7e5b2d`.\n",
"tree":{
"v":1,
"package_id":"aaaaaaaa-1111-4222-8333-444444444444",
"project_id":"bbbbbbbb-1111-4222-8333-444444444444",
"client":"ZZ_client (Dana)",
"package_sha256":"3f1c9a7e5b2d4c6a8e0f1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f",
"label":"3f1c9a7e5b2d",
"blocks":71,
"signer":"Test Signer",
"can_sign":true,
"images":0,
"rendered_at":"2026-11-06T15:00:00Z",
"nodes":[
{
"c":"rp-head",
"k":[
{
"r":[
{
"s":"ZC"
}
],
"c":"rp-av rp-av-client"
},
{
"c":"rp-grow",
"k":[
{
"r":[
{
"s":"ZZ_client (Dana)"
}
],
"c":"rp-title"
},
{
"r":[
{
"s":"Reply package · "
},
{
"s":"3f1c9a7e5b2d",
"c":"rp-mono"
}
],
"c":"rp-sub"
}
]
},
{
"r":[
{
"s":"Green",
"c":"rp-chip rp-ok"
},
{
"s":" "
},
{
"s":"prepared",
"c":"rp-chip rp-n"
}
],
"c":"rp-chips"
}
]
},
{
"c":"rp-note",
"k":[
{
"r":[
{
"s":"ZZ_whats_new"
}
],
"c":"rp-whatsnew",
"fp":"f3dd1078"
}
]
},
{
"c":"rp-sec",
"k":[
{
"r":[
{
"s":"Their message"
}
],
"c":"rp-h"
},
{
"r":[
{
"s":"Everything since our last reply, Mon Nov 2, 7:00 AM ET: ZZ_went_out_what."
}
],
"c":"rp-foot",
"fp":"0200ba3a"
},
{
"c":"rp-mail",
"k":[
{
"r":[
{
"s":"ZZ_hdr_subject",
"c":"rp-subj",
"fp":"2ddbffb7"
}
],
"c":"rp-mail-subj"
},
{
"c":"rp-mail-from",
"k":[
{
"r":[
{
"s":"ZI"
}
],
"c":"rp-av"
},
{
"c":"rp-grow",
"k":[
{
"r":[
{
"s":"ZZ_inb_from"
}
],
"c":"rp-from",
"fp":"f9fbc4b6"
},
{
"r":[
{
"s":"To",
"c":"rp-k"
},
{
"s":" "
},
{
"s":"zz_inb_to@x.example",
"c":"rp-v",
"fp":"8a3a7eeb"
}
],
"c":"rp-hdr"
},
{
"r":[
{
"s":"Cc",
"c":"rp-k"
},
{
"s":" "
},
{
"s":"zz_inb_cc@x.example",
"c":"rp-v",
"fp":"2e02030c"
}
],
"c":"rp-hdr"
}
]
},
{
"r":[
{
"s":"Thu Nov 5, 10:00 AM ET · gmail"
}
],
"c":"rp-when"
}
]
},
{
"r":[
{
"s":"Hi team, ZZ_inbound_email_words, is it live? And Saturday?"
}
],
"c":"rp-body rp-mail-body",
"fp":"3048517f"
}
]
},
{
"r":[
{
"s":"Quoted history below this point was removed: it starts \"On Mon Nov 2 2026 Rob wrote: > old stuff ZZ_quoted_history\". Source: doc dddddddd."
}
],
"c":"rp-foot",
"fp":"caa98759"
},
{
"c":"rp-call",
"k":[
{
"c":"rp-call-head",
"k":[
{
"r":[
{
"s":"📞",
"c":"rp-icon"
}
]
},
{
"c":"rp-grow",
"k":[
{
"r":[
{
"s":"ZZ_call_title"
}
],
"c":"rp-from"
},
{
"r":[
{
"s":"Dana · Thu Nov 5, 11:00 AM ET · call · transcript · doc "
},
{
"s":"dddddddd",
"c":"rp-mono"
}
],
"c":"rp-sub"
}
]
}
]
},
{
"r":[
{
"s":"Their words, an excerpt the package stored; the whole document is doc dddddddd:"
}
],
"c":"rp-foot",
"fp":"58d9ba54"
},
{
"c":"rp-turn rp-turn-q",
"k":[
{
"r":[
{
"s":"Dana"
}
],
"c":"rp-turn-who rp-them"
},
{
"r":[
{
"s":"ZZ_call_excerpt"
}
],
"c":"rp-turn-text",
"fp":"2d51b9c4"
}
]
},
{
"btn":"Read the whole transcript ↗",
"ask":"Show me doc dddddddd from package 3f1c9a7e5b2d in full.",
"c":"rp-btn rp-btn-s"
}
]
},
{
"r":[
{
"s":"📎 ",
"c":"rp-icon"
},
{
"s":"Attachment (Thu Nov 5, 11:10 AM ET): ZZ_attach_summary · our transcription is doc dddddddd",
"c":"rp-v",
"fp":"0ec579ca"
}
],
"c":"rp-att"
},
{
"r":[
{
"s":"Dana · Thu Nov 5, 11:20 AM ET · portal"
}
],
"c":"rp-from",
"fp":"6ae8ebd1"
},
{
"r":[
{
"s":"Doc dddddddd (document) is not the message itself, and the package stored none of their words for it. Summary from the package: ZZ_nonmsg_summary"
}
],
"c":"rp-foot",
"fp":"cbd4e7e9"
},
{
"r":[
{
"s":"Earlier messages, already answered by our last reply:"
}
],
"c":"rp-foot"
},
{
"r":[
{
"s":"Sun Nov 1, 11:20 AM ET, gmail: ZZ_older_summary (doc dddddddd)"
}
],
"c":"rp-foot",
"fp":"a64faa01"
}
]
},
{
"c":"rp-sec",
"k":[
{
"r":[
{
"s":"Our reply to the client"
}
],
"c":"rp-h"
},
{
"r":[
{
"s":"ZZ_reply_owed_why."
}
],
"c":"rp-foot",
"fp":"df5a8011"
},
{
"r":[
{
"s":"1. ZZ_d1_title"
}
],
"c":"rp-dtitle"
},
{
"r":[
{
"s":"The change: ZZ_d1_diff"
}
],
"c":"rp-foot",
"fp":"a60a702a"
},
{
"c":"rp-mail",
"k":[
{
"r":[
{
"s":"ZZ_d1_subject",
"c":"rp-subj",
"fp":"95cba2fa"
},
{
"s":" "
},
{
"s":"👤 ",
"c":"rp-chip rp-warn rp-icon"
},
{
"s":"needs Rob's OK",
"c":"rp-chip rp-warn"
},
{
"s":" "
},
{
"s":"e1e1e1e1e1e1",
"c":"rp-chip rp-n rp-mono"
}
],
"c":"rp-mail-subj"
},
{
"c":"rp-mail-from",
"k":[
{
"r":[
{
"s":"ZD"
}
],
"c":"rp-av"
},
{
"c":"rp-grow",
"k":[
{
"r":[
{
"s":"zz_d1_from@massmarket.ai"
}
],
"c":"rp-from",
"fp":"e2bd06ae"
},
{
"r":[
{
"s":"To",
"c":"rp-k"
},
{
"s":" "
},
{
"s":"zz_d1_to@x.example",
"c":"rp-v",
"fp":"b9c594e7"
}
],
"c":"rp-hdr"
},
{
"r":[
{
"s":"Cc",
"c":"rp-k"
},
{
"s":" "
},
{
"s":"zz_d1_cc@x.example, support@letaidothehardwork.com, rob@massmarket.ai",
"c":"rp-v",
"fp":"2028ca06"
}
],
"c":"rp-hdr"
},
{
"r":[
{
"s":"Bcc",
"c":"rp-k"
},
{
"s":" "
},
{
"s":"zz_d1_bcc@x.example",
"c":"rp-v",
"fp":"1f33a60a"
}
],
"c":"rp-hdr"
},
{
"r":[
{
"s":"Attached",
"c":"rp-k"
},
{
"s":" "
},
{
"s":"ZZ_d1_attach.pdf",
"c":"rp-v",
"fp":"4927ecd3"
}
],
"c":"rp-hdr"
}
]
},
{
"r":[
{
"s":"in thread · gmail"
}
],
"c":"rp-when"
}
]
},
{
"r":[
{
"s":"Hi Dana & team, yes ZZ_answer.\n\nThe booking link (https://x.example/zz_book) is live.\n\n- ZZ_html_first\n- ZZ_html_second"
}
],
"c":"rp-body rp-mail-body",
"fp":"2a75a92c"
}
]
},
{
"r":[
{
"s":"3. ZZ_d3_title "
},
{
"s":"e3e3e3e3e3e3",
"c":"rp-chip rp-n rp-mono"
}
],
"c":"rp-dtitle"
},
{
"r":[
{
"s":"Kind: Text message · channel: highlevel_sms · location_id: ZZ_d3_location · contact_id: ZZ_d3_contact · to_phone: +15555550143 · to_name: ZZ_d3_name"
}
],
"c":"rp-foot",
"fp":"d6e38edc"
},
{
"r":[
{
"s":"The change: ZZ_d3_diff"
}
],
"c":"rp-foot",
"fp":"63472b00"
},
{
"c":"rp-phone rp-sms",
"k":[
{
"r":[
{
"s":"ZZ_d3_name · +1 555-555-0143 · HighLevel contact ZZ_d3_contact"
}
],
"c":"rp-phone-head"
},
{
"c":"rp-row rp-out",
"k":[
{
"r":[
{
"s":"ZZ_d3_sms_body"
}
],
"c":"rp-bub rp-bub-out",
"fp":"6de05c72"
},
{
"r":[
{
"s":"Our reply · sends on the go"
}
],
"c":"rp-bmeta"
}
]
}
]
},
{
"r":[
{
"s":"5. ZZ_d5_title"
}
],
"c":"rp-dtitle"
},
{
"r":[
{
"s":"Already sent Thu Nov 5, 7:00 AM ET by zz_sent_by@massmarket.ai (zz_sent_ref). One go does not send it again."
}
],
"c":"rp-foot",
"fp":"a56879e3"
},
{
"c":"rp-mail",
"k":[
{
"r":[
{
"s":"ZZ_d5_subject",
"c":"rp-subj",
"fp":"fabe4bae"
},
{
"s":" "
},
{
"s":"✓ ",
"c":"rp-chip rp-ok rp-icon"
},
{
"s":"already sent",
"c":"rp-chip rp-ok"
},
{
"s":" "
},
{
"s":"e5e5e5e5e5e5",
"c":"rp-chip rp-n rp-mono"
}
],
"c":"rp-mail-subj"
},
{
"c":"rp-mail-from",
"k":[
{
"r":[
{
"s":"?"
}
],
"c":"rp-av"
},
{
"c":"rp-grow",
"k":[
{
"r":[
{
"s":"(sender not named)"
}
],
"c":"rp-from",
"fp":"c8148d99"
},
{
"r":[
{
"s":"To",
"c":"rp-k"
},
{
"s":" "
},
{
"s":"zz_d5_to@x.example",
"c":"rp-v",
"fp":"8eff76f3"
}
],
"c":"rp-hdr"
},
{
"r":[
{
"s":"Cc",
"c":"rp-k"
},
{
"s":" "
},
{
"s":"(none)",
"c":"rp-v",
"fp":"90458a20"
}
],
"c":"rp-hdr"
}
]
},
{
"r":[
{
"s":"sent Thu Nov 5, 7:00 AM ET"
}
],
"c":"rp-when"
}
]
},
{
"r":[
{
"s":"ZZ_d5_body"
}
],
"c":"rp-body rp-mail-body",
"fp":"4c8b69be"
}
]
}
]
},
{
"c":"rp-sec",
"k":[
{
"r":[
{
"s":"Team post"
}
],
"c":"rp-h"
},
{
"r":[
{
"s":"2. ZZ_d2_title "
},
{
"s":"e2e2e2e2e2e2",
"c":"rp-chip rp-n rp-mono"
}
],
"c":"rp-dtitle"
},
{
"r":[
{
"s":"The change: ZZ_d2_diff"
}
],
"c":"rp-foot",
"fp":"f43d2641"
},
{
"c":"rp-dc",
"k":[
{
"r":[
{
"s":"900000000000000099",
"c":"rp-mono"
},
{
"s":" · reply to "
},
{
"s":"900000000000000077",
"c":"rp-mono"
}
],
"c":"rp-dc-chan"
},
{
"c":"rp-dc-msg",
"k":[
{
"c":"rp-grow",
"k":[
{
"r":[
{
"s":"Jarvis "
},
{
"s":"APP",
"c":"rp-dc-bot"
},
{
"s":" "
},
{
"s":"not posted yet",
"c":"rp-dc-ts"
}
],
"c":"rp-dc-name"
},
{
"r":[
{
"s":"Update from "
},
{
"s":"@900000…",
"c":"rp-mention",
"m":"900000000000000003"
},
{
"s":" ZZ_d2_body "
},
{
"s":"ZZ_d2_bold",
"c":"rp-b"
}
],
"c":"rp-body rp-dc-body",
"fp":"3eee0738"
},
{
"r":[
{
"s":"Must act: "
},
{
"s":"@900000…",
"c":"rp-mention",
"m":"900000000000000002"
},
{
"s":" · FYI: "
},
{
"s":"@900000…",
"c":"rp-mention",
"m":"900000000000000004"
},
{
"s":" · Owners: aaaaaaaa zz_ticket_owner@massmarket.ai"
}
],
"c":"rp-dc-meta"
}
]
}
]
}
]
}
]
},
{
"c":"rp-sec",
"k":[
{
"r":[
{
"s":"Other items"
}
],
"c":"rp-h"
},
{
"c":"rp-item",
"k":[
{
"c":"rp-item-head",
"k":[
{
"c":"rp-grow",
"k":[
{
"r":[
{
"s":"4. ZZ_d4_title"
}
],
"c":"rp-from"
},
{
"r":[
{
"s":"HighLevel change"
}
],
"c":"rp-sub"
}
]
},
{
"r":[
{
"s":"e4e4e4e4e4e4",
"c":"rp-chip rp-n rp-mono"
}
]
}
]
},
{
"r":[
{
"s":"Kind: HighLevel change · location_id: ZZ_d4_location · thing: ZZ_d4_thing"
}
],
"c":"rp-foot",
"fp":"aebabfa1"
},
{
"r":[
{
"s":"The change: ZZ_d4_diff"
}
],
"c":"rp-foot",
"fp":"ff247b9f"
},
{
"r":[
{
"s":"ZZ_d4_body"
}
],
"c":"rp-body rp-pre",
"fp":"705be2cb"
}
]
}
]
},
{
"c":"rp-sec",
"k":[
{
"r":[
{
"s":"Follow-ups, sent only if they have not replied"
}
],
"c":"rp-h"
},
{
"r":[
{
"s":"⚠ ",
"c":"rp-icon"
},
{
"s":"Dry run: none of these steps will send while follow-ups are in dry run. The go still schedules them, so chase by hand until follow-ups go live."
}
],
"c":"rp-banner rp-warn"
},
{
"r":[
{
"s":"Counting from zz_anchor@massmarket.ai's email of Nov 3."
}
],
"c":"rp-foot",
"fp":"7fadff35"
},
{
"r":[
{
"s":"Each one goes only if nothing has come from ZZ_fu_sms_name since our reply. Any reply, booking or payment cancels the rest, and their message gets a new package with its own follow-ups."
}
],
"c":"rp-foot",
"fp":"999d540e"
},
{
"r":[
{
"s":"Goal: ZZ_goal_action. Done when: ZZ_goal_done."
}
],
"c":"rp-foot",
"fp":"98cf1afe"
},
{
"c":"rp-tl",
"k":[
{
"c":"rp-li",
"k":[
{
"c":"rp-grow",
"k":[
{
"r":[
{
"s":"1. Email · 2 business days after our reply (Thu 11-05 if the reply goes today) · same thread"
}
],
"c":"rp-tl-head",
"fp":"6bc61770"
},
{
"r":[
{
"s":"From: zz_fu_from@massmarket.ai · To: zz_fu_to@x.example · Cc: zz_fu_cc@x.example, support@letaidothehardwork.com, rob@massmarket.ai"
}
],
"c":"rp-foot",
"fp":"62094d70"
},
{
"r":[
{
"s":"Subject: ZZ_fu_subject"
}
],
"c":"rp-foot",
"fp":"e1630888"
},
{
"r":[
{
"s":"ZZ_fu_email_body"
}
],
"c":"rp-body rp-quote",
"fp":"9bb4ec0d"
}
]
}
]
},
{
"c":"rp-li",
"k":[
{
"c":"rp-grow",
"k":[
{
"r":[
{
"s":"2. Text · 3 business days after our reply (Fri 11-06 if the reply goes today)"
}
],
"c":"rp-tl-head",
"fp":"4563e3c9"
},
{
"r":[
{
"s":"To: ZZ_fu_sms_name · HighLevel contact ZZ_fu_sms_contact · +1 555-555-0142"
}
],
"c":"rp-foot",
"fp":"5f02baa8"
},
{
"r":[
{
"s":"ZZ_fu_sms_body"
}
],
"c":"rp-bub rp-bub-out rp-inline",
"fp":"98333d92"
}
]
}
]
},
{
"c":"rp-li",
"k":[
{
"c":"rp-grow",
"k":[
{
"r":[
{
"s":"3. LinkedIn voice note · 4 business days after our reply (Mon 11-09 if the reply goes today) · Rob's seat"
}
],
"c":"rp-tl-head",
"fp":"8d60b4ef"
},
{
"r":[
{
"s":"To: https://linkedin.example/zz_li"
}
],
"c":"rp-foot",
"fp":"95f5bca6"
},
{
"r":[
{
"s":"Audio: not made yet, so this step cannot send. Make it before the go."
}
],
"c":"rp-foot",
"fp":"19ae004b"
},
{
"r":[
{
"s":"ZZ_fu_voice_body"
}
],
"c":"rp-body rp-quote",
"fp":"0589618f"
}
]
}
]
},
{
"c":"rp-li",
"k":[
{
"c":"rp-grow",
"k":[
{
"r":[
{
"s":"4. Call task for ZZ_assignee · 5 business days after our reply (Tue 11-10 if the reply goes today) · only if they still have not replied"
}
],
"c":"rp-tl-head",
"fp":"3c57dae0"
},
{
"r":[
{
"s":"Why a call: ZZ_fu_call_why"
}
],
"c":"rp-foot",
"fp":"f0759ed8"
},
{
"r":[
{
"s":"ZZ_fu_call_body"
}
],
"c":"rp-body rp-quote",
"fp":"66330e45"
}
]
}
]
}
]
},
{
"r":[
{
"s":"Not shown: 1 cancelled step (ZZ_cancel_reason). Cancelled steps never send."
}
],
"c":"rp-foot",
"fp":"f9d7195e"
}
]
},
{
"c":"rp-sec",
"k":[
{
"r":[
{
"s":"Every question answered?"
}
],
"c":"rp-h"
},
{
"c":"rp-q",
"k":[
{
"r":[
{
"s":"Q1",
"c":"rp-qn"
}
]
},
{
"c":"rp-grow",
"k":[
{
"r":[
{
"s":"ZZ_q1_quote is it live?"
}
],
"c":"rp-qa rp-qa-them",
"fp":"10a5091d"
},
{
"r":[
{
"s":"yes ZZ_answer"
}
],
"c":"rp-qa rp-qa-us",
"fp":"006fbc6b"
}
]
},
{
"r":[
{
"s":"✓ ",
"c":"rp-mark rp-ok rp-icon"
},
{
"s":"answered",
"c":"rp-mark rp-ok"
}
]
}
]
}
]
},
{
"c":"rp-sec",
"k":[
{
"r":[
{
"s":"ETA or proof for every open ticket?"
}
],
"c":"rp-h"
},
{
"c":"rp-q",
"k":[
{
"r":[
{
"s":"aaaaaaaa",
"c":"rp-qn rp-mono"
}
]
},
{
"c":"rp-grow",
"k":[
{
"r":[
{
"s":"ZZ_ticket_title"
}
],
"c":"rp-qa",
"fp":"004bd9b7"
},
{
"r":[
{
"s":"Owner: zz_owner@massmarket.ai · Reply says: \"ZZ_ticket_quote\""
}
],
"c":"rp-foot",
"fp":"882634e1"
}
]
},
{
"r":[
{
"s":"✓ ",
"c":"rp-mark rp-ok rp-icon"
},
{
"s":"ETA Thu Nov 12, 3 h",
"c":"rp-mark rp-ok"
}
]
}
]
},
{
"c":"rp-q",
"k":[
{
"r":[
{
"s":"aaaaaaaa",
"c":"rp-qn rp-mono"
}
]
},
{
"c":"rp-grow",
"k":[
{
"r":[
{
"s":"ZZ_ticket2_title"
}
],
"c":"rp-qa",
"fp":"5cafda09"
},
{
"r":[
{
"s":"Owner: zz_owner2@massmarket.ai"
}
],
"c":"rp-foot",
"fp":"a5c4dc20"
}
]
},
{
"r":[
{
"s":"✗ ",
"c":"rp-mark rp-bad rp-icon"
},
{
"s":"Missing",
"c":"rp-mark rp-bad"
}
]
}
]
},
{
"r":[
{
"s":"⛔ ",
"c":"rp-icon"
},
{
"s":"1 of 2 open tickets have no ETA, proof or named wait from their owner in the drafts as they stand."
}
],
"c":"rp-banner rp-bad"
},
{
"r":[
{
"s":"OW only records this for now (observe). Get it before the go anyway."
}
],
"c":"rp-foot"
}
]
},
{
"c":"rp-sec",
"k":[
{
"r":[
{
"s":"Added by the team"
}
],
"c":"rp-h"
},
{
"r":[
{
"s":"zz_contrib@massmarket.ai · Thu Nov 5, 12:00 PM ET"
}
],
"c":"rp-noteby"
},
{
"r":[
{
"s":"ZZ_contribution"
}
],
"c":"rp-body rp-quote",
"fp":"99b3bf34"
}
]
},
{
"c":"rp-sec",
"k":[
{
"r":[
{
"s":"Findings"
}
],
"c":"rp-h"
},
{
"c":"rp-find",
"k":[
{
"r":[
{
"s":"1 item(s) added by the team."
}
],
"c":"rp-find-what",
"fp":"26aef38a"
},
{
"r":[
{
"s":"Recommend",
"c":"rp-k"
},
{
"s":" "
},
{
"s":"fold them into the client reply before the go.",
"c":"rp-v",
"fp":"7707953c"
}
],
"c":"rp-rec"
}
]
},
{
"c":"rp-find",
"k":[
{
"r":[
{
"s":"Rob: ZZ_decision."
}
],
"c":"rp-find-what",
"fp":"26b7e349"
},
{
"r":[
{
"s":"Recommend",
"c":"rp-k"
},
{
"s":" "
},
{
"s":"ZZ_decision_rec.",
"c":"rp-v",
"fp":"9ab02741"
}
],
"c":"rp-rec"
}
]
},
{
"c":"rp-find",
"k":[
{
"r":[
{
"s":"Only Rob knows: ZZ_fact."
}
],
"c":"rp-find-what",
"fp":"9b27d975"
},
{
"r":[
{
"s":"Recommend",
"c":"rp-k"
},
{
"s":" "
},
{
"s":"ZZ_fact_rec.",
"c":"rp-v",
"fp":"e621d591"
}
],
"c":"rp-rec"
}
]
},
{
"c":"rp-find",
"k":[
{
"r":[
{
"s":"Concession in draft 1 (credit, $50): \"ZZ_concession_text\"."
}
],
"c":"rp-find-what",
"fp":"336ae546"
}
]
},
{
"c":"rp-find",
"k":[
{
"r":[
{
"s":"Flag (ZZ_flagkind): ZZ_flag."
}
],
"c":"rp-find-what",
"fp":"aea551d2"
}
]
},
{
"r":[
{
"s":"2 more in the JSON read (without format=pickup)."
}
],
"c":"rp-foot"
}
]
},
{
"c":"rp-sec",
"k":[
{
"r":[
{
"s":"Links"
}
],
"c":"rp-h"
},
{
"c":"rp-links",
"k":[
{
"r":[
{
"s":"ZZ_link_label: "
},
{
"s":"https://x.example/zz_link",
"href":"https://x.example/zz_link"
}
],
"c":"rp-li"
},
{
"r":[
{
"s":"ZZ_source_title: "
},
{
"s":"https://x.example/zz_source",
"href":"https://x.example/zz_source"
}
],
"c":"rp-li"
},
{
"r":[
{
"s":"Draft 1 attachment: p/zz_attach_path.pdf"
}
],
"c":"rp-li"
},
{
"r":[
{
"s":"Draft 4 document: "
},
{
"s":"https://drive.google.com/open?id=1abcdefghijklmnopqrstuvwxyz",
"href":"https://drive.google.com/open?id=1abcdefghijklmnopqrstuvwxyz"
}
],
"c":"rp-li"
},
{
"r":[
{
"s":"Draft 4 preview: "
},
{
"s":"https://x.example/zz_preview",
"href":"https://x.example/zz_preview"
}
],
"c":"rp-li"
},
{
"r":[
{
"s":"Draft 4 live site: "
},
{
"s":"https://x.example/zz_prod",
"href":"https://x.example/zz_prod"
}
],
"c":"rp-li"
},
{
"r":[
{
"s":"Draft 4 before: zz_before · after: zz_after"
}
],
"c":"rp-li"
},
{
"r":[
{
"s":"Draft 5 sent: zz_sent_ref"
}
],
"c":"rp-li"
}
]
}
]
},
{
"c":"rp-go",
"k":[
{
"r":[
{
"s":"One go sends all 4 items now and schedules 4 follow-ups. Package 3f1c9a7e5b2d."
}
],
"c":"rp-closing",
"fp":"5a1f9758"
},
{
"r":[
{
"s":"⚠ ",
"c":"rp-icon"
},
{
"s":"1 open ticket(s) have no ETA, proof or named wait"
}
],
"c":"rp-banner rp-warn"
},
{
"r":[
{
"s":"⚠ ",
"c":"rp-icon"
},
{
"s":"the last approval is stale: ZZ_stale_reason"
}
],
"c":"rp-banner rp-warn"
},
{
"r":[
{
"s":"⚠ ",
"c":"rp-icon"
},
{
"s":"needs Rob's OK: draft 1 (in Rob's session his go records it)"
}
],
"c":"rp-banner rp-warn"
},
{
"c":"rp-actions",
"k":[
{
"sign":{
"label":"3f1c9a7e5b2d",
"signer":"Test Signer"
}
}
]
}
]
}
]
}
},
"follow-ups live":{
"page":"## ZZ_client (Dana) · reply package · Package `3f1c9a7e5b2d`\n\n### Every question answered?\n| # | They asked | Our reply says | |\n|---|---|---|---|\n| 1 | ZZ_q1_quote is it live? | \"yes ZZ_answer\" | ✅ |\n\n### ETA or proof for every open ticket?\n| # | Ticket | Owner | The reply gives | Our reply says |\n|---|---|---|---|---|\n| 1 | `aaaaaaaa` ZZ_ticket_title | zz_owner@massmarket.ai | ETA Thu Nov 12, 3 h | \"ZZ_ticket_quote\" |\n| 2 | `aaaaaaaa` ZZ_ticket2_title | zz_owner2@massmarket.ai | ⛔ Missing | — |\n\n⛔ 1 of 2 open tickets have no ETA, proof or named wait from their owner in the drafts as they stand.\nOW only records this for now (observe). Get it before the go anyway.\n\n### Their message\nEverything since our last reply, Mon Nov 2, 7:00 AM ET: ZZ_went_out_what.\n\n#### ZZ_inb_from · Thu Nov 5, 10:00 AM ET · gmail\nTo: zz_inb_to@x.example · Cc: zz_inb_cc@x.example · Subject: ZZ_hdr_subject\n> ```text\n> Hi team, ZZ_inbound_email_words, is it live? And Saturday?\n> ```\n\n_Quoted history below this point was removed: it starts \"On Mon Nov 2 2026 Rob wrote: > old stuff ZZ_quoted_history\". Source: doc `dddddddd`._\n\n#### Dana · Thu Nov 5, 11:00 AM ET · call\nTheir words, an excerpt the package stored; the whole document is doc `dddddddd`:\n> ```text\n> ZZ_call_excerpt\n> ```\n\n#### Dana · Thu Nov 5, 11:20 AM ET · portal\n_Doc `dddddddd` (document) is not the message itself, and the package stored none of their words for it. Summary from the package: ZZ_nonmsg_summary_\n\n**Attachment** (Thu Nov 5, 11:10 AM ET): ZZ_attach_summary · our transcription is doc `dddddddd`\n\nEarlier messages, already answered by our last reply:\n- Sun Nov 1, 11:20 AM ET, gmail: ZZ_older_summary (doc `dddddddd`)\n\n### Client reply\nZZ_reply_owed_why.\n\n#### 1. ZZ_d1_title\n**To:** zz_d1_to@x.example · **Cc:** zz_d1_cc@x.example, support@letaidothehardwork.com, rob@massmarket.ai · **Subject:** ZZ_d1_subject · **From:** zz_d1_from@massmarket.ai · **Channel:** gmail · hash `e1e1e1e1e1e1` · ⚠️ needs Rob's OK\n**The change:** ZZ_d1_diff\n```text\nHi Dana, ZZ_d1_body yes ZZ_answer.\n\nSecond paragraph ZZ_d1_body2.\n```\n\n#### 5. ZZ_d5_title\n_Already sent Thu Nov 5, 7:00 AM ET by zz_sent_by@massmarket.ai (zz_sent_ref). One go does not send it again._\n\n### Team post\n\n#### 2. ZZ_d2_title\n**Channel:** 900000000000000099 · **Must act:** <@900000000000000002> · **FYI:** <@900000000000000004> · **Owners:** `aaaaaaaa` zz_ticket_owner@massmarket.ai · **In reply to:** 900000000000000077 · hash `e2e2e2e2e2e2`\n**The change:** ZZ_d2_diff\n```text\nUpdate from <@900000000000000003> ZZ_d2_body **ZZ_d2_bold**\n```\n\n### Added by the team\n\n#### zz_contrib@massmarket.ai · Thu Nov 5, 12:00 PM ET\n> ```text\n> ZZ_contribution\n> ```\n\n### Follow-ups (sent only if they have not replied)\nCounting from zz_anchor@massmarket.ai's email of Nov 3.\nEach one goes only if nothing has come from ZZ_fu_sms_name since our reply. Any reply, booking or payment cancels the rest, and their message gets a new package with its own follow-ups.\nGoal: ZZ_goal_action. Done when: ZZ_goal_done.\n\n**1. Email · 2 business days after our reply (Thu 11-05 if the reply goes today) · same thread**\nFrom: zz_fu_from@massmarket.ai · To: zz_fu_to@x.example · Cc: zz_fu_cc@x.example, support@letaidothehardwork.com, rob@massmarket.ai\nSubject: ZZ_fu_subject\n> ```text\n> ZZ_fu_email_body\n> ```\n\n**2. Text · 3 business days after our reply (Fri 11-06 if the reply goes today)**\nTo: ZZ_fu_sms_name · HighLevel contact ZZ_fu_sms_contact · +1 555-555-0142\n> ```text\n> ZZ_fu_sms_body\n> ```\n\n**3. LinkedIn voice note · 4 business days after our reply (Mon 11-09 if the reply goes today) · Rob's seat**\nTo: https://linkedin.example/zz_li\nTranscript:\n> ```text\n> ZZ_fu_voice_body\n> ```\nAudio: not made yet, so this step cannot send. Make it before the go.\n\n**4. Call task for ZZ_assignee · 5 business days after our reply (Tue 11-10 if the reply goes today) · only if they still have not replied**\nWhy a call: ZZ_fu_call_why\n> ```text\n> ZZ_fu_call_body\n> ```\n\nNot shown: 1 cancelled step (ZZ_cancel_reason). Cancelled steps never send.\n\n### Other items\n\n#### 3. ZZ_d3_title\n**Kind:** Text message · **channel:** highlevel_sms · **location_id:** ZZ_d3_location · **contact_id:** ZZ_d3_contact · **to_phone:** +15555550143 · **to_name:** ZZ_d3_name · hash `e3e3e3e3e3e3`\n**The change:** ZZ_d3_diff\n```text\nZZ_d3_sms_body\n```\n\n#### 4. ZZ_d4_title\n**Kind:** HighLevel change · **location_id:** ZZ_d4_location · **thing:** ZZ_d4_thing · hash `e4e4e4e4e4e4`\n**The change:** ZZ_d4_diff\n```text\nZZ_d4_body\n```\n\n### Links\n- ZZ_link_label: https://x.example/zz_link\n- ZZ_source_title: https://x.example/zz_source\n- Draft 1 attachment: `p/zz_attach_path.pdf`\n- Draft 4 document: https://drive.google.com/open?id=1abcdefghijklmnopqrstuvwxyz\n- Draft 4 preview: https://x.example/zz_preview\n- Draft 4 live site: https://x.example/zz_prod\n- Draft 4 before: `zz_before` · after: `zz_after`\n- Draft 5 sent: `zz_sent_ref`\n\n### Findings\n- 1 item(s) added by the team. Recommend: fold them into the client reply before the go.\n- Rob: ZZ_decision. Recommend: ZZ_decision_rec.\n- Only Rob knows: ZZ_fact. Recommend: ZZ_fact_rec.\n- Concession in draft 1 (credit, $50): \"ZZ_concession_text\".\n- Flag (ZZ_flagkind): ZZ_flag.\n_2 more in the JSON read (without format=pickup)._\n\nOne go sends all 4 items now and schedules 4 follow-ups. Package `3f1c9a7e5b2d`.\n",
"tree":{
"v":1,
"package_id":"aaaaaaaa-1111-4222-8333-444444444444",
"project_id":"bbbbbbbb-1111-4222-8333-444444444444",
"client":"ZZ_client (Dana)",
"package_sha256":"3f1c9a7e5b2d4c6a8e0f1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f",
"label":"3f1c9a7e5b2d",
"blocks":71,
"signer":"Test Signer",
"can_sign":true,
"images":0,
"rendered_at":"2026-11-06T15:00:00Z",
"nodes":[
{
"c":"rp-head",
"k":[
{
"r":[
{
"s":"ZC"
}
],
"c":"rp-av rp-av-client"
},
{
"c":"rp-grow",
"k":[
{
"r":[
{
"s":"ZZ_client (Dana)"
}
],
"c":"rp-title"
},
{
"r":[
{
"s":"Reply package · "
},
{
"s":"3f1c9a7e5b2d",
"c":"rp-mono"
}
],
"c":"rp-sub"
}
]
},
{
"r":[
{
"s":"Green",
"c":"rp-chip rp-ok"
},
{
"s":" "
},
{
"s":"prepared",
"c":"rp-chip rp-n"
}
],
"c":"rp-chips"
}
]
},
{
"c":"rp-note",
"k":[
{
"r":[
{
"s":"ZZ_whats_new"
}
],
"c":"rp-whatsnew",
"fp":"f3dd1078"
}
]
},
{
"c":"rp-sec",
"k":[
{
"r":[
{
"s":"Their message"
}
],
"c":"rp-h"
},
{
"r":[
{
"s":"Everything since our last reply, Mon Nov 2, 7:00 AM ET: ZZ_went_out_what."
}
],
"c":"rp-foot",
"fp":"0200ba3a"
},
{
"c":"rp-mail",
"k":[
{
"r":[
{
"s":"ZZ_hdr_subject",
"c":"rp-subj",
"fp":"2ddbffb7"
}
],
"c":"rp-mail-subj"
},
{
"c":"rp-mail-from",
"k":[
{
"r":[
{
"s":"ZI"
}
],
"c":"rp-av"
},
{
"c":"rp-grow",
"k":[
{
"r":[
{
"s":"ZZ_inb_from"
}
],
"c":"rp-from",
"fp":"f9fbc4b6"
},
{
"r":[
{
"s":"To",
"c":"rp-k"
},
{
"s":" "
},
{
"s":"zz_inb_to@x.example",
"c":"rp-v",
"fp":"8a3a7eeb"
}
],
"c":"rp-hdr"
},
{
"r":[
{
"s":"Cc",
"c":"rp-k"
},
{
"s":" "
},
{
"s":"zz_inb_cc@x.example",
"c":"rp-v",
"fp":"2e02030c"
}
],
"c":"rp-hdr"
}
]
},
{
"r":[
{
"s":"Thu Nov 5, 10:00 AM ET · gmail"
}
],
"c":"rp-when"
}
]
},
{
"r":[
{
"s":"Hi team, ZZ_inbound_email_words, is it live? And Saturday?"
}
],
"c":"rp-body rp-mail-body",
"fp":"3048517f"
}
]
},
{
"r":[
{
"s":"Quoted history below this point was removed: it starts \"On Mon Nov 2 2026 Rob wrote: > old stuff ZZ_quoted_history\". Source: doc dddddddd."
}
],
"c":"rp-foot",
"fp":"caa98759"
},
{
"c":"rp-call",
"k":[
{
"c":"rp-call-head",
"k":[
{
"r":[
{
"s":"📞",
"c":"rp-icon"
}
]
},
{
"c":"rp-grow",
"k":[
{
"r":[
{
"s":"ZZ_call_title"
}
],
"c":"rp-from"
},
{
"r":[
{
"s":"Dana · Thu Nov 5, 11:00 AM ET · call · transcript · doc "
},
{
"s":"dddddddd",
"c":"rp-mono"
}
],
"c":"rp-sub"
}
]
}
]
},
{
"r":[
{
"s":"Their words, an excerpt the package stored; the whole document is doc dddddddd:"
}
],
"c":"rp-foot",
"fp":"58d9ba54"
},
{
"c":"rp-turn rp-turn-q",
"k":[
{
"r":[
{
"s":"Dana"
}
],
"c":"rp-turn-who rp-them"
},
{
"r":[
{
"s":"ZZ_call_excerpt"
}
],
"c":"rp-turn-text",
"fp":"2d51b9c4"
}
]
},
{
"btn":"Read the whole transcript ↗",
"ask":"Show me doc dddddddd from package 3f1c9a7e5b2d in full.",
"c":"rp-btn rp-btn-s"
}
]
},
{
"r":[
{
"s":"📎 ",
"c":"rp-icon"
},
{
"s":"Attachment (Thu Nov 5, 11:10 AM ET): ZZ_attach_summary · our transcription is doc dddddddd",
"c":"rp-v",
"fp":"0ec579ca"
}
],
"c":"rp-att"
},
{
"r":[
{
"s":"Dana · Thu Nov 5, 11:20 AM ET · portal"
}
],
"c":"rp-from",
"fp":"6ae8ebd1"
},
{
"r":[
{
"s":"Doc dddddddd (document) is not the message itself, and the package stored none of their words for it. Summary from the package: ZZ_nonmsg_summary"
}
],
"c":"rp-foot",
"fp":"cbd4e7e9"
},
{
"r":[
{
"s":"Earlier messages, already answered by our last reply:"
}
],
"c":"rp-foot"
},
{
"r":[
{
"s":"Sun Nov 1, 11:20 AM ET, gmail: ZZ_older_summary (doc dddddddd)"
}
],
"c":"rp-foot",
"fp":"a64faa01"
}
]
},
{
"c":"rp-sec",
"k":[
{
"r":[
{
"s":"Our reply to the client"
}
],
"c":"rp-h"
},
{
"r":[
{
"s":"ZZ_reply_owed_why."
}
],
"c":"rp-foot",
"fp":"df5a8011"
},
{
"r":[
{
"s":"1. ZZ_d1_title"
}
],
"c":"rp-dtitle"
},
{
"r":[
{
"s":"The change: ZZ_d1_diff"
}
],
"c":"rp-foot",
"fp":"a60a702a"
},
{
"c":"rp-mail",
"k":[
{
"r":[
{
"s":"ZZ_d1_subject",
"c":"rp-subj",
"fp":"95cba2fa"
},
{
"s":" "
},
{
"s":"👤 ",
"c":"rp-chip rp-warn rp-icon"
},
{
"s":"needs Rob's OK",
"c":"rp-chip rp-warn"
},
{
"s":" "
},
{
"s":"e1e1e1e1e1e1",
"c":"rp-chip rp-n rp-mono"
}
],
"c":"rp-mail-subj"
},
{
"c":"rp-mail-from",
"k":[
{
"r":[
{
"s":"ZD"
}
],
"c":"rp-av"
},
{
"c":"rp-grow",
"k":[
{
"r":[
{
"s":"zz_d1_from@massmarket.ai"
}
],
"c":"rp-from",
"fp":"e2bd06ae"
},
{
"r":[
{
"s":"To",
"c":"rp-k"
},
{
"s":" "
},
{
"s":"zz_d1_to@x.example",
"c":"rp-v",
"fp":"b9c594e7"
}
],
"c":"rp-hdr"
},
{
"r":[
{
"s":"Cc",
"c":"rp-k"
},
{
"s":" "
},
{
"s":"zz_d1_cc@x.example, support@letaidothehardwork.com, rob@massmarket.ai",
"c":"rp-v",
"fp":"2028ca06"
}
],
"c":"rp-hdr"
},
{
"r":[
{
"s":"Bcc",
"c":"rp-k"
},
{
"s":" "
},
{
"s":"zz_d1_bcc@x.example",
"c":"rp-v",
"fp":"1f33a60a"
}
],
"c":"rp-hdr"
},
{
"r":[
{
"s":"Attached",
"c":"rp-k"
},
{
"s":" "
},
{
"s":"ZZ_d1_attach.pdf",
"c":"rp-v",
"fp":"4927ecd3"
}
],
"c":"rp-hdr"
}
]
},
{
"r":[
{
"s":"in thread · gmail"
}
],
"c":"rp-when"
}
]
},
{
"r":[
{
"s":"Hi Dana, ZZ_d1_body yes ZZ_answer.\n\nSecond paragraph ZZ_d1_body2."
}
],
"c":"rp-body rp-mail-body",
"fp":"1d0a305c"
}
]
},
{
"r":[
{
"s":"3. ZZ_d3_title "
},
{
"s":"e3e3e3e3e3e3",
"c":"rp-chip rp-n rp-mono"
}
],
"c":"rp-dtitle"
},
{
"r":[
{
"s":"Kind: Text message · channel: highlevel_sms · location_id: ZZ_d3_location · contact_id: ZZ_d3_contact · to_phone: +15555550143 · to_name: ZZ_d3_name"
}
],
"c":"rp-foot",
"fp":"d6e38edc"
},
{
"r":[
{
"s":"The change: ZZ_d3_diff"
}
],
"c":"rp-foot",
"fp":"63472b00"
},
{
"c":"rp-phone rp-sms",
"k":[
{
"r":[
{
"s":"ZZ_d3_name · +1 555-555-0143 · HighLevel contact ZZ_d3_contact"
}
],
"c":"rp-phone-head"
},
{
"c":"rp-row rp-out",
"k":[
{
"r":[
{
"s":"ZZ_d3_sms_body"
}
],
"c":"rp-bub rp-bub-out",
"fp":"6de05c72"
},
{
"r":[
{
"s":"Our reply · sends on the go"
}
],
"c":"rp-bmeta"
}
]
}
]
},
{
"r":[
{
"s":"5. ZZ_d5_title"
}
],
"c":"rp-dtitle"
},
{
"r":[
{
"s":"Already sent Thu Nov 5, 7:00 AM ET by zz_sent_by@massmarket.ai (zz_sent_ref). One go does not send it again."
}
],
"c":"rp-foot",
"fp":"a56879e3"
},
{
"c":"rp-mail",
"k":[
{
"r":[
{
"s":"ZZ_d5_subject",
"c":"rp-subj",
"fp":"fabe4bae"
},
{
"s":" "
},
{
"s":"✓ ",
"c":"rp-chip rp-ok rp-icon"
},
{
"s":"already sent",
"c":"rp-chip rp-ok"
},
{
"s":" "
},
{
"s":"e5e5e5e5e5e5",
"c":"rp-chip rp-n rp-mono"
}
],
"c":"rp-mail-subj"
},
{
"c":"rp-mail-from",
"k":[
{
"r":[
{
"s":"?"
}
],
"c":"rp-av"
},
{
"c":"rp-grow",
"k":[
{
"r":[
{
"s":"(sender not named)"
}
],
"c":"rp-from",
"fp":"c8148d99"
},
{
"r":[
{
"s":"To",
"c":"rp-k"
},
{
"s":" "
},
{
"s":"zz_d5_to@x.example",
"c":"rp-v",
"fp":"8eff76f3"
}
],
"c":"rp-hdr"
},
{
"r":[
{
"s":"Cc",
"c":"rp-k"
},
{
"s":" "
},
{
"s":"(none)",
"c":"rp-v",
"fp":"90458a20"
}
],
"c":"rp-hdr"
}
]
},
{
"r":[
{
"s":"sent Thu Nov 5, 7:00 AM ET"
}
],
"c":"rp-when"
}
]
},
{
"r":[
{
"s":"ZZ_d5_body"
}
],
"c":"rp-body rp-mail-body",
"fp":"4c8b69be"
}
]
}
]
},
{
"c":"rp-sec",
"k":[
{
"r":[
{
"s":"Team post"
}
],
"c":"rp-h"
},
{
"r":[
{
"s":"2. ZZ_d2_title "
},
{
"s":"e2e2e2e2e2e2",
"c":"rp-chip rp-n rp-mono"
}
],
"c":"rp-dtitle"
},
{
"r":[
{
"s":"The change: ZZ_d2_diff"
}
],
"c":"rp-foot",
"fp":"f43d2641"
},
{
"c":"rp-dc",
"k":[
{
"r":[
{
"s":"900000000000000099",
"c":"rp-mono"
},
{
"s":" · reply to "
},
{
"s":"900000000000000077",
"c":"rp-mono"
}
],
"c":"rp-dc-chan"
},
{
"c":"rp-dc-msg",
"k":[
{
"c":"rp-grow",
"k":[
{
"r":[
{
"s":"Jarvis "
},
{
"s":"APP",
"c":"rp-dc-bot"
},
{
"s":" "
},
{
"s":"not posted yet",
"c":"rp-dc-ts"
}
],
"c":"rp-dc-name"
},
{
"r":[
{
"s":"Update from "
},
{
"s":"@900000…",
"c":"rp-mention",
"m":"900000000000000003"
},
{
"s":" ZZ_d2_body "
},
{
"s":"ZZ_d2_bold",
"c":"rp-b"
}
],
"c":"rp-body rp-dc-body",
"fp":"3eee0738"
},
{
"r":[
{
"s":"Must act: "
},
{
"s":"@900000…",
"c":"rp-mention",
"m":"900000000000000002"
},
{
"s":" · FYI: "
},
{
"s":"@900000…",
"c":"rp-mention",
"m":"900000000000000004"
},
{
"s":" · Owners: aaaaaaaa zz_ticket_owner@massmarket.ai"
}
],
"c":"rp-dc-meta"
}
]
}
]
}
]
}
]
},
{
"c":"rp-sec",
"k":[
{
"r":[
{
"s":"Other items"
}
],
"c":"rp-h"
},
{
"c":"rp-item",
"k":[
{
"c":"rp-item-head",
"k":[
{
"c":"rp-grow",
"k":[
{
"r":[
{
"s":"4. ZZ_d4_title"
}
],
"c":"rp-from"
},
{
"r":[
{
"s":"HighLevel change"
}
],
"c":"rp-sub"
}
]
},
{
"r":[
{
"s":"e4e4e4e4e4e4",
"c":"rp-chip rp-n rp-mono"
}
]
}
]
},
{
"r":[
{
"s":"Kind: HighLevel change · location_id: ZZ_d4_location · thing: ZZ_d4_thing"
}
],
"c":"rp-foot",
"fp":"aebabfa1"
},
{
"r":[
{
"s":"The change: ZZ_d4_diff"
}
],
"c":"rp-foot",
"fp":"ff247b9f"
},
{
"r":[
{
"s":"ZZ_d4_body"
}
],
"c":"rp-body rp-pre",
"fp":"705be2cb"
}
]
}
]
},
{
"c":"rp-sec",
"k":[
{
"r":[
{
"s":"Follow-ups, sent only if they have not replied"
}
],
"c":"rp-h"
},
{
"r":[
{
"s":"Counting from zz_anchor@massmarket.ai's email of Nov 3."
}
],
"c":"rp-foot",
"fp":"7fadff35"
},
{
"r":[
{
"s":"Each one goes only if nothing has come from ZZ_fu_sms_name since our reply. Any reply, booking or payment cancels the rest, and their message gets a new package with its own follow-ups."
}
],
"c":"rp-foot",
"fp":"999d540e"
},
{
"r":[
{
"s":"Goal: ZZ_goal_action. Done when: ZZ_goal_done."
}
],
"c":"rp-foot",
"fp":"98cf1afe"
},
{
"c":"rp-tl",
"k":[
{
"c":"rp-li",
"k":[
{
"c":"rp-grow",
"k":[
{
"r":[
{
"s":"1. Email · 2 business days after our reply (Thu 11-05 if the reply goes today) · same thread"
}
],
"c":"rp-tl-head",
"fp":"6bc61770"
},
{
"r":[
{
"s":"From: zz_fu_from@massmarket.ai · To: zz_fu_to@x.example · Cc: zz_fu_cc@x.example, support@letaidothehardwork.com, rob@massmarket.ai"
}
],
"c":"rp-foot",
"fp":"62094d70"
},
{
"r":[
{
"s":"Subject: ZZ_fu_subject"
}
],
"c":"rp-foot",
"fp":"e1630888"
},
{
"r":[
{
"s":"ZZ_fu_email_body"
}
],
"c":"rp-body rp-quote",
"fp":"9bb4ec0d"
}
]
}
]
},
{
"c":"rp-li",
"k":[
{
"c":"rp-grow",
"k":[
{
"r":[
{
"s":"2. Text · 3 business days after our reply (Fri 11-06 if the reply goes today)"
}
],
"c":"rp-tl-head",
"fp":"4563e3c9"
},
{
"r":[
{
"s":"To: ZZ_fu_sms_name · HighLevel contact ZZ_fu_sms_contact · +1 555-555-0142"
}
],
"c":"rp-foot",
"fp":"5f02baa8"
},
{
"r":[
{
"s":"ZZ_fu_sms_body"
}
],
"c":"rp-bub rp-bub-out rp-inline",
"fp":"98333d92"
}
]
}
]
},
{
"c":"rp-li",
"k":[
{
"c":"rp-grow",
"k":[
{
"r":[
{
"s":"3. LinkedIn voice note · 4 business days after our reply (Mon 11-09 if the reply goes today) · Rob's seat"
}
],
"c":"rp-tl-head",
"fp":"8d60b4ef"
},
{
"r":[
{
"s":"To: https://linkedin.example/zz_li"
}
],
"c":"rp-foot",
"fp":"95f5bca6"
},
{
"r":[
{
"s":"Audio: not made yet, so this step cannot send. Make it before the go."
}
],
"c":"rp-foot",
"fp":"19ae004b"
},
{
"r":[
{
"s":"ZZ_fu_voice_body"
}
],
"c":"rp-body rp-quote",
"fp":"0589618f"
}
]
}
]
},
{
"c":"rp-li",
"k":[
{
"c":"rp-grow",
"k":[
{
"r":[
{
"s":"4. Call task for ZZ_assignee · 5 business days after our reply (Tue 11-10 if the reply goes today) · only if they still have not replied"
}
],
"c":"rp-tl-head",
"fp":"3c57dae0"
},
{
"r":[
{
"s":"Why a call: ZZ_fu_call_why"
}
],
"c":"rp-foot",
"fp":"f0759ed8"
},
{
"r":[
{
"s":"ZZ_fu_call_body"
}
],
"c":"rp-body rp-quote",
"fp":"66330e45"
}
]
}
]
}
]
},
{
"r":[
{
"s":"Not shown: 1 cancelled step (ZZ_cancel_reason). Cancelled steps never send."
}
],
"c":"rp-foot",
"fp":"f9d7195e"
}
]
},
{
"c":"rp-sec",
"k":[
{
"r":[
{
"s":"Every question answered?"
}
],
"c":"rp-h"
},
{
"c":"rp-q",
"k":[
{
"r":[
{
"s":"Q1",
"c":"rp-qn"
}
]
},
{
"c":"rp-grow",
"k":[
{
"r":[
{
"s":"ZZ_q1_quote is it live?"
}
],
"c":"rp-qa rp-qa-them",
"fp":"10a5091d"
},
{
"r":[
{
"s":"yes ZZ_answer"
}
],
"c":"rp-qa rp-qa-us",
"fp":"006fbc6b"
}
]
},
{
"r":[
{
"s":"✓ ",
"c":"rp-mark rp-ok rp-icon"
},
{
"s":"answered",
"c":"rp-mark rp-ok"
}
]
}
]
}
]
},
{
"c":"rp-sec",
"k":[
{
"r":[
{
"s":"ETA or proof for every open ticket?"
}
],
"c":"rp-h"
},
{
"c":"rp-q",
"k":[
{
"r":[
{
"s":"aaaaaaaa",
"c":"rp-qn rp-mono"
}
]
},
{
"c":"rp-grow",
"k":[
{
"r":[
{
"s":"ZZ_ticket_title"
}
],
"c":"rp-qa",
"fp":"004bd9b7"
},
{
"r":[
{
"s":"Owner: zz_owner@massmarket.ai · Reply says: \"ZZ_ticket_quote\""
}
],
"c":"rp-foot",
"fp":"882634e1"
}
]
},
{
"r":[
{
"s":"✓ ",
"c":"rp-mark rp-ok rp-icon"
},
{
"s":"ETA Thu Nov 12, 3 h",
"c":"rp-mark rp-ok"
}
]
}
]
},
{
"c":"rp-q",
"k":[
{
"r":[
{
"s":"aaaaaaaa",
"c":"rp-qn rp-mono"
}
]
},
{
"c":"rp-grow",
"k":[
{
"r":[
{
"s":"ZZ_ticket2_title"
}
],
"c":"rp-qa",
"fp":"5cafda09"
},
{
"r":[
{
"s":"Owner: zz_owner2@massmarket.ai"
}
],
"c":"rp-foot",
"fp":"a5c4dc20"
}
]
},
{
"r":[
{
"s":"✗ ",
"c":"rp-mark rp-bad rp-icon"
},
{
"s":"Missing",
"c":"rp-mark rp-bad"
}
]
}
]
},
{
"r":[
{
"s":"⛔ ",
"c":"rp-icon"
},
{
"s":"1 of 2 open tickets have no ETA, proof or named wait from their owner in the drafts as they stand."
}
],
"c":"rp-banner rp-bad"
},
{
"r":[
{
"s":"OW only records this for now (observe). Get it before the go anyway."
}
],
"c":"rp-foot"
}
]
},
{
"c":"rp-sec",
"k":[
{
"r":[
{
"s":"Added by the team"
}
],
"c":"rp-h"
},
{
"r":[
{
"s":"zz_contrib@massmarket.ai · Thu Nov 5, 12:00 PM ET"
}
],
"c":"rp-noteby"
},
{
"r":[
{
"s":"ZZ_contribution"
}
],
"c":"rp-body rp-quote",
"fp":"99b3bf34"
}
]
},
{
"c":"rp-sec",
"k":[
{
"r":[
{
"s":"Findings"
}
],
"c":"rp-h"
},
{
"c":"rp-find",
"k":[
{
"r":[
{
"s":"1 item(s) added by the team."
}
],
"c":"rp-find-what",
"fp":"26aef38a"
},
{
"r":[
{
"s":"Recommend",
"c":"rp-k"
},
{
"s":" "
},
{
"s":"fold them into the client reply before the go.",
"c":"rp-v",
"fp":"7707953c"
}
],
"c":"rp-rec"
}
]
},
{
"c":"rp-find",
"k":[
{
"r":[
{
"s":"Rob: ZZ_decision."
}
],
"c":"rp-find-what",
"fp":"26b7e349"
},
{
"r":[
{
"s":"Recommend",
"c":"rp-k"
},
{
"s":" "
},
{
"s":"ZZ_decision_rec.",
"c":"rp-v",
"fp":"9ab02741"
}
],
"c":"rp-rec"
}
]
},
{
"c":"rp-find",
"k":[
{
"r":[
{
"s":"Only Rob knows: ZZ_fact."
}
],
"c":"rp-find-what",
"fp":"9b27d975"
},
{
"r":[
{
"s":"Recommend",
"c":"rp-k"
},
{
"s":" "
},
{
"s":"ZZ_fact_rec.",
"c":"rp-v",
"fp":"e621d591"
}
],
"c":"rp-rec"
}
]
},
{
"c":"rp-find",
"k":[
{
"r":[
{
"s":"Concession in draft 1 (credit, $50): \"ZZ_concession_text\"."
}
],
"c":"rp-find-what",
"fp":"336ae546"
}
]
},
{
"c":"rp-find",
"k":[
{
"r":[
{
"s":"Flag (ZZ_flagkind): ZZ_flag."
}
],
"c":"rp-find-what",
"fp":"aea551d2"
}
]
},
{
"r":[
{
"s":"2 more in the JSON read (without format=pickup)."
}
],
"c":"rp-foot"
}
]
},
{
"c":"rp-sec",
"k":[
{
"r":[
{
"s":"Links"
}
],
"c":"rp-h"
},
{
"c":"rp-links",
"k":[
{
"r":[
{
"s":"ZZ_link_label: "
},
{
"s":"https://x.example/zz_link",
"href":"https://x.example/zz_link"
}
],
"c":"rp-li"
},
{
"r":[
{
"s":"ZZ_source_title: "
},
{
"s":"https://x.example/zz_source",
"href":"https://x.example/zz_source"
}
],
"c":"rp-li"
},
{
"r":[
{
"s":"Draft 1 attachment: p/zz_attach_path.pdf"
}
],
"c":"rp-li"
},
{
"r":[
{
"s":"Draft 4 document: "
},
{
"s":"https://drive.google.com/open?id=1abcdefghijklmnopqrstuvwxyz",
"href":"https://drive.google.com/open?id=1abcdefghijklmnopqrstuvwxyz"
}
],
"c":"rp-li"
},
{
"r":[
{
"s":"Draft 4 preview: "
},
{
"s":"https://x.example/zz_preview",
"href":"https://x.example/zz_preview"
}
],
"c":"rp-li"
},
{
"r":[
{
"s":"Draft 4 live site: "
},
{
"s":"https://x.example/zz_prod",
"href":"https://x.example/zz_prod"
}
],
"c":"rp-li"
},
{
"r":[
{
"s":"Draft 4 before: zz_before · after: zz_after"
}
],
"c":"rp-li"
},
{
"r":[
{
"s":"Draft 5 sent: zz_sent_ref"
}
],
"c":"rp-li"
}
]
}
]
},
{
"c":"rp-go",
"k":[
{
"r":[
{
"s":"One go sends all 4 items now and schedules 4 follow-ups. Package 3f1c9a7e5b2d."
}
],
"c":"rp-closing",
"fp":"5a1f9758"
},
{
"r":[
{
"s":"⚠ ",
"c":"rp-icon"
},
{
"s":"1 open ticket(s) have no ETA, proof or named wait"
}
],
"c":"rp-banner rp-warn"
},
{
"r":[
{
"s":"⚠ ",
"c":"rp-icon"
},
{
"s":"the last approval is stale: ZZ_stale_reason"
}
],
"c":"rp-banner rp-warn"
},
{
"r":[
{
"s":"⚠ ",
"c":"rp-icon"
},
{
"s":"needs Rob's OK: draft 1 (in Rob's session his go records it)"
}
],
"c":"rp-banner rp-warn"
},
{
"c":"rp-actions",
"k":[
{
"sign":{
"label":"3f1c9a7e5b2d",
"signer":"Test Signer"
}
}
]
}
]
}
]
}
},
"follow-ups switched off":{
"page":"## ZZ_client (Dana) · reply package · Package `3f1c9a7e5b2d`\n\n### Every question answered?\n| # | They asked | Our reply says | |\n|---|---|---|---|\n| 1 | ZZ_q1_quote is it live? | \"yes ZZ_answer\" | ✅ |\n\n### ETA or proof for every open ticket?\n| # | Ticket | Owner | The reply gives | Our reply says |\n|---|---|---|---|---|\n| 1 | `aaaaaaaa` ZZ_ticket_title | zz_owner@massmarket.ai | ETA Thu Nov 12, 3 h | \"ZZ_ticket_quote\" |\n| 2 | `aaaaaaaa` ZZ_ticket2_title | zz_owner2@massmarket.ai | ⛔ Missing | — |\n\n⛔ 1 of 2 open tickets have no ETA, proof or named wait from their owner in the drafts as they stand.\nOW only records this for now (observe). Get it before the go anyway.\n\n### Their message\nEverything since our last reply, Mon Nov 2, 7:00 AM ET: ZZ_went_out_what.\n\n#### ZZ_inb_from · Thu Nov 5, 10:00 AM ET · gmail\nTo: zz_inb_to@x.example · Cc: zz_inb_cc@x.example · Subject: ZZ_hdr_subject\n> ```text\n> Hi team, ZZ_inbound_email_words, is it live? And Saturday?\n> ```\n\n_Quoted history below this point was removed: it starts \"On Mon Nov 2 2026 Rob wrote: > old stuff ZZ_quoted_history\". Source: doc `dddddddd`._\n\n#### Dana · Thu Nov 5, 11:00 AM ET · call\nTheir words, an excerpt the package stored; the whole document is doc `dddddddd`:\n> ```text\n> ZZ_call_excerpt\n> ```\n\n#### Dana · Thu Nov 5, 11:20 AM ET · portal\n_Doc `dddddddd` (document) is not the message itself, and the package stored none of their words for it. Summary from the package: ZZ_nonmsg_summary_\n\n**Attachment** (Thu Nov 5, 11:10 AM ET): ZZ_attach_summary · our transcription is doc `dddddddd`\n\nEarlier messages, already answered by our last reply:\n- Sun Nov 1, 11:20 AM ET, gmail: ZZ_older_summary (doc `dddddddd`)\n\n### Client reply\nZZ_reply_owed_why.\n\n#### 1. ZZ_d1_title\n**To:** zz_d1_to@x.example · **Cc:** zz_d1_cc@x.example, support@letaidothehardwork.com, rob@massmarket.ai · **Subject:** ZZ_d1_subject · **From:** zz_d1_from@massmarket.ai · **Channel:** gmail · hash `e1e1e1e1e1e1` · ⚠️ needs Rob's OK\n**The change:** ZZ_d1_diff\n```text\nHi Dana, ZZ_d1_body yes ZZ_answer.\n\nSecond paragraph ZZ_d1_body2.\n```\n\n#### 5. ZZ_d5_title\n_Already sent Thu Nov 5, 7:00 AM ET by zz_sent_by@massmarket.ai (zz_sent_ref). One go does not send it again._\n\n### Team post\n\n#### 2. ZZ_d2_title\n**Channel:** 900000000000000099 · **Must act:** <@900000000000000002> · **FYI:** <@900000000000000004> · **Owners:** `aaaaaaaa` zz_ticket_owner@massmarket.ai · **In reply to:** 900000000000000077 · hash `e2e2e2e2e2e2`\n**The change:** ZZ_d2_diff\n```text\nUpdate from <@900000000000000003> ZZ_d2_body **ZZ_d2_bold**\n```\n\n### Added by the team\n\n#### zz_contrib@massmarket.ai · Thu Nov 5, 12:00 PM ET\n> ```text\n> ZZ_contribution\n> ```\n\n### Follow-ups (sent only if they have not replied)\nSwitched off: none of these steps will send while follow-ups are switched off. The go still schedules them, so chase by hand.\nCounting from zz_anchor@massmarket.ai's email of Nov 3.\nEach one goes only if nothing has come from ZZ_fu_sms_name since our reply. Any reply, booking or payment cancels the rest, and their message gets a new package with its own follow-ups.\nGoal: ZZ_goal_action. Done when: ZZ_goal_done.\n\n**1. Email · 2 business days after our reply (Thu 11-05 if the reply goes today) · same thread**\nFrom: zz_fu_from@massmarket.ai · To: zz_fu_to@x.example · Cc: zz_fu_cc@x.example, support@letaidothehardwork.com, rob@massmarket.ai\nSubject: ZZ_fu_subject\n> ```text\n> ZZ_fu_email_body\n> ```\n\n**2. Text · 3 business days after our reply (Fri 11-06 if the reply goes today)**\nTo: ZZ_fu_sms_name · HighLevel contact ZZ_fu_sms_contact · +1 555-555-0142\n> ```text\n> ZZ_fu_sms_body\n> ```\n\n**3. LinkedIn voice note · 4 business days after our reply (Mon 11-09 if the reply goes today) · Rob's seat**\nTo: https://linkedin.example/zz_li\nTranscript:\n> ```text\n> ZZ_fu_voice_body\n> ```\nAudio: not made yet, so this step cannot send. Make it before the go.\n\n**4. Call task for ZZ_assignee · 5 business days after our reply (Tue 11-10 if the reply goes today) · only if they still have not replied**\nWhy a call: ZZ_fu_call_why\n> ```text\n> ZZ_fu_call_body\n> ```\n\nNot shown: 1 cancelled step (ZZ_cancel_reason). Cancelled steps never send.\n\n### Other items\n\n#### 3. ZZ_d3_title\n**Kind:** Text message · **channel:** highlevel_sms · **location_id:** ZZ_d3_location · **contact_id:** ZZ_d3_contact · **to_phone:** +15555550143 · **to_name:** ZZ_d3_name · hash `e3e3e3e3e3e3`\n**The change:** ZZ_d3_diff\n```text\nZZ_d3_sms_body\n```\n\n#### 4. ZZ_d4_title\n**Kind:** HighLevel change · **location_id:** ZZ_d4_location · **thing:** ZZ_d4_thing · hash `e4e4e4e4e4e4`\n**The change:** ZZ_d4_diff\n```text\nZZ_d4_body\n```\n\n### Links\n- ZZ_link_label: https://x.example/zz_link\n- ZZ_source_title: https://x.example/zz_source\n- Draft 1 attachment: `p/zz_attach_path.pdf`\n- Draft 4 document: https://drive.google.com/open?id=1abcdefghijklmnopqrstuvwxyz\n- Draft 4 preview: https://x.example/zz_preview\n- Draft 4 live site: https://x.example/zz_prod\n- Draft 4 before: `zz_before` · after: `zz_after`\n- Draft 5 sent: `zz_sent_ref`\n\n### Findings\n- 1 item(s) added by the team. Recommend: fold them into the client reply before the go.\n- Rob: ZZ_decision. Recommend: ZZ_decision_rec.\n- Only Rob knows: ZZ_fact. Recommend: ZZ_fact_rec.\n- Concession in draft 1 (credit, $50): \"ZZ_concession_text\".\n- Flag (ZZ_flagkind): ZZ_flag.\n_2 more in the JSON read (without format=pickup)._\n\nOne go sends all 4 items now and schedules 4 follow-ups. Package `3f1c9a7e5b2d`.\n",
"tree":{
"v":1,
"package_id":"aaaaaaaa-1111-4222-8333-444444444444",
"project_id":"bbbbbbbb-1111-4222-8333-444444444444",
"client":"ZZ_client (Dana)",
"package_sha256":"3f1c9a7e5b2d4c6a8e0f1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f",
"label":"3f1c9a7e5b2d",
"blocks":71,
"signer":"Test Signer",
"can_sign":true,
"images":0,
"rendered_at":"2026-11-06T15:00:00Z",
"nodes":[
{
"c":"rp-head",
"k":[
{
"r":[
{
"s":"ZC"
}
],
"c":"rp-av rp-av-client"
},
{
"c":"rp-grow",
"k":[
{
"r":[
{
"s":"ZZ_client (Dana)"
}
],
"c":"rp-title"
},
{
"r":[
{
"s":"Reply package · "
},
{
"s":"3f1c9a7e5b2d",
"c":"rp-mono"
}
],
"c":"rp-sub"
}
]
},
{
"r":[
{
"s":"Green",
"c":"rp-chip rp-ok"
},
{
"s":" "
},
{
"s":"prepared",
"c":"rp-chip rp-n"
}
],
"c":"rp-chips"
}
]
},
{
"c":"rp-note",
"k":[
{
"r":[
{
"s":"ZZ_whats_new"
}
],
"c":"rp-whatsnew",
"fp":"f3dd1078"
}
]
},
{
"c":"rp-sec",
"k":[
{
"r":[
{
"s":"Their message"
}
],
"c":"rp-h"
},
{
"r":[
{
"s":"Everything since our last reply, Mon Nov 2, 7:00 AM ET: ZZ_went_out_what."
}
],
"c":"rp-foot",
"fp":"0200ba3a"
},
{
"c":"rp-mail",
"k":[
{
"r":[
{
"s":"ZZ_hdr_subject",
"c":"rp-subj",
"fp":"2ddbffb7"
}
],
"c":"rp-mail-subj"
},
{
"c":"rp-mail-from",
"k":[
{
"r":[
{
"s":"ZI"
}
],
"c":"rp-av"
},
{
"c":"rp-grow",
"k":[
{
"r":[
{
"s":"ZZ_inb_from"
}
],
"c":"rp-from",
"fp":"f9fbc4b6"
},
{
"r":[
{
"s":"To",
"c":"rp-k"
},
{
"s":" "
},
{
"s":"zz_inb_to@x.example",
"c":"rp-v",
"fp":"8a3a7eeb"
}
],
"c":"rp-hdr"
},
{
"r":[
{
"s":"Cc",
"c":"rp-k"
},
{
"s":" "
},
{
"s":"zz_inb_cc@x.example",
"c":"rp-v",
"fp":"2e02030c"
}
],
"c":"rp-hdr"
}
]
},
{
"r":[
{
"s":"Thu Nov 5, 10:00 AM ET · gmail"
}
],
"c":"rp-when"
}
]
},
{
"r":[
{
"s":"Hi team, ZZ_inbound_email_words, is it live? And Saturday?"
}
],
"c":"rp-body rp-mail-body",
"fp":"3048517f"
}
]
},
{
"r":[
{
"s":"Quoted history below this point was removed: it starts \"On Mon Nov 2 2026 Rob wrote: > old stuff ZZ_quoted_history\". Source: doc dddddddd."
}
],
"c":"rp-foot",
"fp":"caa98759"
},
{
"c":"rp-call",
"k":[
{
"c":"rp-call-head",
"k":[
{
"r":[
{
"s":"📞",
"c":"rp-icon"
}
]
},
{
"c":"rp-grow",
"k":[
{
"r":[
{
"s":"ZZ_call_title"
}
],
"c":"rp-from"
},
{
"r":[
{
"s":"Dana · Thu Nov 5, 11:00 AM ET · call · transcript · doc "
},
{
"s":"dddddddd",
"c":"rp-mono"
}
],
"c":"rp-sub"
}
]
}
]
},
{
"r":[
{
"s":"Their words, an excerpt the package stored; the whole document is doc dddddddd:"
}
],
"c":"rp-foot",
"fp":"58d9ba54"
},
{
"c":"rp-turn rp-turn-q",
"k":[
{
"r":[
{
"s":"Dana"
}
],
"c":"rp-turn-who rp-them"
},
{
"r":[
{
"s":"ZZ_call_excerpt"
}
],
"c":"rp-turn-text",
"fp":"2d51b9c4"
}
]
},
{
"btn":"Read the whole transcript ↗",
"ask":"Show me doc dddddddd from package 3f1c9a7e5b2d in full.",
"c":"rp-btn rp-btn-s"
}
]
},
{
"r":[
{
"s":"📎 ",
"c":"rp-icon"
},
{
"s":"Attachment (Thu Nov 5, 11:10 AM ET): ZZ_attach_summary · our transcription is doc dddddddd",
"c":"rp-v",
"fp":"0ec579ca"
}
],
"c":"rp-att"
},
{
"r":[
{
"s":"Dana · Thu Nov 5, 11:20 AM ET · portal"
}
],
"c":"rp-from",
"fp":"6ae8ebd1"
},
{
"r":[
{
"s":"Doc dddddddd (document) is not the message itself, and the package stored none of their words for it. Summary from the package: ZZ_nonmsg_summary"
}
],
"c":"rp-foot",
"fp":"cbd4e7e9"
},
{
"r":[
{
"s":"Earlier messages, already answered by our last reply:"
}
],
"c":"rp-foot"
},
{
"r":[
{
"s":"Sun Nov 1, 11:20 AM ET, gmail: ZZ_older_summary (doc dddddddd)"
}
],
"c":"rp-foot",
"fp":"a64faa01"
}
]
},
{
"c":"rp-sec",
"k":[
{
"r":[
{
"s":"Our reply to the client"
}
],
"c":"rp-h"
},
{
"r":[
{
"s":"ZZ_reply_owed_why."
}
],
"c":"rp-foot",
"fp":"df5a8011"
},
{
"r":[
{
"s":"1. ZZ_d1_title"
}
],
"c":"rp-dtitle"
},
{
"r":[
{
"s":"The change: ZZ_d1_diff"
}
],
"c":"rp-foot",
"fp":"a60a702a"
},
{
"c":"rp-mail",
"k":[
{
"r":[
{
"s":"ZZ_d1_subject",
"c":"rp-subj",
"fp":"95cba2fa"
},
{
"s":" "
},
{
"s":"👤 ",
"c":"rp-chip rp-warn rp-icon"
},
{
"s":"needs Rob's OK",
"c":"rp-chip rp-warn"
},
{
"s":" "
},
{
"s":"e1e1e1e1e1e1",
"c":"rp-chip rp-n rp-mono"
}
],
"c":"rp-mail-subj"
},
{
"c":"rp-mail-from",
"k":[
{
"r":[
{
"s":"ZD"
}
],
"c":"rp-av"
},
{
"c":"rp-grow",
"k":[
{
"r":[
{
"s":"zz_d1_from@massmarket.ai"
}
],
"c":"rp-from",
"fp":"e2bd06ae"
},
{
"r":[
{
"s":"To",
"c":"rp-k"
},
{
"s":" "
},
{
"s":"zz_d1_to@x.example",
"c":"rp-v",
"fp":"b9c594e7"
}
],
"c":"rp-hdr"
},
{
"r":[
{
"s":"Cc",
"c":"rp-k"
},
{
"s":" "
},
{
"s":"zz_d1_cc@x.example, support@letaidothehardwork.com, rob@massmarket.ai",
"c":"rp-v",
"fp":"2028ca06"
}
],
"c":"rp-hdr"
},
{
"r":[
{
"s":"Bcc",
"c":"rp-k"
},
{
"s":" "
},
{
"s":"zz_d1_bcc@x.example",
"c":"rp-v",
"fp":"1f33a60a"
}
],
"c":"rp-hdr"
},
{
"r":[
{
"s":"Attached",
"c":"rp-k"
},
{
"s":" "
},
{
"s":"ZZ_d1_attach.pdf",
"c":"rp-v",
"fp":"4927ecd3"
}
],
"c":"rp-hdr"
}
]
},
{
"r":[
{
"s":"in thread · gmail"
}
],
"c":"rp-when"
}
]
},
{
"r":[
{
"s":"Hi Dana, ZZ_d1_body yes ZZ_answer.\n\nSecond paragraph ZZ_d1_body2."
}
],
"c":"rp-body rp-mail-body",
"fp":"1d0a305c"
}
]
},
{
"r":[
{
"s":"3. ZZ_d3_title "
},
{
"s":"e3e3e3e3e3e3",
"c":"rp-chip rp-n rp-mono"
}
],
"c":"rp-dtitle"
},
{
"r":[
{
"s":"Kind: Text message · channel: highlevel_sms · location_id: ZZ_d3_location · contact_id: ZZ_d3_contact · to_phone: +15555550143 · to_name: ZZ_d3_name"
}
],
"c":"rp-foot",
"fp":"d6e38edc"
},
{
"r":[
{
"s":"The change: ZZ_d3_diff"
}
],
"c":"rp-foot",
"fp":"63472b00"
},
{
"c":"rp-phone rp-sms",
"k":[
{
"r":[
{
"s":"ZZ_d3_name · +1 555-555-0143 · HighLevel contact ZZ_d3_contact"
}
],
"c":"rp-phone-head"
},
{
"c":"rp-row rp-out",
"k":[
{
"r":[
{
"s":"ZZ_d3_sms_body"
}
],
"c":"rp-bub rp-bub-out",
"fp":"6de05c72"
},
{
"r":[
{
"s":"Our reply · sends on the go"
}
],
"c":"rp-bmeta"
}
]
}
]
},
{
"r":[
{
"s":"5. ZZ_d5_title"
}
],
"c":"rp-dtitle"
},
{
"r":[
{
"s":"Already sent Thu Nov 5, 7:00 AM ET by zz_sent_by@massmarket.ai (zz_sent_ref). One go does not send it again."
}
],
"c":"rp-foot",
"fp":"a56879e3"
},
{
"c":"rp-mail",
"k":[
{
"r":[
{
"s":"ZZ_d5_subject",
"c":"rp-subj",
"fp":"fabe4bae"
},
{
"s":" "
},
{
"s":"✓ ",
"c":"rp-chip rp-ok rp-icon"
},
{
"s":"already sent",
"c":"rp-chip rp-ok"
},
{
"s":" "
},
{
"s":"e5e5e5e5e5e5",
"c":"rp-chip rp-n rp-mono"
}
],
"c":"rp-mail-subj"
},
{
"c":"rp-mail-from",
"k":[
{
"r":[
{
"s":"?"
}
],
"c":"rp-av"
},
{
"c":"rp-grow",
"k":[
{
"r":[
{
"s":"(sender not named)"
}
],
"c":"rp-from",
"fp":"c8148d99"
},
{
"r":[
{
"s":"To",
"c":"rp-k"
},
{
"s":" "
},
{
"s":"zz_d5_to@x.example",
"c":"rp-v",
"fp":"8eff76f3"
}
],
"c":"rp-hdr"
},
{
"r":[
{
"s":"Cc",
"c":"rp-k"
},
{
"s":" "
},
{
"s":"(none)",
"c":"rp-v",
"fp":"90458a20"
}
],
"c":"rp-hdr"
}
]
},
{
"r":[
{
"s":"sent Thu Nov 5, 7:00 AM ET"
}
],
"c":"rp-when"
}
]
},
{
"r":[
{
"s":"ZZ_d5_body"
}
],
"c":"rp-body rp-mail-body",
"fp":"4c8b69be"
}
]
}
]
},
{
"c":"rp-sec",
"k":[
{
"r":[
{
"s":"Team post"
}
],
"c":"rp-h"
},
{
"r":[
{
"s":"2. ZZ_d2_title "
},
{
"s":"e2e2e2e2e2e2",
"c":"rp-chip rp-n rp-mono"
}
],
"c":"rp-dtitle"
},
{
"r":[
{
"s":"The change: ZZ_d2_diff"
}
],
"c":"rp-foot",
"fp":"f43d2641"
},
{
"c":"rp-dc",
"k":[
{
"r":[
{
"s":"900000000000000099",
"c":"rp-mono"
},
{
"s":" · reply to "
},
{
"s":"900000000000000077",
"c":"rp-mono"
}
],
"c":"rp-dc-chan"
},
{
"c":"rp-dc-msg",
"k":[
{
"c":"rp-grow",
"k":[
{
"r":[
{
"s":"Jarvis "
},
{
"s":"APP",
"c":"rp-dc-bot"
},
{
"s":" "
},
{
"s":"not posted yet",
"c":"rp-dc-ts"
}
],
"c":"rp-dc-name"
},
{
"r":[
{
"s":"Update from "
},
{
"s":"@900000…",
"c":"rp-mention",
"m":"900000000000000003"
},
{
"s":" ZZ_d2_body "
},
{
"s":"ZZ_d2_bold",
"c":"rp-b"
}
],
"c":"rp-body rp-dc-body",
"fp":"3eee0738"
},
{
"r":[
{
"s":"Must act: "
},
{
"s":"@900000…",
"c":"rp-mention",
"m":"900000000000000002"
},
{
"s":" · FYI: "
},
{
"s":"@900000…",
"c":"rp-mention",
"m":"900000000000000004"
},
{
"s":" · Owners: aaaaaaaa zz_ticket_owner@massmarket.ai"
}
],
"c":"rp-dc-meta"
}
]
}
]
}
]
}
]
},
{
"c":"rp-sec",
"k":[
{
"r":[
{
"s":"Other items"
}
],
"c":"rp-h"
},
{
"c":"rp-item",
"k":[
{
"c":"rp-item-head",
"k":[
{
"c":"rp-grow",
"k":[
{
"r":[
{
"s":"4. ZZ_d4_title"
}
],
"c":"rp-from"
},
{
"r":[
{
"s":"HighLevel change"
}
],
"c":"rp-sub"
}
]
},
{
"r":[
{
"s":"e4e4e4e4e4e4",
"c":"rp-chip rp-n rp-mono"
}
]
}
]
},
{
"r":[
{
"s":"Kind: HighLevel change · location_id: ZZ_d4_location · thing: ZZ_d4_thing"
}
],
"c":"rp-foot",
"fp":"aebabfa1"
},
{
"r":[
{
"s":"The change: ZZ_d4_diff"
}
],
"c":"rp-foot",
"fp":"ff247b9f"
},
{
"r":[
{
"s":"ZZ_d4_body"
}
],
"c":"rp-body rp-pre",
"fp":"705be2cb"
}
]
}
]
},
{
"c":"rp-sec",
"k":[
{
"r":[
{
"s":"Follow-ups, sent only if they have not replied"
}
],
"c":"rp-h"
},
{
"r":[
{
"s":"⚠ ",
"c":"rp-icon"
},
{
"s":"Switched off: none of these steps will send while follow-ups are switched off. The go still schedules them, so chase by hand."
}
],
"c":"rp-banner rp-warn"
},
{
"r":[
{
"s":"Counting from zz_anchor@massmarket.ai's email of Nov 3."
}
],
"c":"rp-foot",
"fp":"7fadff35"
},
{
"r":[
{
"s":"Each one goes only if nothing has come from ZZ_fu_sms_name since our reply. Any reply, booking or payment cancels the rest, and their message gets a new package with its own follow-ups."
}
],
"c":"rp-foot",
"fp":"999d540e"
},
{
"r":[
{
"s":"Goal: ZZ_goal_action. Done when: ZZ_goal_done."
}
],
"c":"rp-foot",
"fp":"98cf1afe"
},
{
"c":"rp-tl",
"k":[
{
"c":"rp-li",
"k":[
{
"c":"rp-grow",
"k":[
{
"r":[
{
"s":"1. Email · 2 business days after our reply (Thu 11-05 if the reply goes today) · same thread"
}
],
"c":"rp-tl-head",
"fp":"6bc61770"
},
{
"r":[
{
"s":"From: zz_fu_from@massmarket.ai · To: zz_fu_to@x.example · Cc: zz_fu_cc@x.example, support@letaidothehardwork.com, rob@massmarket.ai"
}
],
"c":"rp-foot",
"fp":"62094d70"
},
{
"r":[
{
"s":"Subject: ZZ_fu_subject"
}
],
"c":"rp-foot",
"fp":"e1630888"
},
{
"r":[
{
"s":"ZZ_fu_email_body"
}
],
"c":"rp-body rp-quote",
"fp":"9bb4ec0d"
}
]
}
]
},
{
"c":"rp-li",
"k":[
{
"c":"rp-grow",
"k":[
{
"r":[
{
"s":"2. Text · 3 business days after our reply (Fri 11-06 if the reply goes today)"
}
],
"c":"rp-tl-head",
"fp":"4563e3c9"
},
{
"r":[
{
"s":"To: ZZ_fu_sms_name · HighLevel contact ZZ_fu_sms_contact · +1 555-555-0142"
}
],
"c":"rp-foot",
"fp":"5f02baa8"
},
{
"r":[
{
"s":"ZZ_fu_sms_body"
}
],
"c":"rp-bub rp-bub-out rp-inline",
"fp":"98333d92"
}
]
}
]
},
{
"c":"rp-li",
"k":[
{
"c":"rp-grow",
"k":[
{
"r":[
{
"s":"3. LinkedIn voice note · 4 business days after our reply (Mon 11-09 if the reply goes today) · Rob's seat"
}
],
"c":"rp-tl-head",
"fp":"8d60b4ef"
},
{
"r":[
{
"s":"To: https://linkedin.example/zz_li"
}
],
"c":"rp-foot",
"fp":"95f5bca6"
},
{
"r":[
{
"s":"Audio: not made yet, so this step cannot send. Make it before the go."
}
],
"c":"rp-foot",
"fp":"19ae004b"
},
{
"r":[
{
"s":"ZZ_fu_voice_body"
}
],
"c":"rp-body rp-quote",
"fp":"0589618f"
}
]
}
]
},
{
"c":"rp-li",
"k":[
{
"c":"rp-grow",
"k":[
{
"r":[
{
"s":"4. Call task for ZZ_assignee · 5 business days after our reply (Tue 11-10 if the reply goes today) · only if they still have not replied"
}
],
"c":"rp-tl-head",
"fp":"3c57dae0"
},
{
"r":[
{
"s":"Why a call: ZZ_fu_call_why"
}
],
"c":"rp-foot",
"fp":"f0759ed8"
},
{
"r":[
{
"s":"ZZ_fu_call_body"
}
],
"c":"rp-body rp-quote",
"fp":"66330e45"
}
]
}
]
}
]
},
{
"r":[
{
"s":"Not shown: 1 cancelled step (ZZ_cancel_reason). Cancelled steps never send."
}
],
"c":"rp-foot",
"fp":"f9d7195e"
}
]
},
{
"c":"rp-sec",
"k":[
{
"r":[
{
"s":"Every question answered?"
}
],
"c":"rp-h"
},
{
"c":"rp-q",
"k":[
{
"r":[
{
"s":"Q1",
"c":"rp-qn"
}
]
},
{
"c":"rp-grow",
"k":[
{
"r":[
{
"s":"ZZ_q1_quote is it live?"
}
],
"c":"rp-qa rp-qa-them",
"fp":"10a5091d"
},
{
"r":[
{
"s":"yes ZZ_answer"
}
],
"c":"rp-qa rp-qa-us",
"fp":"006fbc6b"
}
]
},
{
"r":[
{
"s":"✓ ",
"c":"rp-mark rp-ok rp-icon"
},
{
"s":"answered",
"c":"rp-mark rp-ok"
}
]
}
]
}
]
},
{
"c":"rp-sec",
"k":[
{
"r":[
{
"s":"ETA or proof for every open ticket?"
}
],
"c":"rp-h"
},
{
"c":"rp-q",
"k":[
{
"r":[
{
"s":"aaaaaaaa",
"c":"rp-qn rp-mono"
}
]
},
{
"c":"rp-grow",
"k":[
{
"r":[
{
"s":"ZZ_ticket_title"
}
],
"c":"rp-qa",
"fp":"004bd9b7"
},
{
"r":[
{
"s":"Owner: zz_owner@massmarket.ai · Reply says: \"ZZ_ticket_quote\""
}
],
"c":"rp-foot",
"fp":"882634e1"
}
]
},
{
"r":[
{
"s":"✓ ",
"c":"rp-mark rp-ok rp-icon"
},
{
"s":"ETA Thu Nov 12, 3 h",
"c":"rp-mark rp-ok"
}
]
}
]
},
{
"c":"rp-q",
"k":[
{
"r":[
{
"s":"aaaaaaaa",
"c":"rp-qn rp-mono"
}
]
},
{
"c":"rp-grow",
"k":[
{
"r":[
{
"s":"ZZ_ticket2_title"
}
],
"c":"rp-qa",
"fp":"5cafda09"
},
{
"r":[
{
"s":"Owner: zz_owner2@massmarket.ai"
}
],
"c":"rp-foot",
"fp":"a5c4dc20"
}
]
},
{
"r":[
{
"s":"✗ ",
"c":"rp-mark rp-bad rp-icon"
},
{
"s":"Missing",
"c":"rp-mark rp-bad"
}
]
}
]
},
{
"r":[
{
"s":"⛔ ",
"c":"rp-icon"
},
{
"s":"1 of 2 open tickets have no ETA, proof or named wait from their owner in the drafts as they stand."
}
],
"c":"rp-banner rp-bad"
},
{
"r":[
{
"s":"OW only records this for now (observe). Get it before the go anyway."
}
],
"c":"rp-foot"
}
]
},
{
"c":"rp-sec",
"k":[
{
"r":[
{
"s":"Added by the team"
}
],
"c":"rp-h"
},
{
"r":[
{
"s":"zz_contrib@massmarket.ai · Thu Nov 5, 12:00 PM ET"
}
],
"c":"rp-noteby"
},
{
"r":[
{
"s":"ZZ_contribution"
}
],
"c":"rp-body rp-quote",
"fp":"99b3bf34"
}
]
},
{
"c":"rp-sec",
"k":[
{
"r":[
{
"s":"Findings"
}
],
"c":"rp-h"
},
{
"c":"rp-find",
"k":[
{
"r":[
{
"s":"1 item(s) added by the team."
}
],
"c":"rp-find-what",
"fp":"26aef38a"
},
{
"r":[
{
"s":"Recommend",
"c":"rp-k"
},
{
"s":" "
},
{
"s":"fold them into the client reply before the go.",
"c":"rp-v",
"fp":"7707953c"
}
],
"c":"rp-rec"
}
]
},
{
"c":"rp-find",
"k":[
{
"r":[
{
"s":"Rob: ZZ_decision."
}
],
"c":"rp-find-what",
"fp":"26b7e349"
},
{
"r":[
{
"s":"Recommend",
"c":"rp-k"
},
{
"s":" "
},
{
"s":"ZZ_decision_rec.",
"c":"rp-v",
"fp":"9ab02741"
}
],
"c":"rp-rec"
}
]
},
{
"c":"rp-find",
"k":[
{
"r":[
{
"s":"Only Rob knows: ZZ_fact."
}
],
"c":"rp-find-what",
"fp":"9b27d975"
},
{
"r":[
{
"s":"Recommend",
"c":"rp-k"
},
{
"s":" "
},
{
"s":"ZZ_fact_rec.",
"c":"rp-v",
"fp":"e621d591"
}
],
"c":"rp-rec"
}
]
},
{
"c":"rp-find",
"k":[
{
"r":[
{
"s":"Concession in draft 1 (credit, $50): \"ZZ_concession_text\"."
}
],
"c":"rp-find-what",
"fp":"336ae546"
}
]
},
{
"c":"rp-find",
"k":[
{
"r":[
{
"s":"Flag (ZZ_flagkind): ZZ_flag."
}
],
"c":"rp-find-what",
"fp":"aea551d2"
}
]
},
{
"r":[
{
"s":"2 more in the JSON read (without format=pickup)."
}
],
"c":"rp-foot"
}
]
},
{
"c":"rp-sec",
"k":[
{
"r":[
{
"s":"Links"
}
],
"c":"rp-h"
},
{
"c":"rp-links",
"k":[
{
"r":[
{
"s":"ZZ_link_label: "
},
{
"s":"https://x.example/zz_link",
"href":"https://x.example/zz_link"
}
],
"c":"rp-li"
},
{
"r":[
{
"s":"ZZ_source_title: "
},
{
"s":"https://x.example/zz_source",
"href":"https://x.example/zz_source"
}
],
"c":"rp-li"
},
{
"r":[
{
"s":"Draft 1 attachment: p/zz_attach_path.pdf"
}
],
"c":"rp-li"
},
{
"r":[
{
"s":"Draft 4 document: "
},
{
"s":"https://drive.google.com/open?id=1abcdefghijklmnopqrstuvwxyz",
"href":"https://drive.google.com/open?id=1abcdefghijklmnopqrstuvwxyz"
}
],
"c":"rp-li"
},
{
"r":[
{
"s":"Draft 4 preview: "
},
{
"s":"https://x.example/zz_preview",
"href":"https://x.example/zz_preview"
}
],
"c":"rp-li"
},
{
"r":[
{
"s":"Draft 4 live site: "
},
{
"s":"https://x.example/zz_prod",
"href":"https://x.example/zz_prod"
}
],
"c":"rp-li"
},
{
"r":[
{
"s":"Draft 4 before: zz_before · after: zz_after"
}
],
"c":"rp-li"
},
{
"r":[
{
"s":"Draft 5 sent: zz_sent_ref"
}
],
"c":"rp-li"
}
]
}
]
},
{
"c":"rp-go",
"k":[
{
"r":[
{
"s":"One go sends all 4 items now and schedules 4 follow-ups. Package 3f1c9a7e5b2d."
}
],
"c":"rp-closing",
"fp":"5a1f9758"
},
{
"r":[
{
"s":"⚠ ",
"c":"rp-icon"
},
{
"s":"1 open ticket(s) have no ETA, proof or named wait"
}
],
"c":"rp-banner rp-warn"
},
{
"r":[
{
"s":"⚠ ",
"c":"rp-icon"
},
{
"s":"the last approval is stale: ZZ_stale_reason"
}
],
"c":"rp-banner rp-warn"
},
{
"r":[
{
"s":"⚠ ",
"c":"rp-icon"
},
{
"s":"needs Rob's OK: draft 1 (in Rob's session his go records it)"
}
],
"c":"rp-banner rp-warn"
},
{
"c":"rp-actions",
"k":[
{
"sign":{
"label":"3f1c9a7e5b2d",
"signer":"Test Signer"
}
}
]
}
]
}
]
}
},
"source links":{
"page":"## ZZ_client (Dana) · reply package · Package `3f1c9a7e5b2d`\n\n### Every question answered?\n| # | They asked | Our reply says | |\n|---|---|---|---|\n| 1 | ZZ_q1_quote is it live? | \"yes ZZ_answer\" | ✅ |\n\n### ETA or proof for every open ticket?\n| # | Ticket | Owner | The reply gives | Our reply says |\n|---|---|---|---|---|\n| 1 | `aaaaaaaa` ZZ_ticket_title | zz_owner@massmarket.ai | ETA Thu Nov 12, 3 h | \"ZZ_ticket_quote\" |\n| 2 | `aaaaaaaa` ZZ_ticket2_title | zz_owner2@massmarket.ai | ⛔ Missing | — |\n\n⛔ 1 of 2 open tickets have no ETA, proof or named wait from their owner in the drafts as they stand.\nOW only records this for now (observe). Get it before the go anyway.\n\n### Their message\nEverything since our last reply, Mon Nov 2, 7:00 AM ET: ZZ_went_out_what.\n\n#### ZZ_inb_from · Thu Nov 5, 10:00 AM ET · gmail\nTo: zz_inb_to@x.example · Cc: zz_inb_cc@x.example · Subject: ZZ_hdr_subject\n> ```text\n> Hi team, ZZ_inbound_email_words, is it live? And Saturday?\n> ```\n\n_Quoted history below this point was removed: it starts \"On Mon Nov 2 2026 Rob wrote: > old stuff ZZ_quoted_history\". Source: doc `dddddddd`._\n\n#### Dana · Thu Nov 5, 11:00 AM ET · call\nTheir words, an excerpt the package stored; the whole document is doc `dddddddd`:\n> ```text\n> ZZ_call_excerpt\n> ```\n\n#### Dana · Thu Nov 5, 11:20 AM ET · portal\n_Doc `dddddddd` (document) is not the message itself, and the package stored none of their words for it. Summary from the package: ZZ_nonmsg_summary_\n\n**Attachment** (Thu Nov 5, 11:10 AM ET): ZZ_attach_summary · our transcription is doc `dddddddd`\n\nEarlier messages, already answered by our last reply:\n- Sun Nov 1, 11:20 AM ET, gmail: ZZ_older_summary (doc `dddddddd`)\n\n### Client reply\nZZ_reply_owed_why.\n\n#### 1. ZZ_d1_title\n**To:** zz_d1_to@x.example · **Cc:** zz_d1_cc@x.example, support@letaidothehardwork.com, rob@massmarket.ai · **Subject:** ZZ_d1_subject · **From:** zz_d1_from@massmarket.ai · **Channel:** gmail · hash `e1e1e1e1e1e1` · ⚠️ needs Rob's OK\n**The change:** ZZ_d1_diff\n```text\nHi Dana, ZZ_d1_body yes ZZ_answer.\n\nSecond paragraph ZZ_d1_body2.\n```\n\n#### 5. ZZ_d5_title\n_Already sent Thu Nov 5, 7:00 AM ET by zz_sent_by@massmarket.ai (zz_sent_ref). One go does not send it again._\n\n### Team post\n\n#### 2. ZZ_d2_title\n**Channel:** 900000000000000099 · **Must act:** <@900000000000000002> · **FYI:** <@900000000000000004> · **Owners:** `aaaaaaaa` zz_ticket_owner@massmarket.ai · **In reply to:** 900000000000000077 · hash `e2e2e2e2e2e2`\n**The change:** ZZ_d2_diff\n```text\nUpdate from <@900000000000000003> ZZ_d2_body **ZZ_d2_bold**\n```\n\n### Added by the team\n\n#### zz_contrib@massmarket.ai · Thu Nov 5, 12:00 PM ET\n> ```text\n> ZZ_contribution\n> ```\n\n### Follow-ups (sent only if they have not replied)\nDry run: none of these steps will send while follow-ups are in dry run. The go still schedules them, so chase by hand until follow-ups go live.\nCounting from zz_anchor@massmarket.ai's email of Nov 3.\nEach one goes only if nothing has come from ZZ_fu_sms_name since our reply. Any reply, booking or payment cancels the rest, and their message gets a new package with its own follow-ups.\nGoal: ZZ_goal_action. Done when: ZZ_goal_done.\n\n**1. Email · 2 business days after our reply (Thu 11-05 if the reply goes today) · same thread**\nFrom: zz_fu_from@massmarket.ai · To: zz_fu_to@x.example · Cc: zz_fu_cc@x.example, support@letaidothehardwork.com, rob@massmarket.ai\nSubject: ZZ_fu_subject\n> ```text\n> ZZ_fu_email_body\n> ```\n\n**2. Text · 3 business days after our reply (Fri 11-06 if the reply goes today)**\nTo: ZZ_fu_sms_name · HighLevel contact ZZ_fu_sms_contact · +1 555-555-0142\n> ```text\n> ZZ_fu_sms_body\n> ```\n\n**3. LinkedIn voice note · 4 business days after our reply (Mon 11-09 if the reply goes today) · Rob's seat**\nTo: https://linkedin.example/zz_li\nTranscript:\n> ```text\n> ZZ_fu_voice_body\n> ```\nAudio: not made yet, so this step cannot send. Make it before the go.\n\n**4. Call task for ZZ_assignee · 5 business days after our reply (Tue 11-10 if the reply goes today) · only if they still have not replied**\nWhy a call: ZZ_fu_call_why\n> ```text\n> ZZ_fu_call_body\n> ```\n\nNot shown: 1 cancelled step (ZZ_cancel_reason). Cancelled steps never send.\n\n### Other items\n\n#### 3. ZZ_d3_title\n**Kind:** Text message · **channel:** highlevel_sms · **location_id:** ZZ_d3_location · **contact_id:** ZZ_d3_contact · **to_phone:** +15555550143 · **to_name:** ZZ_d3_name · hash `e3e3e3e3e3e3`\n**The change:** ZZ_d3_diff\n```text\nZZ_d3_sms_body\n```\n\n#### 4. ZZ_d4_title\n**Kind:** HighLevel change · **location_id:** ZZ_d4_location · **thing:** ZZ_d4_thing · hash `e4e4e4e4e4e4`\n**The change:** ZZ_d4_diff\n```text\nZZ_d4_body\n```\n\n### Links\n- ZZ_link_label: https://x.example/zz_link\n- ZZ_source_title: https://x.example/zz_source\n- Draft 1 attachment: `p/zz_attach_path.pdf`\n- Draft 4 document: https://drive.google.com/open?id=1abcdefghijklmnopqrstuvwxyz\n- Draft 4 preview: https://x.example/zz_preview\n- Draft 4 live site: https://x.example/zz_prod\n- Draft 4 before: `zz_before` · after: `zz_after`\n- Draft 5 sent: `zz_sent_ref`\n\n### Findings\n- 1 item(s) added by the team. Recommend: fold them into the client reply before the go.\n- Rob: ZZ_decision. Recommend: ZZ_decision_rec.\n- Only Rob knows: ZZ_fact. Recommend: ZZ_fact_rec.\n- Concession in draft 1 (credit, $50): \"ZZ_concession_text\".\n- Flag (ZZ_flagkind): ZZ_flag.\n_2 more in the JSON read (without format=pickup)._\n\nOne go sends all 4 items now and schedules 4 follow-ups. Package `3f1c9a7e5b2d`.\n",
"tree":{
"v":1,
"package_id":"aaaaaaaa-1111-4222-8333-444444444444",
"project_id":"bbbbbbbb-1111-4222-8333-444444444444",
"client":"ZZ_client (Dana)",
"package_sha256":"3f1c9a7e5b2d4c6a8e0f1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f",
"label":"3f1c9a7e5b2d",
"blocks":71,
"signer":"Test Signer",
"can_sign":true,
"images":0,
"rendered_at":"2026-11-06T15:00:00Z",
"nodes":[
{
"c":"rp-head",
"k":[
{
"r":[
{
"s":"ZC"
}
],
"c":"rp-av rp-av-client"
},
{
"c":"rp-grow",
"k":[
{
"r":[
{
"s":"ZZ_client (Dana)"
}
],
"c":"rp-title"
},
{
"r":[
{
"s":"Reply package · "
},
{
"s":"3f1c9a7e5b2d",
"c":"rp-mono"
}
],
"c":"rp-sub"
}
]
},
{
"r":[
{
"s":"Green",
"c":"rp-chip rp-ok"
},
{
"s":" "
},
{
"s":"prepared",
"c":"rp-chip rp-n"
}
],
"c":"rp-chips"
}
]
},
{
"c":"rp-note",
"k":[
{
"r":[
{
"s":"ZZ_whats_new"
}
],
"c":"rp-whatsnew",
"fp":"f3dd1078"
}
]
},
{
"c":"rp-sec",
"k":[
{
"r":[
{
"s":"Their message"
}
],
"c":"rp-h"
},
{
"r":[
{
"s":"Everything since our last reply, Mon Nov 2, 7:00 AM ET: ZZ_went_out_what."
}
],
"c":"rp-foot",
"fp":"0200ba3a"
},
{
"c":"rp-mail",
"k":[
{
"r":[
{
"s":"ZZ_hdr_subject",
"c":"rp-subj",
"fp":"2ddbffb7"
}
],
"c":"rp-mail-subj"
},
{
"c":"rp-mail-from",
"k":[
{
"r":[
{
"s":"ZI"
}
],
"c":"rp-av"
},
{
"c":"rp-grow",
"k":[
{
"r":[
{
"s":"ZZ_inb_from"
}
],
"c":"rp-from",
"fp":"f9fbc4b6"
},
{
"r":[
{
"s":"To",
"c":"rp-k"
},
{
"s":" "
},
{
"s":"zz_inb_to@x.example",
"c":"rp-v",
"fp":"8a3a7eeb"
}
],
"c":"rp-hdr"
},
{
"r":[
{
"s":"Cc",
"c":"rp-k"
},
{
"s":" "
},
{
"s":"zz_inb_cc@x.example",
"c":"rp-v",
"fp":"2e02030c"
}
],
"c":"rp-hdr"
}
]
},
{
"r":[
{
"s":"Thu Nov 5, 10:00 AM ET · gmail"
}
],
"c":"rp-when"
}
]
},
{
"r":[
{
"s":"Hi team, ZZ_inbound_email_words, is it live? And Saturday?"
}
],
"c":"rp-body rp-mail-body",
"fp":"3048517f"
}
]
},
{
"r":[
{
"s":"Quoted history below this point was removed: it starts \"On Mon Nov 2 2026 Rob wrote: > old stuff ZZ_quoted_history\". Source: doc dddddddd."
}
],
"c":"rp-foot",
"fp":"caa98759"
},
{
"r":[
{
"s":"Open email",
"c":"rp-btn rp-btn-s",
"href":"https://mail.google.com/mail/u/support@letaidothehardwork.com/#all/zz"
}
],
"c":"rp-src"
},
{
"c":"rp-call",
"k":[
{
"c":"rp-call-head",
"k":[
{
"r":[
{
"s":"📞",
"c":"rp-icon"
}
]
},
{
"c":"rp-grow",
"k":[
{
"r":[
{
"s":"ZZ_call_title"
}
],
"c":"rp-from"
},
{
"r":[
{
"s":"Dana · Thu Nov 5, 11:00 AM ET · call · transcript · doc "
},
{
"s":"dddddddd",
"c":"rp-mono"
}
],
"c":"rp-sub"
}
]
}
]
},
{
"r":[
{
"s":"Fireflies",
"c":"rp-btn rp-btn-s",
"href":"https://app.fireflies.ai/view/zz"
}
],
"c":"rp-src"
},
{
"r":[
{
"s":"Their words, an excerpt the package stored; the whole document is doc dddddddd:"
}
],
"c":"rp-foot",
"fp":"58d9ba54"
},
{
"c":"rp-turn rp-turn-q",
"k":[
{
"r":[
{
"s":"Dana"
}
],
"c":"rp-turn-who rp-them"
},
{
"r":[
{
"s":"ZZ_call_excerpt"
}
],
"c":"rp-turn-text",
"fp":"2d51b9c4"
}
]
},
{
"btn":"Read the whole transcript ↗",
"ask":"Show me doc dddddddd from package 3f1c9a7e5b2d in full.",
"c":"rp-btn rp-btn-s"
}
]
},
{
"r":[
{
"s":"📎 ",
"c":"rp-icon"
},
{
"s":"Attachment (Thu Nov 5, 11:10 AM ET): ZZ_attach_summary · our transcription is doc dddddddd",
"c":"rp-v",
"fp":"0ec579ca"
}
],
"c":"rp-att"
},
{
"r":[
{
"s":"Dana · Thu Nov 5, 11:20 AM ET · portal"
}
],
"c":"rp-from",
"fp":"6ae8ebd1"
},
{
"r":[
{
"s":"Doc dddddddd (document) is not the message itself, and the package stored none of their words for it. Summary from the package: ZZ_nonmsg_summary"
}
],
"c":"rp-foot",
"fp":"cbd4e7e9"
},
{
"r":[
{
"s":"Earlier messages, already answered by our last reply:"
}
],
"c":"rp-foot"
},
{
"r":[
{
"s":"Sun Nov 1, 11:20 AM ET, gmail: ZZ_older_summary (doc dddddddd)"
}
],
"c":"rp-foot",
"fp":"a64faa01"
}
]
},
{
"c":"rp-sec",
"k":[
{
"r":[
{
"s":"Our reply to the client"
}
],
"c":"rp-h"
},
{
"r":[
{
"s":"ZZ_reply_owed_why."
}
],
"c":"rp-foot",
"fp":"df5a8011"
},
{
"r":[
{
"s":"1. ZZ_d1_title"
}
],
"c":"rp-dtitle"
},
{
"r":[
{
"s":"The change: ZZ_d1_diff"
}
],
"c":"rp-foot",
"fp":"a60a702a"
},
{
"c":"rp-mail",
"k":[
{
"r":[
{
"s":"ZZ_d1_subject",
"c":"rp-subj",
"fp":"95cba2fa"
},
{
"s":" "
},
{
"s":"👤 ",
"c":"rp-chip rp-warn rp-icon"
},
{
"s":"needs Rob's OK",
"c":"rp-chip rp-warn"
},
{
"s":" "
},
{
"s":"e1e1e1e1e1e1",
"c":"rp-chip rp-n rp-mono"
}
],
"c":"rp-mail-subj"
},
{
"c":"rp-mail-from",
"k":[
{
"r":[
{
"s":"ZD"
}
],
"c":"rp-av"
},
{
"c":"rp-grow",
"k":[
{
"r":[
{
"s":"zz_d1_from@massmarket.ai"
}
],
"c":"rp-from",
"fp":"e2bd06ae"
},
{
"r":[
{
"s":"To",
"c":"rp-k"
},
{
"s":" "
},
{
"s":"zz_d1_to@x.example",
"c":"rp-v",
"fp":"b9c594e7"
}
],
"c":"rp-hdr"
},
{
"r":[
{
"s":"Cc",
"c":"rp-k"
},
{
"s":" "
},
{
"s":"zz_d1_cc@x.example, support@letaidothehardwork.com, rob@massmarket.ai",
"c":"rp-v",
"fp":"2028ca06"
}
],
"c":"rp-hdr"
},
{
"r":[
{
"s":"Bcc",
"c":"rp-k"
},
{
"s":" "
},
{
"s":"zz_d1_bcc@x.example",
"c":"rp-v",
"fp":"1f33a60a"
}
],
"c":"rp-hdr"
},
{
"r":[
{
"s":"Attached",
"c":"rp-k"
},
{
"s":" "
},
{
"s":"ZZ_d1_attach.pdf",
"c":"rp-v",
"fp":"4927ecd3"
}
],
"c":"rp-hdr"
}
]
},
{
"r":[
{
"s":"in thread · gmail"
}
],
"c":"rp-when"
}
]
},
{
"r":[
{
"s":"Hi Dana, ZZ_d1_body yes ZZ_answer.\n\nSecond paragraph ZZ_d1_body2."
}
],
"c":"rp-body rp-mail-body",
"fp":"1d0a305c"
}
]
},
{
"r":[
{
"s":"3. ZZ_d3_title "
},
{
"s":"e3e3e3e3e3e3",
"c":"rp-chip rp-n rp-mono"
}
],
"c":"rp-dtitle"
},
{
"r":[
{
"s":"Kind: Text message · channel: highlevel_sms · location_id: ZZ_d3_location · contact_id: ZZ_d3_contact · to_phone: +15555550143 · to_name: ZZ_d3_name"
}
],
"c":"rp-foot",
"fp":"d6e38edc"
},
{
"r":[
{
"s":"The change: ZZ_d3_diff"
}
],
"c":"rp-foot",
"fp":"63472b00"
},
{
"c":"rp-phone rp-sms",
"k":[
{
"r":[
{
"s":"ZZ_d3_name · +1 555-555-0143 · HighLevel contact ZZ_d3_contact"
}
],
"c":"rp-phone-head"
},
{
"c":"rp-row rp-out",
"k":[
{
"r":[
{
"s":"ZZ_d3_sms_body"
}
],
"c":"rp-bub rp-bub-out",
"fp":"6de05c72"
},
{
"r":[
{
"s":"Our reply · sends on the go"
}
],
"c":"rp-bmeta"
}
]
}
]
},
{
"r":[
{
"s":"5. ZZ_d5_title"
}
],
"c":"rp-dtitle"
},
{
"r":[
{
"s":"Already sent Thu Nov 5, 7:00 AM ET by zz_sent_by@massmarket.ai (zz_sent_ref). One go does not send it again."
}
],
"c":"rp-foot",
"fp":"a56879e3"
},
{
"c":"rp-mail",
"k":[
{
"r":[
{
"s":"ZZ_d5_subject",
"c":"rp-subj",
"fp":"fabe4bae"
},
{
"s":" "
},
{
"s":"✓ ",
"c":"rp-chip rp-ok rp-icon"
},
{
"s":"already sent",
"c":"rp-chip rp-ok"
},
{
"s":" "
},
{
"s":"e5e5e5e5e5e5",
"c":"rp-chip rp-n rp-mono"
}
],
"c":"rp-mail-subj"
},
{
"c":"rp-mail-from",
"k":[
{
"r":[
{
"s":"?"
}
],
"c":"rp-av"
},
{
"c":"rp-grow",
"k":[
{
"r":[
{
"s":"(sender not named)"
}
],
"c":"rp-from",
"fp":"c8148d99"
},
{
"r":[
{
"s":"To",
"c":"rp-k"
},
{
"s":" "
},
{
"s":"zz_d5_to@x.example",
"c":"rp-v",
"fp":"8eff76f3"
}
],
"c":"rp-hdr"
},
{
"r":[
{
"s":"Cc",
"c":"rp-k"
},
{
"s":" "
},
{
"s":"(none)",
"c":"rp-v",
"fp":"90458a20"
}
],
"c":"rp-hdr"
}
]
},
{
"r":[
{
"s":"sent Thu Nov 5, 7:00 AM ET"
}
],
"c":"rp-when"
}
]
},
{
"r":[
{
"s":"ZZ_d5_body"
}
],
"c":"rp-body rp-mail-body",
"fp":"4c8b69be"
}
]
}
]
},
{
"c":"rp-sec",
"k":[
{
"r":[
{
"s":"Team post"
}
],
"c":"rp-h"
},
{
"r":[
{
"s":"2. ZZ_d2_title "
},
{
"s":"e2e2e2e2e2e2",
"c":"rp-chip rp-n rp-mono"
}
],
"c":"rp-dtitle"
},
{
"r":[
{
"s":"The change: ZZ_d2_diff"
}
],
"c":"rp-foot",
"fp":"f43d2641"
},
{
"c":"rp-dc",
"k":[
{
"r":[
{
"s":"900000000000000099",
"c":"rp-mono"
},
{
"s":" · reply to "
},
{
"s":"900000000000000077",
"c":"rp-mono"
}
],
"c":"rp-dc-chan"
},
{
"c":"rp-dc-msg",
"k":[
{
"c":"rp-grow",
"k":[
{
"r":[
{
"s":"Jarvis "
},
{
"s":"APP",
"c":"rp-dc-bot"
},
{
"s":" "
},
{
"s":"not posted yet",
"c":"rp-dc-ts"
}
],
"c":"rp-dc-name"
},
{
"r":[
{
"s":"Update from "
},
{
"s":"@900000…",
"c":"rp-mention",
"m":"900000000000000003"
},
{
"s":" ZZ_d2_body "
},
{
"s":"ZZ_d2_bold",
"c":"rp-b"
}
],
"c":"rp-body rp-dc-body",
"fp":"3eee0738"
},
{
"r":[
{
"s":"Must act: "
},
{
"s":"@900000…",
"c":"rp-mention",
"m":"900000000000000002"
},
{
"s":" · FYI: "
},
{
"s":"@900000…",
"c":"rp-mention",
"m":"900000000000000004"
},
{
"s":" · Owners: aaaaaaaa zz_ticket_owner@massmarket.ai"
}
],
"c":"rp-dc-meta"
}
]
}
]
}
]
}
]
},
{
"c":"rp-sec",
"k":[
{
"r":[
{
"s":"Other items"
}
],
"c":"rp-h"
},
{
"c":"rp-item",
"k":[
{
"c":"rp-item-head",
"k":[
{
"c":"rp-grow",
"k":[
{
"r":[
{
"s":"4. ZZ_d4_title"
}
],
"c":"rp-from"
},
{
"r":[
{
"s":"HighLevel change"
}
],
"c":"rp-sub"
}
]
},
{
"r":[
{
"s":"e4e4e4e4e4e4",
"c":"rp-chip rp-n rp-mono"
}
]
}
]
},
{
"r":[
{
"s":"Kind: HighLevel change · location_id: ZZ_d4_location · thing: ZZ_d4_thing"
}
],
"c":"rp-foot",
"fp":"aebabfa1"
},
{
"r":[
{
"s":"The change: ZZ_d4_diff"
}
],
"c":"rp-foot",
"fp":"ff247b9f"
},
{
"r":[
{
"s":"ZZ_d4_body"
}
],
"c":"rp-body rp-pre",
"fp":"705be2cb"
}
]
}
]
},
{
"c":"rp-sec",
"k":[
{
"r":[
{
"s":"Follow-ups, sent only if they have not replied"
}
],
"c":"rp-h"
},
{
"r":[
{
"s":"⚠ ",
"c":"rp-icon"
},
{
"s":"Dry run: none of these steps will send while follow-ups are in dry run. The go still schedules them, so chase by hand until follow-ups go live."
}
],
"c":"rp-banner rp-warn"
},
{
"r":[
{
"s":"Counting from zz_anchor@massmarket.ai's email of Nov 3."
}
],
"c":"rp-foot",
"fp":"7fadff35"
},
{
"r":[
{
"s":"Each one goes only if nothing has come from ZZ_fu_sms_name since our reply. Any reply, booking or payment cancels the rest, and their message gets a new package with its own follow-ups."
}
],
"c":"rp-foot",
"fp":"999d540e"
},
{
"r":[
{
"s":"Goal: ZZ_goal_action. Done when: ZZ_goal_done."
}
],
"c":"rp-foot",
"fp":"98cf1afe"
},
{
"c":"rp-tl",
"k":[
{
"c":"rp-li",
"k":[
{
"c":"rp-grow",
"k":[
{
"r":[
{
"s":"1. Email · 2 business days after our reply (Thu 11-05 if the reply goes today) · same thread"
}
],
"c":"rp-tl-head",
"fp":"6bc61770"
},
{
"r":[
{
"s":"From: zz_fu_from@massmarket.ai · To: zz_fu_to@x.example · Cc: zz_fu_cc@x.example, support@letaidothehardwork.com, rob@massmarket.ai"
}
],
"c":"rp-foot",
"fp":"62094d70"
},
{
"r":[
{
"s":"Subject: ZZ_fu_subject"
}
],
"c":"rp-foot",
"fp":"e1630888"
},
{
"r":[
{
"s":"ZZ_fu_email_body"
}
],
"c":"rp-body rp-quote",
"fp":"9bb4ec0d"
}
]
}
]
},
{
"c":"rp-li",
"k":[
{
"c":"rp-grow",
"k":[
{
"r":[
{
"s":"2. Text · 3 business days after our reply (Fri 11-06 if the reply goes today)"
}
],
"c":"rp-tl-head",
"fp":"4563e3c9"
},
{
"r":[
{
"s":"To: ZZ_fu_sms_name · HighLevel contact ZZ_fu_sms_contact · +1 555-555-0142"
}
],
"c":"rp-foot",
"fp":"5f02baa8"
},
{
"r":[
{
"s":"ZZ_fu_sms_body"
}
],
"c":"rp-bub rp-bub-out rp-inline",
"fp":"98333d92"
}
]
}
]
},
{
"c":"rp-li",
"k":[
{
"c":"rp-grow",
"k":[
{
"r":[
{
"s":"3. LinkedIn voice note · 4 business days after our reply (Mon 11-09 if the reply goes today) · Rob's seat"
}
],
"c":"rp-tl-head",
"fp":"8d60b4ef"
},
{
"r":[
{
"s":"To: https://linkedin.example/zz_li"
}
],
"c":"rp-foot",
"fp":"95f5bca6"
},
{
"r":[
{
"s":"Audio: not made yet, so this step cannot send. Make it before the go."
}
],
"c":"rp-foot",
"fp":"19ae004b"
},
{
"r":[
{
"s":"ZZ_fu_voice_body"
}
],
"c":"rp-body rp-quote",
"fp":"0589618f"
}
]
}
]
},
{
"c":"rp-li",
"k":[
{
"c":"rp-grow",
"k":[
{
"r":[
{
"s":"4. Call task for ZZ_assignee · 5 business days after our reply (Tue 11-10 if the reply goes today) · only if they still have not replied"
}
],
"c":"rp-tl-head",
"fp":"3c57dae0"
},
{
"r":[
{
"s":"Why a call: ZZ_fu_call_why"
}
],
"c":"rp-foot",
"fp":"f0759ed8"
},
{
"r":[
{
"s":"ZZ_fu_call_body"
}
],
"c":"rp-body rp-quote",
"fp":"66330e45"
}
]
}
]
}
]
},
{
"r":[
{
"s":"Not shown: 1 cancelled step (ZZ_cancel_reason). Cancelled steps never send."
}
],
"c":"rp-foot",
"fp":"f9d7195e"
}
]
},
{
"c":"rp-sec",
"k":[
{
"r":[
{
"s":"Every question answered?"
}
],
"c":"rp-h"
},
{
"c":"rp-q",
"k":[
{
"r":[
{
"s":"Q1",
"c":"rp-qn"
}
]
},
{
"c":"rp-grow",
"k":[
{
"r":[
{
"s":"ZZ_q1_quote is it live?"
}
],
"c":"rp-qa rp-qa-them",
"fp":"10a5091d"
},
{
"r":[
{
"s":"yes ZZ_answer"
}
],
"c":"rp-qa rp-qa-us",
"fp":"006fbc6b"
}
]
},
{
"r":[
{
"s":"✓ ",
"c":"rp-mark rp-ok rp-icon"
},
{
"s":"answered",
"c":"rp-mark rp-ok"
}
]
}
]
}
]
},
{
"c":"rp-sec",
"k":[
{
"r":[
{
"s":"ETA or proof for every open ticket?"
}
],
"c":"rp-h"
},
{
"c":"rp-q",
"k":[
{
"r":[
{
"s":"aaaaaaaa",
"c":"rp-qn rp-mono"
}
]
},
{
"c":"rp-grow",
"k":[
{
"r":[
{
"s":"ZZ_ticket_title"
}
],
"c":"rp-qa",
"fp":"004bd9b7"
},
{
"r":[
{
"s":"Owner: zz_owner@massmarket.ai · Reply says: \"ZZ_ticket_quote\""
}
],
"c":"rp-foot",
"fp":"882634e1"
}
]
},
{
"r":[
{
"s":"✓ ",
"c":"rp-mark rp-ok rp-icon"
},
{
"s":"ETA Thu Nov 12, 3 h",
"c":"rp-mark rp-ok"
}
]
}
]
},
{
"c":"rp-q",
"k":[
{
"r":[
{
"s":"aaaaaaaa",
"c":"rp-qn rp-mono"
}
]
},
{
"c":"rp-grow",
"k":[
{
"r":[
{
"s":"ZZ_ticket2_title"
}
],
"c":"rp-qa",
"fp":"5cafda09"
},
{
"r":[
{
"s":"Owner: zz_owner2@massmarket.ai"
}
],
"c":"rp-foot",
"fp":"a5c4dc20"
}
]
},
{
"r":[
{
"s":"✗ ",
"c":"rp-mark rp-bad rp-icon"
},
{
"s":"Missing",
"c":"rp-mark rp-bad"
}
]
}
]
},
{
"r":[
{
"s":"⛔ ",
"c":"rp-icon"
},
{
"s":"1 of 2 open tickets have no ETA, proof or named wait from their owner in the drafts as they stand."
}
],
"c":"rp-banner rp-bad"
},
{
"r":[
{
"s":"OW only records this for now (observe). Get it before the go anyway."
}
],
"c":"rp-foot"
}
]
},
{
"c":"rp-sec",
"k":[
{
"r":[
{
"s":"Added by the team"
}
],
"c":"rp-h"
},
{
"r":[
{
"s":"zz_contrib@massmarket.ai · Thu Nov 5, 12:00 PM ET"
}
],
"c":"rp-noteby"
},
{
"r":[
{
"s":"ZZ_contribution"
}
],
"c":"rp-body rp-quote",
"fp":"99b3bf34"
}
]
},
{
"c":"rp-sec",
"k":[
{
"r":[
{
"s":"Findings"
}
],
"c":"rp-h"
},
{
"c":"rp-find",
"k":[
{
"r":[
{
"s":"1 item(s) added by the team."
}
],
"c":"rp-find-what",
"fp":"26aef38a"
},
{
"r":[
{
"s":"Recommend",
"c":"rp-k"
},
{
"s":" "
},
{
"s":"fold them into the client reply before the go.",
"c":"rp-v",
"fp":"7707953c"
}
],
"c":"rp-rec"
}
]
},
{
"c":"rp-find",
"k":[
{
"r":[
{
"s":"Rob: ZZ_decision."
}
],
"c":"rp-find-what",
"fp":"26b7e349"
},
{
"r":[
{
"s":"Recommend",
"c":"rp-k"
},
{
"s":" "
},
{
"s":"ZZ_decision_rec.",
"c":"rp-v",
"fp":"9ab02741"
}
],
"c":"rp-rec"
}
]
},
{
"c":"rp-find",
"k":[
{
"r":[
{
"s":"Only Rob knows: ZZ_fact."
}
],
"c":"rp-find-what",
"fp":"9b27d975"
},
{
"r":[
{
"s":"Recommend",
"c":"rp-k"
},
{
"s":" "
},
{
"s":"ZZ_fact_rec.",
"c":"rp-v",
"fp":"e621d591"
}
],
"c":"rp-rec"
}
]
},
{
"c":"rp-find",
"k":[
{
"r":[
{
"s":"Concession in draft 1 (credit, $50): \"ZZ_concession_text\"."
}
],
"c":"rp-find-what",
"fp":"336ae546"
}
]
},
{
"c":"rp-find",
"k":[
{
"r":[
{
"s":"Flag (ZZ_flagkind): ZZ_flag."
}
],
"c":"rp-find-what",
"fp":"aea551d2"
}
]
},
{
"r":[
{
"s":"2 more in the JSON read (without format=pickup)."
}
],
"c":"rp-foot"
}
]
},
{
"c":"rp-sec",
"k":[
{
"r":[
{
"s":"Links"
}
],
"c":"rp-h"
},
{
"c":"rp-links",
"k":[
{
"r":[
{
"s":"ZZ_link_label: "
},
{
"s":"https://x.example/zz_link",
"href":"https://x.example/zz_link"
}
],
"c":"rp-li"
},
{
"r":[
{
"s":"ZZ_source_title: "
},
{
"s":"https://x.example/zz_source",
"href":"https://x.example/zz_source"
}
],
"c":"rp-li"
},
{
"r":[
{
"s":"Draft 1 attachment: p/zz_attach_path.pdf"
}
],
"c":"rp-li"
},
{
"r":[
{
"s":"Draft 4 document: "
},
{
"s":"https://drive.google.com/open?id=1abcdefghijklmnopqrstuvwxyz",
"href":"https://drive.google.com/open?id=1abcdefghijklmnopqrstuvwxyz"
}
],
"c":"rp-li"
},
{
"r":[
{
"s":"Draft 4 preview: "
},
{
"s":"https://x.example/zz_preview",
"href":"https://x.example/zz_preview"
}
],
"c":"rp-li"
},
{
"r":[
{
"s":"Draft 4 live site: "
},
{
"s":"https://x.example/zz_prod",
"href":"https://x.example/zz_prod"
}
],
"c":"rp-li"
},
{
"r":[
{
"s":"Draft 4 before: zz_before · after: zz_after"
}
],
"c":"rp-li"
},
{
"r":[
{
"s":"Draft 5 sent: zz_sent_ref"
}
],
"c":"rp-li"
}
]
}
]
},
{
"c":"rp-go",
"k":[
{
"r":[
{
"s":"One go sends all 4 items now and schedules 4 follow-ups. Package 3f1c9a7e5b2d."
}
],
"c":"rp-closing",
"fp":"5a1f9758"
},
{
"r":[
{
"s":"⚠ ",
"c":"rp-icon"
},
{
"s":"1 open ticket(s) have no ETA, proof or named wait"
}
],
"c":"rp-banner rp-warn"
},
{
"r":[
{
"s":"⚠ ",
"c":"rp-icon"
},
{
"s":"the last approval is stale: ZZ_stale_reason"
}
],
"c":"rp-banner rp-warn"
},
{
"r":[
{
"s":"⚠ ",
"c":"rp-icon"
},
{
"s":"needs Rob's OK: draft 1 (in Rob's session his go records it)"
}
],
"c":"rp-banner rp-warn"
},
{
"c":"rp-actions",
"k":[
{
"sign":{
"label":"3f1c9a7e5b2d",
"signer":"Test Signer"
}
}
]
}
]
}
]
}
},
"rob's mail, plan not approved":{
"page":"## ZZ_client (Dana) · reply package · Package `3f1c9a7e5b2d`\n\n### Every question answered?\n| # | They asked | Our reply says | |\n|---|---|---|---|\n| 1 | ZZ_q1_quote is it live? | \"yes ZZ_answer\" | ✅ |\n\n### ETA or proof for every open ticket?\n| # | Ticket | Owner | The reply gives | Our reply says |\n|---|---|---|---|---|\n| 1 | `aaaaaaaa` ZZ_ticket_title | zz_owner@massmarket.ai | ETA Thu Nov 12, 3 h | \"ZZ_ticket_quote\" |\n| 2 | `aaaaaaaa` ZZ_ticket2_title | zz_owner2@massmarket.ai | ⛔ Missing | — |\n\n⛔ 1 of 2 open tickets have no ETA, proof or named wait from their owner in the drafts as they stand.\nOW only records this for now (observe). Get it before the go anyway.\n\n### Their message\nEverything since our last reply, Mon Nov 2, 7:00 AM ET: ZZ_went_out_what.\n\n#### ZZ_inb_from · Thu Nov 5, 10:00 AM ET · gmail\nTo: zz_inb_to@x.example · Cc: zz_inb_cc@x.example · Subject: ZZ_hdr_subject\n> ```text\n> Hi team, ZZ_inbound_email_words, is it live? And Saturday?\n> ```\n\n_Quoted history below this point was removed: it starts \"On Mon Nov 2 2026 Rob wrote: > old stuff ZZ_quoted_history\". Source: doc `dddddddd`._\n\n#### Dana · Thu Nov 5, 11:00 AM ET · call\nTheir words, an excerpt the package stored; the whole document is doc `dddddddd`:\n> ```text\n> ZZ_call_excerpt\n> ```\n\n#### Dana · Thu Nov 5, 11:20 AM ET · portal\n_Doc `dddddddd` (document) is not the message itself, and the package stored none of their words for it. Summary from the package: ZZ_nonmsg_summary_\n\n**Attachment** (Thu Nov 5, 11:10 AM ET): ZZ_attach_summary · our transcription is doc `dddddddd`\n\nEarlier messages, already answered by our last reply:\n- Sun Nov 1, 11:20 AM ET, gmail: ZZ_older_summary (doc `dddddddd`)\n\n### Client reply\nZZ_reply_owed_why.\n\n#### 1. ZZ_d1_title\n**To:** zz_d1_to@x.example · **Cc:** (none) · **Subject:** ZZ_d1_subject · **From:** rob@massmarket.ai · **Channel:** gmail · hash `e1e1e1e1e1e1` · ⚠️ needs Rob's OK\n**The change:** ZZ_d1_diff\n```text\nHi Dana, ZZ_d1_body yes ZZ_answer.\n\nSecond paragraph ZZ_d1_body2.\n```\n\n#### 5. ZZ_d5_title\n_Already sent Thu Nov 5, 7:00 AM ET by zz_sent_by@massmarket.ai (zz_sent_ref). One go does not send it again._\n\n### Team post\n\n#### 2. ZZ_d2_title\n**Channel:** 900000000000000099 · **Must act:** <@900000000000000002> · **FYI:** <@900000000000000004> · **Owners:** `aaaaaaaa` zz_ticket_owner@massmarket.ai · **In reply to:** 900000000000000077 · hash `e2e2e2e2e2e2`\n**The change:** ZZ_d2_diff\n```text\nUpdate from <@900000000000000003> ZZ_d2_body **ZZ_d2_bold**\n```\n\n### Added by the team\n\n#### zz_contrib@massmarket.ai · Thu Nov 5, 12:00 PM ET\n> ```text\n> ZZ_contribution\n> ```\n\n### Follow-ups (sent only if they have not replied)\nDry run: none of these steps will send while follow-ups are in dry run. The go still schedules them, so chase by hand until follow-ups go live.\nCounting from zz_anchor@massmarket.ai's email of Nov 3.\nEach one goes only if nothing has come from ZZ_fu_sms_name since our reply. Any reply, booking or payment cancels the rest, and their message gets a new package with its own follow-ups.\nGoal: ZZ_goal_action. Done when: ZZ_goal_done.\n\n**1. Email · 2 business days after our reply (Thu 11-05 if the reply goes today) · same thread**\nFrom: zz_fu_from@massmarket.ai · To: zz_fu_to@x.example · Cc: zz_fu_cc@x.example, support@letaidothehardwork.com, rob@massmarket.ai\nSubject: ZZ_fu_subject\n> ```text\n> ZZ_fu_email_body\n> ```\n\n**2. Text · 3 business days after our reply (Fri 11-06 if the reply goes today)**\nTo: ZZ_fu_sms_name · HighLevel contact ZZ_fu_sms_contact · +1 555-555-0142\n> ```text\n> ZZ_fu_sms_body\n> ```\n\n**3. LinkedIn voice note · 4 business days after our reply (Mon 11-09 if the reply goes today) · Rob's seat**\nTo: https://linkedin.example/zz_li\nTranscript:\n> ```text\n> ZZ_fu_voice_body\n> ```\nAudio: not made yet, so this step cannot send. Make it before the go.\n\n**4. Call task for ZZ_assignee · 5 business days after our reply (Tue 11-10 if the reply goes today) · only if they still have not replied**\nWhy a call: ZZ_fu_call_why\n> ```text\n> ZZ_fu_call_body\n> ```\n\nNot shown: 1 cancelled step (ZZ_cancel_reason). Cancelled steps never send.\n\n### Other items\n\n#### 3. ZZ_d3_title\n**Kind:** Text message · **channel:** highlevel_sms · **location_id:** ZZ_d3_location · **contact_id:** ZZ_d3_contact · **to_phone:** +15555550143 · **to_name:** ZZ_d3_name · hash `e3e3e3e3e3e3`\n**The change:** ZZ_d3_diff\n```text\nZZ_d3_sms_body\n```\n\n#### 4. ZZ_d4_title\n**Kind:** HighLevel change · **location_id:** ZZ_d4_location · **thing:** ZZ_d4_thing · hash `e4e4e4e4e4e4`\n**The change:** ZZ_d4_diff\n```text\nZZ_d4_body\n```\n\n### Links\n- ZZ_link_label: https://x.example/zz_link\n- ZZ_source_title: https://x.example/zz_source\n- Draft 1 attachment: `p/zz_attach_path.pdf`\n- Draft 4 document: https://drive.google.com/open?id=1abcdefghijklmnopqrstuvwxyz\n- Draft 4 preview: https://x.example/zz_preview\n- Draft 4 live site: https://x.example/zz_prod\n- Draft 4 before: `zz_before` · after: `zz_after`\n- Draft 5 sent: `zz_sent_ref`\n\n### Findings\n- 1 item(s) added by the team. Recommend: fold them into the client reply before the go.\n- Rob: ZZ_decision. Recommend: ZZ_decision_rec.\n- Only Rob knows: ZZ_fact. Recommend: ZZ_fact_rec.\n- Concession in draft 1 (credit, $50): \"ZZ_concession_text\".\n- Flag (ZZ_flagkind): ZZ_flag.\n_2 more in the JSON read (without format=pickup)._\n\nOne go sends all 4 items now and schedules 4 follow-ups. Package `3f1c9a7e5b2d`.\n",
"tree":{
"v":1,
"package_id":"aaaaaaaa-1111-4222-8333-444444444444",
"project_id":"bbbbbbbb-1111-4222-8333-444444444444",
"client":"ZZ_client (Dana)",
"package_sha256":"3f1c9a7e5b2d4c6a8e0f1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f",
"label":"3f1c9a7e5b2d",
"blocks":71,
"signer":"Test Signer",
"can_sign":true,
"images":0,
"rendered_at":"2026-11-06T15:00:00Z",
"nodes":[
{
"c":"rp-head",
"k":[
{
"r":[
{
"s":"ZC"
}
],
"c":"rp-av rp-av-client"
},
{
"c":"rp-grow",
"k":[
{
"r":[
{
"s":"ZZ_client (Dana)"
}
],
"c":"rp-title"
},
{
"r":[
{
"s":"Reply package · "
},
{
"s":"3f1c9a7e5b2d",
"c":"rp-mono"
}
],
"c":"rp-sub"
}
]
},
{
"r":[
{
"s":"Green",
"c":"rp-chip rp-ok"
},
{
"s":" "
},
{
"s":"prepared",
"c":"rp-chip rp-n"
}
],
"c":"rp-chips"
}
]
},
{
"c":"rp-note",
"k":[
{
"r":[
{
"s":"ZZ_whats_new"
}
],
"c":"rp-whatsnew",
"fp":"f3dd1078"
}
]
},
{
"c":"rp-sec",
"k":[
{
"r":[
{
"s":"Their message"
}
],
"c":"rp-h"
},
{
"r":[
{
"s":"Everything since our last reply, Mon Nov 2, 7:00 AM ET: ZZ_went_out_what."
}
],
"c":"rp-foot",
"fp":"0200ba3a"
},
{
"c":"rp-mail",
"k":[
{
"r":[
{
"s":"ZZ_hdr_subject",
"c":"rp-subj",
"fp":"2ddbffb7"
}
],
"c":"rp-mail-subj"
},
{
"c":"rp-mail-from",
"k":[
{
"r":[
{
"s":"ZI"
}
],
"c":"rp-av"
},
{
"c":"rp-grow",
"k":[
{
"r":[
{
"s":"ZZ_inb_from"
}
],
"c":"rp-from",
"fp":"f9fbc4b6"
},
{
"r":[
{
"s":"To",
"c":"rp-k"
},
{
"s":" "
},
{
"s":"zz_inb_to@x.example",
"c":"rp-v",
"fp":"8a3a7eeb"
}
],
"c":"rp-hdr"
},
{
"r":[
{
"s":"Cc",
"c":"rp-k"
},
{
"s":" "
},
{
"s":"zz_inb_cc@x.example",
"c":"rp-v",
"fp":"2e02030c"
}
],
"c":"rp-hdr"
}
]
},
{
"r":[
{
"s":"Thu Nov 5, 10:00 AM ET · gmail"
}
],
"c":"rp-when"
}
]
},
{
"r":[
{
"s":"Hi team, ZZ_inbound_email_words, is it live? And Saturday?"
}
],
"c":"rp-body rp-mail-body",
"fp":"3048517f"
}
]
},
{
"r":[
{
"s":"Quoted history below this point was removed: it starts \"On Mon Nov 2 2026 Rob wrote: > old stuff ZZ_quoted_history\". Source: doc dddddddd."
}
],
"c":"rp-foot",
"fp":"caa98759"
},
{
"c":"rp-call",
"k":[
{
"c":"rp-call-head",
"k":[
{
"r":[
{
"s":"📞",
"c":"rp-icon"
}
]
},
{
"c":"rp-grow",
"k":[
{
"r":[
{
"s":"ZZ_call_title"
}
],
"c":"rp-from"
},
{
"r":[
{
"s":"Dana · Thu Nov 5, 11:00 AM ET · call · transcript · doc "
},
{
"s":"dddddddd",
"c":"rp-mono"
}
],
"c":"rp-sub"
}
]
}
]
},
{
"r":[
{
"s":"Their words, an excerpt the package stored; the whole document is doc dddddddd:"
}
],
"c":"rp-foot",
"fp":"58d9ba54"
},
{
"c":"rp-turn rp-turn-q",
"k":[
{
"r":[
{
"s":"Dana"
}
],
"c":"rp-turn-who rp-them"
},
{
"r":[
{
"s":"ZZ_call_excerpt"
}
],
"c":"rp-turn-text",
"fp":"2d51b9c4"
}
]
},
{
"btn":"Read the whole transcript ↗",
"ask":"Show me doc dddddddd from package 3f1c9a7e5b2d in full.",
"c":"rp-btn rp-btn-s"
}
]
},
{
"r":[
{
"s":"📎 ",
"c":"rp-icon"
},
{
"s":"Attachment (Thu Nov 5, 11:10 AM ET): ZZ_attach_summary · our transcription is doc dddddddd",
"c":"rp-v",
"fp":"0ec579ca"
}
],
"c":"rp-att"
},
{
"r":[
{
"s":"Dana · Thu Nov 5, 11:20 AM ET · portal"
}
],
"c":"rp-from",
"fp":"6ae8ebd1"
},
{
"r":[
{
"s":"Doc dddddddd (document) is not the message itself, and the package stored none of their words for it. Summary from the package: ZZ_nonmsg_summary"
}
],
"c":"rp-foot",
"fp":"cbd4e7e9"
},
{
"r":[
{
"s":"Earlier messages, already answered by our last reply:"
}
],
"c":"rp-foot"
},
{
"r":[
{
"s":"Sun Nov 1, 11:20 AM ET, gmail: ZZ_older_summary (doc dddddddd)"
}
],
"c":"rp-foot",
"fp":"a64faa01"
}
]
},
{
"c":"rp-sec",
"k":[
{
"r":[
{
"s":"Our reply to the client"
}
],
"c":"rp-h"
},
{
"r":[
{
"s":"ZZ_reply_owed_why."
}
],
"c":"rp-foot",
"fp":"df5a8011"
},
{
"r":[
{
"s":"1. ZZ_d1_title"
}
],
"c":"rp-dtitle"
},
{
"r":[
{
"s":"The change: ZZ_d1_diff"
}
],
"c":"rp-foot",
"fp":"a60a702a"
},
{
"c":"rp-mail",
"k":[
{
"r":[
{
"s":"ZZ_d1_subject",
"c":"rp-subj",
"fp":"95cba2fa"
},
{
"s":" "
},
{
"s":"👤 ",
"c":"rp-chip rp-warn rp-icon"
},
{
"s":"needs Rob's OK",
"c":"rp-chip rp-warn"
},
{
"s":" "
},
{
"s":"e1e1e1e1e1e1",
"c":"rp-chip rp-n rp-mono"
}
],
"c":"rp-mail-subj"
},
{
"c":"rp-mail-from",
"k":[
{
"r":[
{
"s":"RM"
}
],
"c":"rp-av"
},
{
"c":"rp-grow",
"k":[
{
"r":[
{
"s":"rob@massmarket.ai"
}
],
"c":"rp-from",
"fp":"6b6fbdfc"
},
{
"r":[
{
"s":"To",
"c":"rp-k"
},
{
"s":" "
},
{
"s":"zz_d1_to@x.example",
"c":"rp-v",
"fp":"b9c594e7"
}
],
"c":"rp-hdr"
},
{
"r":[
{
"s":"Cc",
"c":"rp-k"
},
{
"s":" "
},
{
"s":"(none)",
"c":"rp-v",
"fp":"90458a20"
}
],
"c":"rp-hdr"
},
{
"r":[
{
"s":"Bcc",
"c":"rp-k"
},
{
"s":" "
},
{
"s":"zz_d1_bcc@x.example",
"c":"rp-v",
"fp":"1f33a60a"
}
],
"c":"rp-hdr"
},
{
"r":[
{
"s":"Attached",
"c":"rp-k"
},
{
"s":" "
},
{
"s":"ZZ_d1_attach.pdf",
"c":"rp-v",
"fp":"4927ecd3"
}
],
"c":"rp-hdr"
}
]
},
{
"r":[
{
"s":"in thread · gmail"
}
],
"c":"rp-when"
}
]
},
{
"r":[
{
"s":"Hi Dana, ZZ_d1_body yes ZZ_answer.\n\nSecond paragraph ZZ_d1_body2."
}
],
"c":"rp-body rp-mail-body",
"fp":"1d0a305c"
}
]
},
{
"r":[
{
"s":"3. ZZ_d3_title "
},
{
"s":"e3e3e3e3e3e3",
"c":"rp-chip rp-n rp-mono"
}
],
"c":"rp-dtitle"
},
{
"r":[
{
"s":"Kind: Text message · channel: highlevel_sms · location_id: ZZ_d3_location · contact_id: ZZ_d3_contact · to_phone: +15555550143 · to_name: ZZ_d3_name"
}
],
"c":"rp-foot",
"fp":"d6e38edc"
},
{
"r":[
{
"s":"The change: ZZ_d3_diff"
}
],
"c":"rp-foot",
"fp":"63472b00"
},
{
"c":"rp-phone rp-sms",
"k":[
{
"r":[
{
"s":"ZZ_d3_name · +1 555-555-0143 · HighLevel contact ZZ_d3_contact"
}
],
"c":"rp-phone-head"
},
{
"c":"rp-row rp-out",
"k":[
{
"r":[
{
"s":"ZZ_d3_sms_body"
}
],
"c":"rp-bub rp-bub-out",
"fp":"6de05c72"
},
{
"r":[
{
"s":"Our reply · sends on the go"
}
],
"c":"rp-bmeta"
}
]
}
]
},
{
"r":[
{
"s":"5. ZZ_d5_title"
}
],
"c":"rp-dtitle"
},
{
"r":[
{
"s":"Already sent Thu Nov 5, 7:00 AM ET by zz_sent_by@massmarket.ai (zz_sent_ref). One go does not send it again."
}
],
"c":"rp-foot",
"fp":"a56879e3"
},
{
"c":"rp-mail",
"k":[
{
"r":[
{
"s":"ZZ_d5_subject",
"c":"rp-subj",
"fp":"fabe4bae"
},
{
"s":" "
},
{
"s":"✓ ",
"c":"rp-chip rp-ok rp-icon"
},
{
"s":"already sent",
"c":"rp-chip rp-ok"
},
{
"s":" "
},
{
"s":"e5e5e5e5e5e5",
"c":"rp-chip rp-n rp-mono"
}
],
"c":"rp-mail-subj"
},
{
"c":"rp-mail-from",
"k":[
{
"r":[
{
"s":"?"
}
],
"c":"rp-av"
},
{
"c":"rp-grow",
"k":[
{
"r":[
{
"s":"(sender not named)"
}
],
"c":"rp-from",
"fp":"c8148d99"
},
{
"r":[
{
"s":"To",
"c":"rp-k"
},
{
"s":" "
},
{
"s":"zz_d5_to@x.example",
"c":"rp-v",
"fp":"8eff76f3"
}
],
"c":"rp-hdr"
},
{
"r":[
{
"s":"Cc",
"c":"rp-k"
},
{
"s":" "
},
{
"s":"(none)",
"c":"rp-v",
"fp":"90458a20"
}
],
"c":"rp-hdr"
}
]
},
{
"r":[
{
"s":"sent Thu Nov 5, 7:00 AM ET"
}
],
"c":"rp-when"
}
]
},
{
"r":[
{
"s":"ZZ_d5_body"
}
],
"c":"rp-body rp-mail-body",
"fp":"4c8b69be"
}
]
}
]
},
{
"c":"rp-sec",
"k":[
{
"r":[
{
"s":"Team post"
}
],
"c":"rp-h"
},
{
"r":[
{
"s":"2. ZZ_d2_title "
},
{
"s":"e2e2e2e2e2e2",
"c":"rp-chip rp-n rp-mono"
}
],
"c":"rp-dtitle"
},
{
"r":[
{
"s":"The change: ZZ_d2_diff"
}
],
"c":"rp-foot",
"fp":"f43d2641"
},
{
"c":"rp-dc",
"k":[
{
"r":[
{
"s":"900000000000000099",
"c":"rp-mono"
},
{
"s":" · reply to "
},
{
"s":"900000000000000077",
"c":"rp-mono"
}
],
"c":"rp-dc-chan"
},
{
"c":"rp-dc-msg",
"k":[
{
"c":"rp-grow",
"k":[
{
"r":[
{
"s":"Jarvis "
},
{
"s":"APP",
"c":"rp-dc-bot"
},
{
"s":" "
},
{
"s":"not posted yet",
"c":"rp-dc-ts"
}
],
"c":"rp-dc-name"
},
{
"r":[
{
"s":"Update from "
},
{
"s":"@900000…",
"c":"rp-mention",
"m":"900000000000000003"
},
{
"s":" ZZ_d2_body "
},
{
"s":"ZZ_d2_bold",
"c":"rp-b"
}
],
"c":"rp-body rp-dc-body",
"fp":"3eee0738"
},
{
"r":[
{
"s":"Must act: "
},
{
"s":"@900000…",
"c":"rp-mention",
"m":"900000000000000002"
},
{
"s":" · FYI: "
},
{
"s":"@900000…",
"c":"rp-mention",
"m":"900000000000000004"
},
{
"s":" · Owners: aaaaaaaa zz_ticket_owner@massmarket.ai"
}
],
"c":"rp-dc-meta"
}
]
}
]
}
]
}
]
},
{
"c":"rp-sec",
"k":[
{
"r":[
{
"s":"Other items"
}
],
"c":"rp-h"
},
{
"c":"rp-item",
"k":[
{
"c":"rp-item-head",
"k":[
{
"c":"rp-grow",
"k":[
{
"r":[
{
"s":"4. ZZ_d4_title"
}
],
"c":"rp-from"
},
{
"r":[
{
"s":"HighLevel change"
}
],
"c":"rp-sub"
}
]
},
{
"r":[
{
"s":"e4e4e4e4e4e4",
"c":"rp-chip rp-n rp-mono"
}
]
}
]
},
{
"r":[
{
"s":"Kind: HighLevel change · location_id: ZZ_d4_location · thing: ZZ_d4_thing"
}
],
"c":"rp-foot",
"fp":"aebabfa1"
},
{
"r":[
{
"s":"The change: ZZ_d4_diff"
}
],
"c":"rp-foot",
"fp":"ff247b9f"
},
{
"r":[
{
"s":"ZZ_d4_body"
}
],
"c":"rp-body rp-pre",
"fp":"705be2cb"
}
]
}
]
},
{
"c":"rp-sec",
"k":[
{
"r":[
{
"s":"Follow-ups, sent only if they have not replied"
}
],
"c":"rp-h"
},
{
"r":[
{
"s":"⚠ ",
"c":"rp-icon"
},
{
"s":"Dry run: none of these steps will send while follow-ups are in dry run. The go still schedules them, so chase by hand until follow-ups go live."
}
],
"c":"rp-banner rp-warn"
},
{
"r":[
{
"s":"Counting from zz_anchor@massmarket.ai's email of Nov 3."
}
],
"c":"rp-foot",
"fp":"7fadff35"
},
{
"r":[
{
"s":"Each one goes only if nothing has come from ZZ_fu_sms_name since our reply. Any reply, booking or payment cancels the rest, and their message gets a new package with its own follow-ups."
}
],
"c":"rp-foot",
"fp":"999d540e"
},
{
"r":[
{
"s":"Goal: ZZ_goal_action. Done when: ZZ_goal_done."
}
],
"c":"rp-foot",
"fp":"98cf1afe"
},
{
"c":"rp-tl",
"k":[
{
"c":"rp-li",
"k":[
{
"c":"rp-grow",
"k":[
{
"r":[
{
"s":"1. Email · 2 business days after our reply (Thu 11-05 if the reply goes today) · same thread"
}
],
"c":"rp-tl-head",
"fp":"6bc61770"
},
{
"r":[
{
"s":"From: zz_fu_from@massmarket.ai · To: zz_fu_to@x.example · Cc: zz_fu_cc@x.example, support@letaidothehardwork.com, rob@massmarket.ai"
}
],
"c":"rp-foot",
"fp":"62094d70"
},
{
"r":[
{
"s":"Subject: ZZ_fu_subject"
}
],
"c":"rp-foot",
"fp":"e1630888"
},
{
"r":[
{
"s":"ZZ_fu_email_body"
}
],
"c":"rp-body rp-quote",
"fp":"9bb4ec0d"
}
]
}
]
},
{
"c":"rp-li",
"k":[
{
"c":"rp-grow",
"k":[
{
"r":[
{
"s":"2. Text · 3 business days after our reply (Fri 11-06 if the reply goes today)"
}
],
"c":"rp-tl-head",
"fp":"4563e3c9"
},
{
"r":[
{
"s":"To: ZZ_fu_sms_name · HighLevel contact ZZ_fu_sms_contact · +1 555-555-0142"
}
],
"c":"rp-foot",
"fp":"5f02baa8"
},
{
"r":[
{
"s":"ZZ_fu_sms_body"
}
],
"c":"rp-bub rp-bub-out rp-inline",
"fp":"98333d92"
}
]
}
]
},
{
"c":"rp-li",
"k":[
{
"c":"rp-grow",
"k":[
{
"r":[
{
"s":"3. LinkedIn voice note · 4 business days after our reply (Mon 11-09 if the reply goes today) · Rob's seat"
}
],
"c":"rp-tl-head",
"fp":"8d60b4ef"
},
{
"r":[
{
"s":"To: https://linkedin.example/zz_li"
}
],
"c":"rp-foot",
"fp":"95f5bca6"
},
{
"r":[
{
"s":"Audio: not made yet, so this step cannot send. Make it before the go."
}
],
"c":"rp-foot",
"fp":"19ae004b"
},
{
"r":[
{
"s":"ZZ_fu_voice_body"
}
],
"c":"rp-body rp-quote",
"fp":"0589618f"
}
]
}
]
},
{
"c":"rp-li",
"k":[
{
"c":"rp-grow",
"k":[
{
"r":[
{
"s":"4. Call task for ZZ_assignee · 5 business days after our reply (Tue 11-10 if the reply goes today) · only if they still have not replied"
}
],
"c":"rp-tl-head",
"fp":"3c57dae0"
},
{
"r":[
{
"s":"Why a call: ZZ_fu_call_why"
}
],
"c":"rp-foot",
"fp":"f0759ed8"
},
{
"r":[
{
"s":"ZZ_fu_call_body"
}
],
"c":"rp-body rp-quote",
"fp":"66330e45"
}
]
}
]
}
]
},
{
"r":[
{
"s":"Not shown: 1 cancelled step (ZZ_cancel_reason). Cancelled steps never send."
}
],
"c":"rp-foot",
"fp":"f9d7195e"
}
]
},
{
"c":"rp-sec",
"k":[
{
"r":[
{
"s":"Every question answered?"
}
],
"c":"rp-h"
},
{
"c":"rp-q",
"k":[
{
"r":[
{
"s":"Q1",
"c":"rp-qn"
}
]
},
{
"c":"rp-grow",
"k":[
{
"r":[
{
"s":"ZZ_q1_quote is it live?"
}
],
"c":"rp-qa rp-qa-them",
"fp":"10a5091d"
},
{
"r":[
{
"s":"yes ZZ_answer"
}
],
"c":"rp-qa rp-qa-us",
"fp":"006fbc6b"
}
]
},
{
"r":[
{
"s":"✓ ",
"c":"rp-mark rp-ok rp-icon"
},
{
"s":"answered",
"c":"rp-mark rp-ok"
}
]
}
]
}
]
},
{
"c":"rp-sec",
"k":[
{
"r":[
{
"s":"ETA or proof for every open ticket?"
}
],
"c":"rp-h"
},
{
"c":"rp-q",
"k":[
{
"r":[
{
"s":"aaaaaaaa",
"c":"rp-qn rp-mono"
}
]
},
{
"c":"rp-grow",
"k":[
{
"r":[
{
"s":"ZZ_ticket_title"
}
],
"c":"rp-qa",
"fp":"004bd9b7"
},
{
"r":[
{
"s":"Owner: zz_owner@massmarket.ai · Reply says: \"ZZ_ticket_quote\""
}
],
"c":"rp-foot",
"fp":"882634e1"
}
]
},
{
"r":[
{
"s":"✓ ",
"c":"rp-mark rp-ok rp-icon"
},
{
"s":"ETA Thu Nov 12, 3 h",
"c":"rp-mark rp-ok"
}
]
}
]
},
{
"c":"rp-q",
"k":[
{
"r":[
{
"s":"aaaaaaaa",
"c":"rp-qn rp-mono"
}
]
},
{
"c":"rp-grow",
"k":[
{
"r":[
{
"s":"ZZ_ticket2_title"
}
],
"c":"rp-qa",
"fp":"5cafda09"
},
{
"r":[
{
"s":"Owner: zz_owner2@massmarket.ai"
}
],
"c":"rp-foot",
"fp":"a5c4dc20"
}
]
},
{
"r":[
{
"s":"✗ ",
"c":"rp-mark rp-bad rp-icon"
},
{
"s":"Missing",
"c":"rp-mark rp-bad"
}
]
}
]
},
{
"r":[
{
"s":"⛔ ",
"c":"rp-icon"
},
{
"s":"1 of 2 open tickets have no ETA, proof or named wait from their owner in the drafts as they stand."
}
],
"c":"rp-banner rp-bad"
},
{
"r":[
{
"s":"OW only records this for now (observe). Get it before the go anyway."
}
],
"c":"rp-foot"
}
]
},
{
"c":"rp-sec",
"k":[
{
"r":[
{
"s":"Added by the team"
}
],
"c":"rp-h"
},
{
"r":[
{
"s":"zz_contrib@massmarket.ai · Thu Nov 5, 12:00 PM ET"
}
],
"c":"rp-noteby"
},
{
"r":[
{
"s":"ZZ_contribution"
}
],
"c":"rp-body rp-quote",
"fp":"99b3bf34"
}
]
},
{
"c":"rp-sec",
"k":[
{
"r":[
{
"s":"Findings"
}
],
"c":"rp-h"
},
{
"c":"rp-find",
"k":[
{
"r":[
{
"s":"1 item(s) added by the team."
}
],
"c":"rp-find-what",
"fp":"26aef38a"
},
{
"r":[
{
"s":"Recommend",
"c":"rp-k"
},
{
"s":" "
},
{
"s":"fold them into the client reply before the go.",
"c":"rp-v",
"fp":"7707953c"
}
],
"c":"rp-rec"
}
]
},
{
"c":"rp-find",
"k":[
{
"r":[
{
"s":"Rob: ZZ_decision."
}
],
"c":"rp-find-what",
"fp":"26b7e349"
},
{
"r":[
{
"s":"Recommend",
"c":"rp-k"
},
{
"s":" "
},
{
"s":"ZZ_decision_rec.",
"c":"rp-v",
"fp":"9ab02741"
}
],
"c":"rp-rec"
}
]
},
{
"c":"rp-find",
"k":[
{
"r":[
{
"s":"Only Rob knows: ZZ_fact."
}
],
"c":"rp-find-what",
"fp":"9b27d975"
},
{
"r":[
{
"s":"Recommend",
"c":"rp-k"
},
{
"s":" "
},
{
"s":"ZZ_fact_rec.",
"c":"rp-v",
"fp":"e621d591"
}
],
"c":"rp-rec"
}
]
},
{
"c":"rp-find",
"k":[
{
"r":[
{
"s":"Concession in draft 1 (credit, $50): \"ZZ_concession_text\"."
}
],
"c":"rp-find-what",
"fp":"336ae546"
}
]
},
{
"c":"rp-find",
"k":[
{
"r":[
{
"s":"Flag (ZZ_flagkind): ZZ_flag."
}
],
"c":"rp-find-what",
"fp":"aea551d2"
}
]
},
{
"r":[
{
"s":"2 more in the JSON read (without format=pickup)."
}
],
"c":"rp-foot"
}
]
},
{
"c":"rp-sec",
"k":[
{
"r":[
{
"s":"Links"
}
],
"c":"rp-h"
},
{
"c":"rp-links",
"k":[
{
"r":[
{
"s":"ZZ_link_label: "
},
{
"s":"https://x.example/zz_link",
"href":"https://x.example/zz_link"
}
],
"c":"rp-li"
},
{
"r":[
{
"s":"ZZ_source_title: "
},
{
"s":"https://x.example/zz_source",
"href":"https://x.example/zz_source"
}
],
"c":"rp-li"
},
{
"r":[
{
"s":"Draft 1 attachment: p/zz_attach_path.pdf"
}
],
"c":"rp-li"
},
{
"r":[
{
"s":"Draft 4 document: "
},
{
"s":"https://drive.google.com/open?id=1abcdefghijklmnopqrstuvwxyz",
"href":"https://drive.google.com/open?id=1abcdefghijklmnopqrstuvwxyz"
}
],
"c":"rp-li"
},
{
"r":[
{
"s":"Draft 4 preview: "
},
{
"s":"https://x.example/zz_preview",
"href":"https://x.example/zz_preview"
}
],
"c":"rp-li"
},
{
"r":[
{
"s":"Draft 4 live site: "
},
{
"s":"https://x.example/zz_prod",
"href":"https://x.example/zz_prod"
}
],
"c":"rp-li"
},
{
"r":[
{
"s":"Draft 4 before: zz_before · after: zz_after"
}
],
"c":"rp-li"
},
{
"r":[
{
"s":"Draft 5 sent: zz_sent_ref"
}
],
"c":"rp-li"
}
]
}
]
},
{
"c":"rp-go",
"k":[
{
"r":[
{
"s":"One go sends all 4 items now and schedules 4 follow-ups. Package 3f1c9a7e5b2d."
}
],
"c":"rp-closing",
"fp":"5a1f9758"
},
{
"r":[
{
"s":"⚠ ",
"c":"rp-icon"
},
{
"s":"1 open ticket(s) have no ETA, proof or named wait"
}
],
"c":"rp-banner rp-warn"
},
{
"r":[
{
"s":"⚠ ",
"c":"rp-icon"
},
{
"s":"the last approval is stale: ZZ_stale_reason"
}
],
"c":"rp-banner rp-warn"
},
{
"r":[
{
"s":"⚠ ",
"c":"rp-icon"
},
{
"s":"needs Rob's OK: draft 1 (in Rob's session his go records it)"
}
],
"c":"rp-banner rp-warn"
},
{
"c":"rp-actions",
"k":[
{
"sign":{
"label":"3f1c9a7e5b2d",
"signer":"Test Signer"
}
}
]
}
]
}
]
}
},
"rob's mail, plan approved":{
"page":"## ZZ_client (Dana) · reply package · Package `3f1c9a7e5b2d`\n\n### Every question answered?\n| # | They asked | Our reply says | |\n|---|---|---|---|\n| 1 | ZZ_q1_quote is it live? | \"yes ZZ_answer\" | ✅ |\n\n### ETA or proof for every open ticket?\n| # | Ticket | Owner | The reply gives | Our reply says |\n|---|---|---|---|---|\n| 1 | `aaaaaaaa` ZZ_ticket_title | zz_owner@massmarket.ai | ETA Thu Nov 12, 3 h | \"ZZ_ticket_quote\" |\n| 2 | `aaaaaaaa` ZZ_ticket2_title | zz_owner2@massmarket.ai | ⛔ Missing | — |\n\n⛔ 1 of 2 open tickets have no ETA, proof or named wait from their owner in the drafts as they stand.\nOW only records this for now (observe). Get it before the go anyway.\n\n### Their message\nEverything since our last reply, Mon Nov 2, 7:00 AM ET: ZZ_went_out_what.\n\n#### ZZ_inb_from · Thu Nov 5, 10:00 AM ET · gmail\nTo: zz_inb_to@x.example · Cc: zz_inb_cc@x.example · Subject: ZZ_hdr_subject\n> ```text\n> Hi team, ZZ_inbound_email_words, is it live? And Saturday?\n> ```\n\n_Quoted history below this point was removed: it starts \"On Mon Nov 2 2026 Rob wrote: > old stuff ZZ_quoted_history\". Source: doc `dddddddd`._\n\n#### Dana · Thu Nov 5, 11:00 AM ET · call\nTheir words, an excerpt the package stored; the whole document is doc `dddddddd`:\n> ```text\n> ZZ_call_excerpt\n> ```\n\n#### Dana · Thu Nov 5, 11:20 AM ET · portal\n_Doc `dddddddd` (document) is not the message itself, and the package stored none of their words for it. Summary from the package: ZZ_nonmsg_summary_\n\n**Attachment** (Thu Nov 5, 11:10 AM ET): ZZ_attach_summary · our transcription is doc `dddddddd`\n\nEarlier messages, already answered by our last reply:\n- Sun Nov 1, 11:20 AM ET, gmail: ZZ_older_summary (doc `dddddddd`)\n\n### Client reply\nZZ_reply_owed_why.\n\n#### 1. ZZ_d1_title\n**To:** zz_d1_to@x.example · **Cc:** support@letaidothehardwork.com · **Subject:** ZZ_d1_subject · **From:** rob@massmarket.ai · **Channel:** gmail · hash `e1e1e1e1e1e1` · ⚠️ needs Rob's OK\n**The change:** ZZ_d1_diff\n```text\nHi Dana, ZZ_d1_body yes ZZ_answer.\n\nSecond paragraph ZZ_d1_body2.\n```\n\n#### 5. ZZ_d5_title\n_Already sent Thu Nov 5, 7:00 AM ET by zz_sent_by@massmarket.ai (zz_sent_ref). One go does not send it again._\n\n### Team post\n\n#### 2. ZZ_d2_title\n**Channel:** 900000000000000099 · **Must act:** <@900000000000000002> · **FYI:** <@900000000000000004> · **Owners:** `aaaaaaaa` zz_ticket_owner@massmarket.ai · **In reply to:** 900000000000000077 · hash `e2e2e2e2e2e2`\n**The change:** ZZ_d2_diff\n```text\nUpdate from <@900000000000000003> ZZ_d2_body **ZZ_d2_bold**\n```\n\n### Added by the team\n\n#### zz_contrib@massmarket.ai · Thu Nov 5, 12:00 PM ET\n> ```text\n> ZZ_contribution\n> ```\n\n### Follow-ups (sent only if they have not replied)\nDry run: none of these steps will send while follow-ups are in dry run. The go still schedules them, so chase by hand until follow-ups go live.\nCounting from zz_anchor@massmarket.ai's email of Nov 3.\nEach one goes only if nothing has come from ZZ_fu_sms_name since our reply. Any reply, booking or payment cancels the rest, and their message gets a new package with its own follow-ups.\nGoal: ZZ_goal_action. Done when: ZZ_goal_done.\n\n**1. Email · 2 business days after our reply (Thu 11-05 if the reply goes today) · same thread**\nFrom: zz_fu_from@massmarket.ai · To: zz_fu_to@x.example · Cc: zz_fu_cc@x.example, support@letaidothehardwork.com, rob@massmarket.ai\nSubject: ZZ_fu_subject\n> ```text\n> ZZ_fu_email_body\n> ```\n\n**2. Text · 3 business days after our reply (Fri 11-06 if the reply goes today)**\nTo: ZZ_fu_sms_name · HighLevel contact ZZ_fu_sms_contact · +1 555-555-0142\n> ```text\n> ZZ_fu_sms_body\n> ```\n\n**3. LinkedIn voice note · 4 business days after our reply (Mon 11-09 if the reply goes today) · Rob's seat**\nTo: https://linkedin.example/zz_li\nTranscript:\n> ```text\n> ZZ_fu_voice_body\n> ```\nAudio: not made yet, so this step cannot send. Make it before the go.\n\n**4. Call task for ZZ_assignee · 5 business days after our reply (Tue 11-10 if the reply goes today) · only if they still have not replied**\nWhy a call: ZZ_fu_call_why\n> ```text\n> ZZ_fu_call_body\n> ```\n\nNot shown: 1 cancelled step (ZZ_cancel_reason). Cancelled steps never send.\n\n### Other items\n\n#### 3. ZZ_d3_title\n**Kind:** Text message · **channel:** highlevel_sms · **location_id:** ZZ_d3_location · **contact_id:** ZZ_d3_contact · **to_phone:** +15555550143 · **to_name:** ZZ_d3_name · hash `e3e3e3e3e3e3`\n**The change:** ZZ_d3_diff\n```text\nZZ_d3_sms_body\n```\n\n#### 4. ZZ_d4_title\n**Kind:** HighLevel change · **location_id:** ZZ_d4_location · **thing:** ZZ_d4_thing · hash `e4e4e4e4e4e4`\n**The change:** ZZ_d4_diff\n```text\nZZ_d4_body\n```\n\n### Links\n- ZZ_link_label: https://x.example/zz_link\n- ZZ_source_title: https://x.example/zz_source\n- Draft 1 attachment: `p/zz_attach_path.pdf`\n- Draft 4 document: https://drive.google.com/open?id=1abcdefghijklmnopqrstuvwxyz\n- Draft 4 preview: https://x.example/zz_preview\n- Draft 4 live site: https://x.example/zz_prod\n- Draft 4 before: `zz_before` · after: `zz_after`\n- Draft 5 sent: `zz_sent_ref`\n\n### Findings\n- 1 item(s) added by the team. Recommend: fold them into the client reply before the go.\n- Rob: ZZ_decision. Recommend: ZZ_decision_rec.\n- Only Rob knows: ZZ_fact. Recommend: ZZ_fact_rec.\n- Concession in draft 1 (credit, $50): \"ZZ_concession_text\".\n- Flag (ZZ_flagkind): ZZ_flag.\n_2 more in the JSON read (without format=pickup)._\n\nOne go sends all 4 items now and schedules 4 follow-ups. Package `3f1c9a7e5b2d`.\n",
"tree":{
"v":1,
"package_id":"aaaaaaaa-1111-4222-8333-444444444444",
"project_id":"bbbbbbbb-1111-4222-8333-444444444444",
"client":"ZZ_client (Dana)",
"package_sha256":"3f1c9a7e5b2d4c6a8e0f1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f",
"label":"3f1c9a7e5b2d",
"blocks":71,
"signer":"Test Signer",
"can_sign":true,
"images":0,
"rendered_at":"2026-11-06T15:00:00Z",
"nodes":[
{
"c":"rp-head",
"k":[
{
"r":[
{
"s":"ZC"
}
],
"c":"rp-av rp-av-client"
},
{
"c":"rp-grow",
"k":[
{
"r":[
{
"s":"ZZ_client (Dana)"
}
],
"c":"rp-title"
},
{
"r":[
{
"s":"Reply package · "
},
{
"s":"3f1c9a7e5b2d",
"c":"rp-mono"
}
],
"c":"rp-sub"
}
]
},
{
"r":[
{
"s":"Green",
"c":"rp-chip rp-ok"
},
{
"s":" "
},
{
"s":"prepared",
"c":"rp-chip rp-n"
}
],
"c":"rp-chips"
}
]
},
{
"c":"rp-note",
"k":[
{
"r":[
{
"s":"ZZ_whats_new"
}
],
"c":"rp-whatsnew",
"fp":"f3dd1078"
}
]
},
{
"c":"rp-sec",
"k":[
{
"r":[
{
"s":"Their message"
}
],
"c":"rp-h"
},
{
"r":[
{
"s":"Everything since our last reply, Mon Nov 2, 7:00 AM ET: ZZ_went_out_what."
}
],
"c":"rp-foot",
"fp":"0200ba3a"
},
{
"c":"rp-mail",
"k":[
{
"r":[
{
"s":"ZZ_hdr_subject",
"c":"rp-subj",
"fp":"2ddbffb7"
}
],
"c":"rp-mail-subj"
},
{
"c":"rp-mail-from",
"k":[
{
"r":[
{
"s":"ZI"
}
],
"c":"rp-av"
},
{
"c":"rp-grow",
"k":[
{
"r":[
{
"s":"ZZ_inb_from"
}
],
"c":"rp-from",
"fp":"f9fbc4b6"
},
{
"r":[
{
"s":"To",
"c":"rp-k"
},
{
"s":" "
},
{
"s":"zz_inb_to@x.example",
"c":"rp-v",
"fp":"8a3a7eeb"
}
],
"c":"rp-hdr"
},
{
"r":[
{
"s":"Cc",
"c":"rp-k"
},
{
"s":" "
},
{
"s":"zz_inb_cc@x.example",
"c":"rp-v",
"fp":"2e02030c"
}
],
"c":"rp-hdr"
}
]
},
{
"r":[
{
"s":"Thu Nov 5, 10:00 AM ET · gmail"
}
],
"c":"rp-when"
}
]
},
{
"r":[
{
"s":"Hi team, ZZ_inbound_email_words, is it live? And Saturday?"
}
],
"c":"rp-body rp-mail-body",
"fp":"3048517f"
}
]
},
{
"r":[
{
"s":"Quoted history below this point was removed: it starts \"On Mon Nov 2 2026 Rob wrote: > old stuff ZZ_quoted_history\". Source: doc dddddddd."
}
],
"c":"rp-foot",
"fp":"caa98759"
},
{
"c":"rp-call",
"k":[
{
"c":"rp-call-head",
"k":[
{
"r":[
{
"s":"📞",
"c":"rp-icon"
}
]
},
{
"c":"rp-grow",
"k":[
{
"r":[
{
"s":"ZZ_call_title"
}
],
"c":"rp-from"
},
{
"r":[
{
"s":"Dana · Thu Nov 5, 11:00 AM ET · call · transcript · doc "
},
{
"s":"dddddddd",
"c":"rp-mono"
}
],
"c":"rp-sub"
}
]
}
]
},
{
"r":[
{
"s":"Their words, an excerpt the package stored; the whole document is doc dddddddd:"
}
],
"c":"rp-foot",
"fp":"58d9ba54"
},
{
"c":"rp-turn rp-turn-q",
"k":[
{
"r":[
{
"s":"Dana"
}
],
"c":"rp-turn-who rp-them"
},
{
"r":[
{
"s":"ZZ_call_excerpt"
}
],
"c":"rp-turn-text",
"fp":"2d51b9c4"
}
]
},
{
"btn":"Read the whole transcript ↗",
"ask":"Show me doc dddddddd from package 3f1c9a7e5b2d in full.",
"c":"rp-btn rp-btn-s"
}
]
},
{
"r":[
{
"s":"📎 ",
"c":"rp-icon"
},
{
"s":"Attachment (Thu Nov 5, 11:10 AM ET): ZZ_attach_summary · our transcription is doc dddddddd",
"c":"rp-v",
"fp":"0ec579ca"
}
],
"c":"rp-att"
},
{
"r":[
{
"s":"Dana · Thu Nov 5, 11:20 AM ET · portal"
}
],
"c":"rp-from",
"fp":"6ae8ebd1"
},
{
"r":[
{
"s":"Doc dddddddd (document) is not the message itself, and the package stored none of their words for it. Summary from the package: ZZ_nonmsg_summary"
}
],
"c":"rp-foot",
"fp":"cbd4e7e9"
},
{
"r":[
{
"s":"Earlier messages, already answered by our last reply:"
}
],
"c":"rp-foot"
},
{
"r":[
{
"s":"Sun Nov 1, 11:20 AM ET, gmail: ZZ_older_summary (doc dddddddd)"
}
],
"c":"rp-foot",
"fp":"a64faa01"
}
]
},
{
"c":"rp-sec",
"k":[
{
"r":[
{
"s":"Our reply to the client"
}
],
"c":"rp-h"
},
{
"r":[
{
"s":"ZZ_reply_owed_why."
}
],
"c":"rp-foot",
"fp":"df5a8011"
},
{
"r":[
{
"s":"1. ZZ_d1_title"
}
],
"c":"rp-dtitle"
},
{
"r":[
{
"s":"The change: ZZ_d1_diff"
}
],
"c":"rp-foot",
"fp":"a60a702a"
},
{
"c":"rp-mail",
"k":[
{
"r":[
{
"s":"ZZ_d1_subject",
"c":"rp-subj",
"fp":"95cba2fa"
},
{
"s":" "
},
{
"s":"👤 ",
"c":"rp-chip rp-warn rp-icon"
},
{
"s":"needs Rob's OK",
"c":"rp-chip rp-warn"
},
{
"s":" "
},
{
"s":"e1e1e1e1e1e1",
"c":"rp-chip rp-n rp-mono"
}
],
"c":"rp-mail-subj"
},
{
"c":"rp-mail-from",
"k":[
{
"r":[
{
"s":"RM"
}
],
"c":"rp-av"
},
{
"c":"rp-grow",
"k":[
{
"r":[
{
"s":"rob@massmarket.ai"
}
],
"c":"rp-from",
"fp":"6b6fbdfc"
},
{
"r":[
{
"s":"To",
"c":"rp-k"
},
{
"s":" "
},
{
"s":"zz_d1_to@x.example",
"c":"rp-v",
"fp":"b9c594e7"
}
],
"c":"rp-hdr"
},
{
"r":[
{
"s":"Cc",
"c":"rp-k"
},
{
"s":" "
},
{
"s":"support@letaidothehardwork.com",
"c":"rp-v",
"fp":"a852e9ba"
}
],
"c":"rp-hdr"
},
{
"r":[
{
"s":"Bcc",
"c":"rp-k"
},
{
"s":" "
},
{
"s":"zz_d1_bcc@x.example",
"c":"rp-v",
"fp":"1f33a60a"
}
],
"c":"rp-hdr"
},
{
"r":[
{
"s":"Attached",
"c":"rp-k"
},
{
"s":" "
},
{
"s":"ZZ_d1_attach.pdf",
"c":"rp-v",
"fp":"4927ecd3"
}
],
"c":"rp-hdr"
}
]
},
{
"r":[
{
"s":"in thread · gmail"
}
],
"c":"rp-when"
}
]
},
{
"r":[
{
"s":"Hi Dana, ZZ_d1_body yes ZZ_answer.\n\nSecond paragraph ZZ_d1_body2."
}
],
"c":"rp-body rp-mail-body",
"fp":"1d0a305c"
}
]
},
{
"r":[
{
"s":"3. ZZ_d3_title "
},
{
"s":"e3e3e3e3e3e3",
"c":"rp-chip rp-n rp-mono"
}
],
"c":"rp-dtitle"
},
{
"r":[
{
"s":"Kind: Text message · channel: highlevel_sms · location_id: ZZ_d3_location · contact_id: ZZ_d3_contact · to_phone: +15555550143 · to_name: ZZ_d3_name"
}
],
"c":"rp-foot",
"fp":"d6e38edc"
},
{
"r":[
{
"s":"The change: ZZ_d3_diff"
}
],
"c":"rp-foot",
"fp":"63472b00"
},
{
"c":"rp-phone rp-sms",
"k":[
{
"r":[
{
"s":"ZZ_d3_name · +1 555-555-0143 · HighLevel contact ZZ_d3_contact"
}
],
"c":"rp-phone-head"
},
{
"c":"rp-row rp-out",
"k":[
{
"r":[
{
"s":"ZZ_d3_sms_body"
}
],
"c":"rp-bub rp-bub-out",
"fp":"6de05c72"
},
{
"r":[
{
"s":"Our reply · sends on the go"
}
],
"c":"rp-bmeta"
}
]
}
]
},
{
"r":[
{
"s":"5. ZZ_d5_title"
}
],
"c":"rp-dtitle"
},
{
"r":[
{
"s":"Already sent Thu Nov 5, 7:00 AM ET by zz_sent_by@massmarket.ai (zz_sent_ref). One go does not send it again."
}
],
"c":"rp-foot",
"fp":"a56879e3"
},
{
"c":"rp-mail",
"k":[
{
"r":[
{
"s":"ZZ_d5_subject",
"c":"rp-subj",
"fp":"fabe4bae"
},
{
"s":" "
},
{
"s":"✓ ",
"c":"rp-chip rp-ok rp-icon"
},
{
"s":"already sent",
"c":"rp-chip rp-ok"
},
{
"s":" "
},
{
"s":"e5e5e5e5e5e5",
"c":"rp-chip rp-n rp-mono"
}
],
"c":"rp-mail-subj"
},
{
"c":"rp-mail-from",
"k":[
{
"r":[
{
"s":"?"
}
],
"c":"rp-av"
},
{
"c":"rp-grow",
"k":[
{
"r":[
{
"s":"(sender not named)"
}
],
"c":"rp-from",
"fp":"c8148d99"
},
{
"r":[
{
"s":"To",
"c":"rp-k"
},
{
"s":" "
},
{
"s":"zz_d5_to@x.example",
"c":"rp-v",
"fp":"8eff76f3"
}
],
"c":"rp-hdr"
},
{
"r":[
{
"s":"Cc",
"c":"rp-k"
},
{
"s":" "
},
{
"s":"(none)",
"c":"rp-v",
"fp":"90458a20"
}
],
"c":"rp-hdr"
}
]
},
{
"r":[
{
"s":"sent Thu Nov 5, 7:00 AM ET"
}
],
"c":"rp-when"
}
]
},
{
"r":[
{
"s":"ZZ_d5_body"
}
],
"c":"rp-body rp-mail-body",
"fp":"4c8b69be"
}
]
}
]
},
{
"c":"rp-sec",
"k":[
{
"r":[
{
"s":"Team post"
}
],
"c":"rp-h"
},
{
"r":[
{
"s":"2. ZZ_d2_title "
},
{
"s":"e2e2e2e2e2e2",
"c":"rp-chip rp-n rp-mono"
}
],
"c":"rp-dtitle"
},
{
"r":[
{
"s":"The change: ZZ_d2_diff"
}
],
"c":"rp-foot",
"fp":"f43d2641"
},
{
"c":"rp-dc",
"k":[
{
"r":[
{
"s":"900000000000000099",
"c":"rp-mono"
},
{
"s":" · reply to "
},
{
"s":"900000000000000077",
"c":"rp-mono"
}
],
"c":"rp-dc-chan"
},
{
"c":"rp-dc-msg",
"k":[
{
"c":"rp-grow",
"k":[
{
"r":[
{
"s":"Jarvis "
},
{
"s":"APP",
"c":"rp-dc-bot"
},
{
"s":" "
},
{
"s":"not posted yet",
"c":"rp-dc-ts"
}
],
"c":"rp-dc-name"
},
{
"r":[
{
"s":"Update from "
},
{
"s":"@900000…",
"c":"rp-mention",
"m":"900000000000000003"
},
{
"s":" ZZ_d2_body "
},
{
"s":"ZZ_d2_bold",
"c":"rp-b"
}
],
"c":"rp-body rp-dc-body",
"fp":"3eee0738"
},
{
"r":[
{
"s":"Must act: "
},
{
"s":"@900000…",
"c":"rp-mention",
"m":"900000000000000002"
},
{
"s":" · FYI: "
},
{
"s":"@900000…",
"c":"rp-mention",
"m":"900000000000000004"
},
{
"s":" · Owners: aaaaaaaa zz_ticket_owner@massmarket.ai"
}
],
"c":"rp-dc-meta"
}
]
}
]
}
]
}
]
},
{
"c":"rp-sec",
"k":[
{
"r":[
{
"s":"Other items"
}
],
"c":"rp-h"
},
{
"c":"rp-item",
"k":[
{
"c":"rp-item-head",
"k":[
{
"c":"rp-grow",
"k":[
{
"r":[
{
"s":"4. ZZ_d4_title"
}
],
"c":"rp-from"
},
{
"r":[
{
"s":"HighLevel change"
}
],
"c":"rp-sub"
}
]
},
{
"r":[
{
"s":"e4e4e4e4e4e4",
"c":"rp-chip rp-n rp-mono"
}
]
}
]
},
{
"r":[
{
"s":"Kind: HighLevel change · location_id: ZZ_d4_location · thing: ZZ_d4_thing"
}
],
"c":"rp-foot",
"fp":"aebabfa1"
},
{
"r":[
{
"s":"The change: ZZ_d4_diff"
}
],
"c":"rp-foot",
"fp":"ff247b9f"
},
{
"r":[
{
"s":"ZZ_d4_body"
}
],
"c":"rp-body rp-pre",
"fp":"705be2cb"
}
]
}
]
},
{
"c":"rp-sec",
"k":[
{
"r":[
{
"s":"Follow-ups, sent only if they have not replied"
}
],
"c":"rp-h"
},
{
"r":[
{
"s":"⚠ ",
"c":"rp-icon"
},
{
"s":"Dry run: none of these steps will send while follow-ups are in dry run. The go still schedules them, so chase by hand until follow-ups go live."
}
],
"c":"rp-banner rp-warn"
},
{
"r":[
{
"s":"Counting from zz_anchor@massmarket.ai's email of Nov 3."
}
],
"c":"rp-foot",
"fp":"7fadff35"
},
{
"r":[
{
"s":"Each one goes only if nothing has come from ZZ_fu_sms_name since our reply. Any reply, booking or payment cancels the rest, and their message gets a new package with its own follow-ups."
}
],
"c":"rp-foot",
"fp":"999d540e"
},
{
"r":[
{
"s":"Goal: ZZ_goal_action. Done when: ZZ_goal_done."
}
],
"c":"rp-foot",
"fp":"98cf1afe"
},
{
"c":"rp-tl",
"k":[
{
"c":"rp-li",
"k":[
{
"c":"rp-grow",
"k":[
{
"r":[
{
"s":"1. Email · 2 business days after our reply (Thu 11-05 if the reply goes today) · same thread"
}
],
"c":"rp-tl-head",
"fp":"6bc61770"
},
{
"r":[
{
"s":"From: zz_fu_from@massmarket.ai · To: zz_fu_to@x.example · Cc: zz_fu_cc@x.example, support@letaidothehardwork.com, rob@massmarket.ai"
}
],
"c":"rp-foot",
"fp":"62094d70"
},
{
"r":[
{
"s":"Subject: ZZ_fu_subject"
}
],
"c":"rp-foot",
"fp":"e1630888"
},
{
"r":[
{
"s":"ZZ_fu_email_body"
}
],
"c":"rp-body rp-quote",
"fp":"9bb4ec0d"
}
]
}
]
},
{
"c":"rp-li",
"k":[
{
"c":"rp-grow",
"k":[
{
"r":[
{
"s":"2. Text · 3 business days after our reply (Fri 11-06 if the reply goes today)"
}
],
"c":"rp-tl-head",
"fp":"4563e3c9"
},
{
"r":[
{
"s":"To: ZZ_fu_sms_name · HighLevel contact ZZ_fu_sms_contact · +1 555-555-0142"
}
],
"c":"rp-foot",
"fp":"5f02baa8"
},
{
"r":[
{
"s":"ZZ_fu_sms_body"
}
],
"c":"rp-bub rp-bub-out rp-inline",
"fp":"98333d92"
}
]
}
]
},
{
"c":"rp-li",
"k":[
{
"c":"rp-grow",
"k":[
{
"r":[
{
"s":"3. LinkedIn voice note · 4 business days after our reply (Mon 11-09 if the reply goes today) · Rob's seat"
}
],
"c":"rp-tl-head",
"fp":"8d60b4ef"
},
{
"r":[
{
"s":"To: https://linkedin.example/zz_li"
}
],
"c":"rp-foot",
"fp":"95f5bca6"
},
{
"r":[
{
"s":"Audio: not made yet, so this step cannot send. Make it before the go."
}
],
"c":"rp-foot",
"fp":"19ae004b"
},
{
"r":[
{
"s":"ZZ_fu_voice_body"
}
],
"c":"rp-body rp-quote",
"fp":"0589618f"
}
]
}
]
},
{
"c":"rp-li",
"k":[
{
"c":"rp-grow",
"k":[
{
"r":[
{
"s":"4. Call task for ZZ_assignee · 5 business days after our reply (Tue 11-10 if the reply goes today) · only if they still have not replied"
}
],
"c":"rp-tl-head",
"fp":"3c57dae0"
},
{
"r":[
{
"s":"Why a call: ZZ_fu_call_why"
}
],
"c":"rp-foot",
"fp":"f0759ed8"
},
{
"r":[
{
"s":"ZZ_fu_call_body"
}
],
"c":"rp-body rp-quote",
"fp":"66330e45"
}
]
}
]
}
]
},
{
"r":[
{
"s":"Not shown: 1 cancelled step (ZZ_cancel_reason). Cancelled steps never send."
}
],
"c":"rp-foot",
"fp":"f9d7195e"
}
]
},
{
"c":"rp-sec",
"k":[
{
"r":[
{
"s":"Every question answered?"
}
],
"c":"rp-h"
},
{
"c":"rp-q",
"k":[
{
"r":[
{
"s":"Q1",
"c":"rp-qn"
}
]
},
{
"c":"rp-grow",
"k":[
{
"r":[
{
"s":"ZZ_q1_quote is it live?"
}
],
"c":"rp-qa rp-qa-them",
"fp":"10a5091d"
},
{
"r":[
{
"s":"yes ZZ_answer"
}
],
"c":"rp-qa rp-qa-us",
"fp":"006fbc6b"
}
]
},
{
"r":[
{
"s":"✓ ",
"c":"rp-mark rp-ok rp-icon"
},
{
"s":"answered",
"c":"rp-mark rp-ok"
}
]
}
]
}
]
},
{
"c":"rp-sec",
"k":[
{
"r":[
{
"s":"ETA or proof for every open ticket?"
}
],
"c":"rp-h"
},
{
"c":"rp-q",
"k":[
{
"r":[
{
"s":"aaaaaaaa",
"c":"rp-qn rp-mono"
}
]
},
{
"c":"rp-grow",
"k":[
{
"r":[
{
"s":"ZZ_ticket_title"
}
],
"c":"rp-qa",
"fp":"004bd9b7"
},
{
"r":[
{
"s":"Owner: zz_owner@massmarket.ai · Reply says: \"ZZ_ticket_quote\""
}
],
"c":"rp-foot",
"fp":"882634e1"
}
]
},
{
"r":[
{
"s":"✓ ",
"c":"rp-mark rp-ok rp-icon"
},
{
"s":"ETA Thu Nov 12, 3 h",
"c":"rp-mark rp-ok"
}
]
}
]
},
{
"c":"rp-q",
"k":[
{
"r":[
{
"s":"aaaaaaaa",
"c":"rp-qn rp-mono"
}
]
},
{
"c":"rp-grow",
"k":[
{
"r":[
{
"s":"ZZ_ticket2_title"
}
],
"c":"rp-qa",
"fp":"5cafda09"
},
{
"r":[
{
"s":"Owner: zz_owner2@massmarket.ai"
}
],
"c":"rp-foot",
"fp":"a5c4dc20"
}
]
},
{
"r":[
{
"s":"✗ ",
"c":"rp-mark rp-bad rp-icon"
},
{
"s":"Missing",
"c":"rp-mark rp-bad"
}
]
}
]
},
{
"r":[
{
"s":"⛔ ",
"c":"rp-icon"
},
{
"s":"1 of 2 open tickets have no ETA, proof or named wait from their owner in the drafts as they stand."
}
],
"c":"rp-banner rp-bad"
},
{
"r":[
{
"s":"OW only records this for now (observe). Get it before the go anyway."
}
],
"c":"rp-foot"
}
]
},
{
"c":"rp-sec",
"k":[
{
"r":[
{
"s":"Added by the team"
}
],
"c":"rp-h"
},
{
"r":[
{
"s":"zz_contrib@massmarket.ai · Thu Nov 5, 12:00 PM ET"
}
],
"c":"rp-noteby"
},
{
"r":[
{
"s":"ZZ_contribution"
}
],
"c":"rp-body rp-quote",
"fp":"99b3bf34"
}
]
},
{
"c":"rp-sec",
"k":[
{
"r":[
{
"s":"Findings"
}
],
"c":"rp-h"
},
{
"c":"rp-find",
"k":[
{
"r":[
{
"s":"1 item(s) added by the team."
}
],
"c":"rp-find-what",
"fp":"26aef38a"
},
{
"r":[
{
"s":"Recommend",
"c":"rp-k"
},
{
"s":" "
},
{
"s":"fold them into the client reply before the go.",
"c":"rp-v",
"fp":"7707953c"
}
],
"c":"rp-rec"
}
]
},
{
"c":"rp-find",
"k":[
{
"r":[
{
"s":"Rob: ZZ_decision."
}
],
"c":"rp-find-what",
"fp":"26b7e349"
},
{
"r":[
{
"s":"Recommend",
"c":"rp-k"
},
{
"s":" "
},
{
"s":"ZZ_decision_rec.",
"c":"rp-v",
"fp":"9ab02741"
}
],
"c":"rp-rec"
}
]
},
{
"c":"rp-find",
"k":[
{
"r":[
{
"s":"Only Rob knows: ZZ_fact."
}
],
"c":"rp-find-what",
"fp":"9b27d975"
},
{
"r":[
{
"s":"Recommend",
"c":"rp-k"
},
{
"s":" "
},
{
"s":"ZZ_fact_rec.",
"c":"rp-v",
"fp":"e621d591"
}
],
"c":"rp-rec"
}
]
},
{
"c":"rp-find",
"k":[
{
"r":[
{
"s":"Concession in draft 1 (credit, $50): \"ZZ_concession_text\"."
}
],
"c":"rp-find-what",
"fp":"336ae546"
}
]
},
{
"c":"rp-find",
"k":[
{
"r":[
{
"s":"Flag (ZZ_flagkind): ZZ_flag."
}
],
"c":"rp-find-what",
"fp":"aea551d2"
}
]
},
{
"r":[
{
"s":"2 more in the JSON read (without format=pickup)."
}
],
"c":"rp-foot"
}
]
},
{
"c":"rp-sec",
"k":[
{
"r":[
{
"s":"Links"
}
],
"c":"rp-h"
},
{
"c":"rp-links",
"k":[
{
"r":[
{
"s":"ZZ_link_label: "
},
{
"s":"https://x.example/zz_link",
"href":"https://x.example/zz_link"
}
],
"c":"rp-li"
},
{
"r":[
{
"s":"ZZ_source_title: "
},
{
"s":"https://x.example/zz_source",
"href":"https://x.example/zz_source"
}
],
"c":"rp-li"
},
{
"r":[
{
"s":"Draft 1 attachment: p/zz_attach_path.pdf"
}
],
"c":"rp-li"
},
{
"r":[
{
"s":"Draft 4 document: "
},
{
"s":"https://drive.google.com/open?id=1abcdefghijklmnopqrstuvwxyz",
"href":"https://drive.google.com/open?id=1abcdefghijklmnopqrstuvwxyz"
}
],
"c":"rp-li"
},
{
"r":[
{
"s":"Draft 4 preview: "
},
{
"s":"https://x.example/zz_preview",
"href":"https://x.example/zz_preview"
}
],
"c":"rp-li"
},
{
"r":[
{
"s":"Draft 4 live site: "
},
{
"s":"https://x.example/zz_prod",
"href":"https://x.example/zz_prod"
}
],
"c":"rp-li"
},
{
"r":[
{
"s":"Draft 4 before: zz_before · after: zz_after"
}
],
"c":"rp-li"
},
{
"r":[
{
"s":"Draft 5 sent: zz_sent_ref"
}
],
"c":"rp-li"
}
]
}
]
},
{
"c":"rp-go",
"k":[
{
"r":[
{
"s":"One go sends all 4 items now and schedules 4 follow-ups. Package 3f1c9a7e5b2d."
}
],
"c":"rp-closing",
"fp":"5a1f9758"
},
{
"r":[
{
"s":"⚠ ",
"c":"rp-icon"
},
{
"s":"1 open ticket(s) have no ETA, proof or named wait"
}
],
"c":"rp-banner rp-warn"
},
{
"r":[
{
"s":"⚠ ",
"c":"rp-icon"
},
{
"s":"the last approval is stale: ZZ_stale_reason"
}
],
"c":"rp-banner rp-warn"
},
{
"r":[
{
"s":"⚠ ",
"c":"rp-icon"
},
{
"s":"needs Rob's OK: draft 1 (in Rob's session his go records it)"
}
],
"c":"rp-banner rp-warn"
},
{
"c":"rp-actions",
"k":[
{
"sign":{
"label":"3f1c9a7e5b2d",
"signer":"Test Signer"
}
}
]
}
]
}
]
}
}
}

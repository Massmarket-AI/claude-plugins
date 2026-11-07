/**
 * (0.7.26) A card as client-reply-prep's render_visual.py --tree draws it, for the synthetic text-message package
 * (skills/client-reply-prep/scripts/tests/fixtures/visual/sms-package.json, signer "Test Signer"). Made-up client, made-up
 * numbers; regenerate with: python3 render_visual.py --json <that fixture> --signer "Test Signer" --tree -
 */
export const SMS_TREE = {
 "v": 1,
 "package_id": "aaaaaaaa-1111-4222-8333-444444444444",
 "project_id": "bbbbbbbb-1111-4222-8333-444444444444",
 "client": "Example Dental (Dana Example)",
 "package_sha256": "3f1c9a7e5b2d4c6a8e0f1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f",
 "label": "3f1c9a7e5b2d",
 "blocks": 12,
 "signer": "Test Signer",
 "can_sign": true,
 "images": 0,
 "rendered_at": "2026-11-06T15:00:00Z",
 "nodes": [
  {
   "c": "rp-head",
   "k": [
    {
     "r": [
      {
       "s": "ED"
      }
     ],
     "c": "rp-av rp-av-client"
    },
    {
     "c": "rp-grow",
     "k": [
      {
       "r": [
        {
         "s": "Example Dental (Dana Example)"
        }
       ],
       "c": "rp-title"
      },
      {
       "r": [
        {
         "s": "Reply package · "
        },
        {
         "s": "3f1c9a7e5b2d",
         "c": "rp-mono"
        }
       ],
       "c": "rp-sub"
      }
     ]
    },
    {
     "r": [
      {
       "s": "Green",
       "c": "rp-chip rp-ok"
      },
      {
       "s": " "
      },
      {
       "s": "prepared",
       "c": "rp-chip rp-n"
      }
     ],
     "c": "rp-chips"
    }
   ]
  },
  {
   "c": "rp-note",
   "k": [
    {
     "r": [
      {
       "s": "Dana texted to ask whether the new booking link is live and if Saturday slots show."
      }
     ],
     "c": "rp-whatsnew",
     "fp": "f7a43743"
    }
   ]
  },
  {
   "c": "rp-sec",
   "k": [
    {
     "r": [
      {
       "s": "Their message"
      }
     ],
     "c": "rp-h"
    },
    {
     "r": [
      {
       "s": "Everything since our last reply, Wed Nov 4, 9:00 AM ET: Text to Dana: booking link going live tomorrow."
      }
     ],
     "c": "rp-foot",
     "fp": "e2ed0a3b"
    },
    {
     "r": [
      {
       "s": "Their words, as the package stored them; the whole document is doc dddddddd:"
      }
     ],
     "c": "rp-foot",
     "fp": "78556dcc"
    },
    {
     "c": "rp-phone rp-sms",
     "k": [
      {
       "r": [
        {
         "s": "Dana Example · sms"
        }
       ],
       "c": "rp-phone-head"
      },
      {
       "c": "rp-row rp-in",
       "k": [
        {
         "r": [
          {
           "s": "Hi! Is the new booking link live yet? Do Saturday slots show?"
          }
         ],
         "c": "rp-bub rp-bub-in",
         "fp": "0b78d8bd"
        },
        {
         "r": [
          {
           "s": "Dana Example · Thu Nov 5, 10:02 AM ET"
          }
         ],
         "c": "rp-bmeta"
        }
       ]
      }
     ]
    }
   ]
  },
  {
   "c": "rp-sec",
   "k": [
    {
     "r": [
      {
       "s": "Our reply to the client"
      }
     ],
     "c": "rp-h"
    },
    {
     "r": [
      {
       "s": "1. Text to Dana: link is live, Saturday shows "
      },
      {
       "s": "9a8b7c6d5e4f",
       "c": "rp-chip rp-n rp-mono"
      }
     ],
     "c": "rp-dtitle"
    },
    {
     "r": [
      {
       "s": "Kind: Text message · channel: sms · to_name: Dana Example · contact_id: hlcontact123 · to_phone: +15555550142"
      }
     ],
     "c": "rp-foot",
     "fp": "daa9ef3f"
    },
    {
     "c": "rp-phone rp-sms",
     "k": [
      {
       "r": [
        {
         "s": "Dana Example · +1 555-555-0142 · HighLevel contact hlcontact123"
        }
       ],
       "c": "rp-phone-head"
      },
      {
       "c": "rp-row rp-in",
       "k": [
        {
         "r": [
          {
           "s": "Hi! Is the new booking link live yet? Do Saturday slots show?"
          }
         ],
         "c": "rp-bub rp-bub-in",
         "fp": "0b78d8bd"
        },
        {
         "r": [
          {
           "s": "Dana Example · Thu Nov 5, 10:02 AM ET"
          }
         ],
         "c": "rp-bmeta"
        }
       ]
      },
      {
       "c": "rp-row rp-out",
       "k": [
        {
         "r": [
          {
           "s": "Hi Dana, yes, the new booking link is live now: example.com/book. Saturday 9 to 1 shows on it. Book a test slot and tell us if anything looks off."
          }
         ],
         "c": "rp-bub rp-bub-out",
         "fp": "c4e29362"
        },
        {
         "r": [
          {
           "s": "Our reply · sends on the go"
          }
         ],
         "c": "rp-bmeta"
        }
       ]
      }
     ]
    }
   ]
  },
  {
   "c": "rp-sec",
   "k": [
    {
     "r": [
      {
       "s": "Team post"
      }
     ],
     "c": "rp-h"
    },
    {
     "r": [
      {
       "s": "No team post in this package."
      }
     ],
     "c": "rp-foot"
    }
   ]
  },
  {
   "c": "rp-sec",
   "k": [
    {
     "r": [
      {
       "s": "Every question answered?"
      }
     ],
     "c": "rp-h"
    },
    {
     "c": "rp-q",
     "k": [
      {
       "r": [
        {
         "s": "Q1",
         "c": "rp-qn"
        }
       ]
      },
      {
       "c": "rp-grow",
       "k": [
        {
         "r": [
          {
           "s": "Is the new booking link live yet?"
          }
         ],
         "c": "rp-qa rp-qa-them",
         "fp": "d915b07c"
        },
        {
         "r": [
          {
           "s": "the new booking link is live now"
          }
         ],
         "c": "rp-qa rp-qa-us",
         "fp": "78ce533d"
        }
       ]
      },
      {
       "r": [
        {
         "s": "✓ ",
         "c": "rp-mark rp-ok rp-icon"
        },
        {
         "s": "answered",
         "c": "rp-mark rp-ok"
        }
       ]
      }
     ]
    },
    {
     "c": "rp-q",
     "k": [
      {
       "r": [
        {
         "s": "Q2",
         "c": "rp-qn"
        }
       ]
      },
      {
       "c": "rp-grow",
       "k": [
        {
         "r": [
          {
           "s": "Do Saturday slots show?"
          }
         ],
         "c": "rp-qa rp-qa-them",
         "fp": "c5e8de34"
        },
        {
         "r": [
          {
           "s": "Saturday 9 to 1 shows on it"
          }
         ],
         "c": "rp-qa rp-qa-us",
         "fp": "178c1565"
        }
       ]
      },
      {
       "r": [
        {
         "s": "✓ ",
         "c": "rp-mark rp-ok rp-icon"
        },
        {
         "s": "answered",
         "c": "rp-mark rp-ok"
        }
       ]
      }
     ]
    }
   ]
  },
  {
   "c": "rp-sec",
   "k": [
    {
     "r": [
      {
       "s": "Findings"
      }
     ],
     "c": "rp-h"
    },
    {
     "r": [
      {
       "s": "Nothing for Rob to decide."
      }
     ],
     "c": "rp-foot"
    }
   ]
  },
  {
   "c": "rp-go",
   "k": [
    {
     "r": [
      {
       "s": "One go sends 1 item. Package 3f1c9a7e5b2d."
      }
     ],
     "c": "rp-closing",
     "fp": "d2821508"
    },
    {
     "c": "rp-actions",
     "k": [
      {
       "sign": {
        "label": "3f1c9a7e5b2d",
        "signer": "Test Signer"
       }
      }
     ]
    }
   ]
  }
 ]
}

export const SMS_PAGE = "## Example Dental (Dana Example) · reply package · Package `3f1c9a7e5b2d`\n\n### Every question answered?\n| # | They asked | Our reply says | |\n|---|---|---|---|\n| 1 | Is the new booking link live yet? | \"the new booking link is live now\" | ✅ |\n| 2 | Do Saturday slots show? | \"Saturday 9 to 1 shows on it\" | ✅ |\n\n### Their message\nEverything since our last reply, Wed Nov 4, 9:00 AM ET: Text to Dana: booking link going live tomorrow.\n\n#### Dana Example · Thu Nov 5, 10:02 AM ET · sms\nTheir words, as the package stored them; the whole document is doc `dddddddd`:\n> ```text\n> Hi! Is the new booking link live yet? Do Saturday slots show?\n> ```\n\n### Client reply\n_No client email in this package._\n\n### Team post\n_No team post in this package._\n\n### Other items\n\n#### 1. Text to Dana: link is live, Saturday shows\n**Kind:** Text message · **channel:** sms · **to_name:** Dana Example · **contact_id:** hlcontact123 · **to_phone:** +15555550142 · hash `9a8b7c6d5e4f`\n```text\nHi Dana, yes, the new booking link is live now: example.com/book. Saturday 9 to 1 shows on it. Book a test slot and tell us if anything looks off.\n```\n\n### Findings\n_Nothing for Rob to decide._\n\nOne go sends 1 item. Package `3f1c9a7e5b2d`.\n"

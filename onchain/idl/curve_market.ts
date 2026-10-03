/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/curve_market.json`.
 */
export type CurveMarket = {
  "address": "DPsFa2nxH568WZdeAgmdaxBrS3Je4UK4K7axxzCYAqjp",
  "metadata": {
    "name": "curveMarket",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Parimutuel YES/NO markets on Meteora Dynamic Bonding Curve graduation"
  },
  "instructions": [
    {
      "name": "claim",
      "docs": [
        "Pay out a position and close it to its owner. Winners get their stake",
        "plus a pro-rata share of the losing side. Refund markets return both",
        "sides. Losers get nothing but their rent back."
      ],
      "discriminator": [
        62,
        198,
        214,
        193,
        213,
        159,
        108,
        210
      ],
      "accounts": [
        {
          "name": "user",
          "writable": true,
          "signer": true
        },
        {
          "name": "market",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  107,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "market.pool",
                "account": "market"
              },
              {
                "kind": "account",
                "path": "market.deadline_ts",
                "account": "market"
              }
            ]
          },
          "relations": [
            "position"
          ]
        },
        {
          "name": "position",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  115,
                  105,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "market"
              },
              {
                "kind": "account",
                "path": "user"
              }
            ]
          }
        },
        {
          "name": "quoteMint",
          "relations": [
            "market"
          ]
        },
        {
          "name": "userToken",
          "writable": true
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "market"
              }
            ]
          },
          "relations": [
            "market"
          ]
        },
        {
          "name": "tokenProgram",
          "relations": [
            "market"
          ]
        }
      ],
      "args": []
    },
    {
      "name": "createMarket",
      "docs": [
        "Open a market on `pool` with the question \"does the curve finish at or",
        "before `deadline_ts`?\". Anyone can create one; the creator gets nothing",
        "beyond a market to trade in."
      ],
      "discriminator": [
        103,
        226,
        97,
        235,
        200,
        188,
        251,
        254
      ],
      "accounts": [
        {
          "name": "creator",
          "writable": true,
          "signer": true
        },
        {
          "name": "pool",
          "docs": [
            "A DBC `VirtualPool` or `TransferHookPool`."
          ]
        },
        {
          "name": "config",
          "docs": [
            "A DBC `PoolConfig` or `ConfigWithTransferHook`, of the same kind as the",
            "pool; the key must equal `pool.config`."
          ]
        },
        {
          "name": "quoteMint"
        },
        {
          "name": "market",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  107,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "pool"
              },
              {
                "kind": "arg",
                "path": "deadlineTs"
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "market"
              }
            ]
          }
        },
        {
          "name": "tokenProgram"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "deadlineTs",
          "type": "i64"
        }
      ]
    },
    {
      "name": "resolve",
      "docs": [
        "Settle the market from the pool account. Anyone can call it."
      ],
      "discriminator": [
        246,
        150,
        236,
        206,
        108,
        63,
        58,
        10
      ],
      "accounts": [
        {
          "name": "market",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  107,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "market.pool",
                "account": "market"
              },
              {
                "kind": "account",
                "path": "market.deadline_ts",
                "account": "market"
              }
            ]
          }
        },
        {
          "name": "pool",
          "relations": [
            "market"
          ]
        },
        {
          "name": "config",
          "relations": [
            "market"
          ]
        }
      ],
      "args": []
    },
    {
      "name": "stake",
      "docs": [
        "Move `amount` of the quote token into the vault on `side`. The amount",
        "credited is what the vault actually received, so a Token-2022 transfer",
        "fee cannot inflate a position."
      ],
      "discriminator": [
        206,
        176,
        202,
        18,
        200,
        209,
        179,
        108
      ],
      "accounts": [
        {
          "name": "user",
          "writable": true,
          "signer": true
        },
        {
          "name": "market",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  107,
                  101,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "market.pool",
                "account": "market"
              },
              {
                "kind": "account",
                "path": "market.deadline_ts",
                "account": "market"
              }
            ]
          }
        },
        {
          "name": "position",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  115,
                  105,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "market"
              },
              {
                "kind": "account",
                "path": "user"
              }
            ]
          }
        },
        {
          "name": "quoteMint",
          "relations": [
            "market"
          ]
        },
        {
          "name": "userToken",
          "writable": true
        },
        {
          "name": "vault",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "market"
              }
            ]
          },
          "relations": [
            "market"
          ]
        },
        {
          "name": "tokenProgram",
          "relations": [
            "market"
          ]
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "side",
          "type": {
            "defined": {
              "name": "side"
            }
          }
        },
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "market",
      "discriminator": [
        219,
        190,
        213,
        55,
        0,
        227,
        198,
        154
      ]
    },
    {
      "name": "position",
      "discriminator": [
        170,
        188,
        143,
        228,
        122,
        64,
        247,
        208
      ]
    }
  ],
  "events": [
    {
      "name": "claimed",
      "discriminator": [
        217,
        192,
        123,
        72,
        108,
        150,
        248,
        33
      ]
    },
    {
      "name": "marketCreated",
      "discriminator": [
        88,
        184,
        130,
        231,
        226,
        84,
        6,
        58
      ]
    },
    {
      "name": "resolved",
      "discriminator": [
        148,
        46,
        187,
        66,
        35,
        1,
        255,
        147
      ]
    },
    {
      "name": "staked",
      "discriminator": [
        11,
        146,
        45,
        205,
        230,
        58,
        213,
        240
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "poolNotOwnedByDbc",
      "msg": "The pool account is not owned by the DBC program"
    },
    {
      "code": 6001,
      "name": "poolDiscriminator",
      "msg": "The pool account is not a VirtualPool or TransferHookPool"
    },
    {
      "code": 6002,
      "name": "poolLayout",
      "msg": "The pool account is shorter than the DBC pool layout"
    },
    {
      "code": 6003,
      "name": "configNotOwnedByDbc",
      "msg": "The config account is not owned by the DBC program"
    },
    {
      "code": 6004,
      "name": "configDiscriminator",
      "msg": "The config account is not a PoolConfig or ConfigWithTransferHook"
    },
    {
      "code": 6005,
      "name": "configLayout",
      "msg": "The config account is shorter than the DBC config layout"
    },
    {
      "code": 6006,
      "name": "configMismatch",
      "msg": "The config account does not match the pool's config field"
    },
    {
      "code": 6007,
      "name": "quoteMintMismatch",
      "msg": "The quote mint does not match the config's quote_mint field"
    },
    {
      "code": 6008,
      "name": "quoteMintOwner",
      "msg": "The quote mint is not owned by the given token program"
    },
    {
      "code": 6009,
      "name": "poolAlreadyComplete",
      "msg": "The pool has already graduated or finished its curve"
    },
    {
      "code": 6010,
      "name": "deadlineInPast",
      "msg": "The deadline is not in the future"
    },
    {
      "code": 6011,
      "name": "deadlineTooFar",
      "msg": "The deadline is more than 180 days away"
    },
    {
      "code": 6012,
      "name": "marketNotOpen",
      "msg": "The market is no longer open"
    },
    {
      "code": 6013,
      "name": "deadlinePassed",
      "msg": "The deadline has passed; the market cannot take new stakes"
    },
    {
      "code": 6014,
      "name": "stakeTooSmall",
      "msg": "The stake is below the minimum"
    },
    {
      "code": 6015,
      "name": "notYet",
      "msg": "The pool has not graduated and the deadline has not passed"
    },
    {
      "code": 6016,
      "name": "notResolved",
      "msg": "The market has not been resolved"
    },
    {
      "code": 6017,
      "name": "positionMarketMismatch",
      "msg": "The position belongs to a different market"
    },
    {
      "code": 6018,
      "name": "alreadyClaimed",
      "msg": "The position has already been claimed"
    },
    {
      "code": 6019,
      "name": "overflow",
      "msg": "Arithmetic overflow"
    },
    {
      "code": 6020,
      "name": "vaultMismatch",
      "msg": "The vault does not match the market"
    },
    {
      "code": 6021,
      "name": "poolMismatch",
      "msg": "The pool does not match the market"
    },
    {
      "code": 6022,
      "name": "poolKindMismatch",
      "msg": "The pool and config are different DBC kinds"
    }
  ],
  "types": [
    {
      "name": "claimed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "market",
            "type": "pubkey"
          },
          {
            "name": "user",
            "type": "pubkey"
          },
          {
            "name": "state",
            "type": {
              "defined": {
                "name": "marketState"
              }
            }
          },
          {
            "name": "yesAmount",
            "type": "u64"
          },
          {
            "name": "noAmount",
            "type": "u64"
          },
          {
            "name": "payout",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "market",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "pool",
            "docs": [
              "The DBC pool the market is about (`VirtualPool` or `TransferHookPool`)."
            ],
            "type": "pubkey"
          },
          {
            "name": "config",
            "docs": [
              "The DBC config the pool points at (`PoolConfig` or `ConfigWithTransferHook`)."
            ],
            "type": "pubkey"
          },
          {
            "name": "quoteMint",
            "docs": [
              "The pool's quote mint. Stakes and payouts are in this token."
            ],
            "type": "pubkey"
          },
          {
            "name": "tokenProgram",
            "docs": [
              "The token program that owns `quote_mint` (Token or Token-2022)."
            ],
            "type": "pubkey"
          },
          {
            "name": "vault",
            "docs": [
              "The market's token account holding every stake."
            ],
            "type": "pubkey"
          },
          {
            "name": "creator",
            "docs": [
              "Who created the market. Carries no rights."
            ],
            "type": "pubkey"
          },
          {
            "name": "deadlineTs",
            "docs": [
              "Unix time. YES wins if the curve finishes at or before it."
            ],
            "type": "i64"
          },
          {
            "name": "migrationQuoteThreshold",
            "docs": [
              "`migration_quote_threshold` read from the config at creation."
            ],
            "type": "u64"
          },
          {
            "name": "yesTotal",
            "docs": [
              "Sum of YES stakes actually received by the vault."
            ],
            "type": "u64"
          },
          {
            "name": "noTotal",
            "docs": [
              "Sum of NO stakes actually received by the vault."
            ],
            "type": "u64"
          },
          {
            "name": "paidOut",
            "docs": [
              "Sum of payouts sent out of the vault so far."
            ],
            "type": "u64"
          },
          {
            "name": "state",
            "type": {
              "defined": {
                "name": "marketState"
              }
            }
          },
          {
            "name": "resolvedAt",
            "docs": [
              "Unix time of resolution, zero while open."
            ],
            "type": "i64"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "vaultBump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "marketCreated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "market",
            "type": "pubkey"
          },
          {
            "name": "pool",
            "type": "pubkey"
          },
          {
            "name": "config",
            "type": "pubkey"
          },
          {
            "name": "quoteMint",
            "type": "pubkey"
          },
          {
            "name": "creator",
            "type": "pubkey"
          },
          {
            "name": "deadlineTs",
            "type": "i64"
          },
          {
            "name": "migrationQuoteThreshold",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "marketState",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "open"
          },
          {
            "name": "resolvedYes"
          },
          {
            "name": "resolvedNo"
          },
          {
            "name": "refund"
          }
        ]
      }
    },
    {
      "name": "position",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "market",
            "type": "pubkey"
          },
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "yesAmount",
            "type": "u64"
          },
          {
            "name": "noAmount",
            "type": "u64"
          },
          {
            "name": "claimed",
            "type": "bool"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "resolved",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "market",
            "type": "pubkey"
          },
          {
            "name": "state",
            "type": {
              "defined": {
                "name": "marketState"
              }
            }
          },
          {
            "name": "yesTotal",
            "type": "u64"
          },
          {
            "name": "noTotal",
            "type": "u64"
          },
          {
            "name": "resolvedAt",
            "type": "i64"
          },
          {
            "name": "isMigrated",
            "type": "u8"
          },
          {
            "name": "finishCurveTimestamp",
            "type": "u64"
          },
          {
            "name": "quoteReserve",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "side",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "yes"
          },
          {
            "name": "no"
          }
        ]
      }
    },
    {
      "name": "staked",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "market",
            "type": "pubkey"
          },
          {
            "name": "user",
            "type": "pubkey"
          },
          {
            "name": "side",
            "type": {
              "defined": {
                "name": "side"
              }
            }
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "yesTotal",
            "type": "u64"
          },
          {
            "name": "noTotal",
            "type": "u64"
          }
        ]
      }
    }
  ]
};

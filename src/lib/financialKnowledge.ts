// A small, fixed reference of well-established personal-finance guidelines —
// baked in locally (no network fetch, no external API/AI) since these rules
// are stable, well-known conventions rather than information that changes
// day to day. This is what the local answer engine reasons against, on top
// of your own real numbers, for advice-shaped questions ("should I buy
// this?", "how's my budget?") rather than pure lookups ("how much is left?").

// The classic 50/30/20 split: needs / wants / savings, as fractions of income.
export const BUDGET_RULE_50_30_20 = {
  needs: 0.5,
  wants: 0.3,
  savings: 0.2,
}

// How far off the 50/30/20 split before it's worth flagging.
export const BUDGET_RULE_TOLERANCE = 0.05

// Categories treated as "needs" for the 50/30/20 check — anything else
// (Dining, Subscriptions, Other Expense, ...) defaults to "wants".
export const NEEDS_CATEGORIES = new Set(['Rent', 'Utilities', 'Groceries', 'Transport'])

// Recommended emergency-fund size, in months of expenses.
export const EMERGENCY_FUND_MONTHS = { min: 3, max: 6 }

// A one-off purchase eating more than this fraction of what's left in the
// relevant budget is worth a "that's a big chunk of what's left" nudge.
export const PURCHASE_CAUTION_FRACTION = 0.5

// The classic "sleep on it" rule of thumb for non-essential purchases at or
// above this amount, independent of budget headroom.
export const IMPULSE_COOLDOWN_AMOUNT = 1000

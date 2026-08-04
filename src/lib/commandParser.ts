import type {
  Account,
  Budget,
  Category,
  CommandAlias,
  PayoutDate,
  PayoutSchedule,
  RecurringBill,
  Transaction,
  Transfer,
} from '../db'
import { parseISODate, todayISO } from './dates'
import { signedAmount } from './finance'
import { formatMoney } from './format'
import { CATEGORY_KEYWORDS } from './categoryLexicon'
import { buildFinancialContext, composeBudgetHealthCheck, composeLocalAnswer, composePurchaseAdvice } from './financialContext'
import { getNextPendingPayout } from './payout'

export type ParsedCommandType =
  | 'expense'
  | 'income'
  | 'transfer'
  | 'createAccount'
  | 'addBalance'
  | 'setBudget'
  | 'addRecurringBill'
  | 'addPayoutSchedule'
  | 'logPayout'
  | 'deleteTransaction'
  | 'editTransaction'
  | 'deleteBill'
  | 'deleteBudget'
  | 'query'
  | 'unrecognized'

/** How sure the parser is about a resolved account/category:
 * - 'exact': exact name match, substring match, learned CommandAlias, or a
 *   deliberate fallback (default account, "Other" bucket) — safe to act on
 *   immediately.
 * - 'fuzzy': only matched via Levenshtein edit-distance — close enough to
 *   suggest, but typo-prone (e.g. an unrelated word landing on "Rent" at
 *   edit-distance 1), so the caller should confirm with the user before
 *   writing anything. */
export type MatchConfidence = 'exact' | 'fuzzy'

export interface ParsedCommand {
  type: ParsedCommandType
  amount?: number
  accountId?: number
  categoryId?: number
  fromAccountId?: number
  toAccountId?: number
  newAccountName?: string
  /** The specific word you typed (e.g. "jeep", "tric") when it didn't match
   * an existing category — kept as the transaction's note so you can still
   * tell entries apart even though they share a general category. */
  note?: string
  /** type 'addRecurringBill' */
  billName?: string
  dueDay?: number
  /** type 'addPayoutSchedule' */
  scheduleLabel?: string
  /** type 'logPayout' — the specific pending PayoutDate row being fulfilled. */
  payoutDateId?: number
  /** type 'deleteTransaction' | 'editTransaction' — the specific transaction
   * identified (by recency, optionally filtered by category/account) as the
   * target. accountId/categoryId/*Confidence/*Phrase above double as the
   * *filter* used to find it (reusing the same fuzzy-confirmation gate as
   * every other command), not the transaction's own fields. */
  transactionId?: number
  /** type 'editTransaction' — the new value(s) to apply. Only the field(s)
   * actually mentioned are set; executeCommand only patches those. */
  newAmount?: number
  newCategoryId?: number
  newCategoryConfidence?: MatchConfidence
  newAccountId?: number
  newAccountConfidence?: MatchConfidence
  /** type 'deleteBill' */
  billId?: number
  /** type 'deleteBudget' */
  budgetId?: number
  date: string
  summary: string
  raw: string
  /** The phrase tried against accounts — recorded so a correction can be
   * saved as a reusable alias. */
  accountPhrase?: string
  /** The phrase tried against categories (or used to name a new one). */
  categoryPhrase?: string
  /** The phrases tried for a transfer's two sides — same purpose as
   * accountPhrase, split in two since a transfer resolves two accounts. */
  fromAccountPhrase?: string
  toAccountPhrase?: string
  /** Confidence of each resolved field, present whenever the corresponding
   * *Id field is set from an account/category match (as opposed to being
   * absent, or naming a brand-new entity like `createAccount`). Consumers
   * (CommandBar) should gate execution behind user confirmation whenever any
   * of these is 'fuzzy'. */
  accountConfidence?: MatchConfidence
  categoryConfidence?: MatchConfidence
  fromAccountConfidence?: MatchConfidence
  toAccountConfidence?: MatchConfidence
}

// Cheap Levenshtein distance for fuzzy word matching — good enough for short
// account/category names, no need for a real fuzzy-search dependency.
function levenshtein(a: string, b: string): number {
  const m = a.length
  const n = b.length
  if (m === 0) return n
  if (n === 0) return m
  const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)])
  for (let j = 0; j <= n; j++) dp[0][j] = j
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1])
    }
  }
  return dp[m][n]
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim()
}

function properCase(s: string): string {
  return s.replace(/\b\w/g, (ch) => ch.toUpperCase())
}

/** An entity match plus how it was found — see `MatchConfidence`. */
export interface Resolution<T> {
  entity: T
  confidence: MatchConfidence
}

/** Finds the entity whose name best matches `text`. Tries the whole phrase
 * first (exact, then substring — both 'exact' confidence), then falls back
 * to edit-distance ('fuzzy' confidence, since a close-but-wrong word can slip
 * under the threshold), checking each individual word too — so "grocery run"
 * still finds "Groceries" even though the two-word phrase itself doesn't
 * match. */
function fuzzyFind<T extends { name: string }>(text: string, candidates: T[]): Resolution<T> | undefined {
  const normText = normalize(text)
  if (!normText || candidates.length === 0) return undefined
  const words = normText.split(/\s+/).filter(Boolean)

  for (const c of candidates) {
    if (normText === normalize(c.name)) return { entity: c, confidence: 'exact' }
  }
  for (const c of candidates) {
    const cName = normalize(c.name)
    if (normText.includes(cName) || cName.includes(normText)) return { entity: c, confidence: 'exact' }
  }

  let best: { c: T; dist: number } | undefined
  const consider = (candidate: T, cName: string, dist: number) => {
    const threshold = Math.max(1, Math.floor(cName.length * 0.3))
    if (dist <= threshold && (!best || dist < best.dist)) best = { c: candidate, dist }
  }
  for (const c of candidates) {
    const cName = normalize(c.name)
    consider(c, cName, levenshtein(normText, cName))
    for (const w of words) consider(c, cName, levenshtein(w, cName))
  }
  return best ? { entity: best.c, confidence: 'fuzzy' } : undefined
}

/** Looks up a learned alias for `phrase` and returns the matching entity if
 * it still exists in `pool` (aliases pointing at a deleted account/category
 * are silently ignored, falling through to fuzzy matching). */
function findByAlias<T extends { id: number }>(
  phrase: string,
  entityType: CommandAlias['entityType'],
  aliases: CommandAlias[],
  pool: T[],
): T | undefined {
  const normPhrase = normalize(phrase)
  if (!normPhrase) return undefined
  const alias = aliases.find((a) => a.entityType === entityType && a.phrase === normPhrase)
  if (!alias) return undefined
  return pool.find((p) => p.id === alias.entityId)
}

function resolveAccount(phrase: string, accounts: Account[], aliases: CommandAlias[]): Resolution<Account> | undefined {
  const aliasHit = findByAlias(phrase, 'account', aliases, accounts)
  if (aliasHit) return { entity: aliasHit, confidence: 'exact' }
  return fuzzyFind(phrase, accounts)
}

/** Same idea as `resolveAccount`, for categories — checks the learned alias
 * table, then the curated keyword lexicon (both 'exact' confidence, since
 * neither is edit-distance-based), then falls back to fuzzy matching. */
function resolveCategory(
  phrase: string,
  categories: Category[],
  aliases: CommandAlias[],
): Resolution<Category> | undefined {
  const aliasHit = findByAlias(phrase, 'category', aliases, categories)
  if (aliasHit) return { entity: aliasHit, confidence: 'exact' }
  const lexiconHit = findByLexicon(phrase, categories)
  if (lexiconHit) return { entity: lexiconHit, confidence: 'exact' }
  return fuzzyFind(phrase, categories)
}

/** Checks `phrase` against the built-in word-family lexicon (e.g. "jeep",
 * "grab" → Transport) so related-but-never-taught words still land in the
 * right category, restricted to whichever `categories` are actually
 * available (already filtered to income/expense). */
function findByLexicon(phrase: string, categories: Category[]): Category | undefined {
  const normPhrase = normalize(phrase)
  if (!normPhrase) return undefined
  const words = normPhrase.split(/\s+/).filter(Boolean)
  for (const [categoryName, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    if (keywords.some((k) => words.includes(k))) {
      const match = categories.find((c) => c.name === categoryName)
      if (match) return match
    }
  }
  return undefined
}

/** Splits `cleaned` into "the word(s) that name the account" and "the
 * leftover word(s) that name the category" — tries single words first (so
 * "lunch gcash" isolates "gcash" as the account and "lunch" as the category
 * phrase), then falls back to treating the whole phrase as the account name
 * (for multi-word account names). */
function splitAccountAndCategoryText(
  cleaned: string,
  accounts: Account[],
  aliases: CommandAlias[],
): {
  account: Account | undefined
  accountConfidence: MatchConfidence | undefined
  accountPhrase: string
  categoryPhrase: string
} {
  const words = cleaned.split(/\s+/).filter(Boolean)

  for (let i = 0; i < words.length; i++) {
    const hit = resolveAccount(words[i], accounts, aliases)
    if (hit) {
      return {
        account: hit.entity,
        accountConfidence: hit.confidence,
        accountPhrase: words[i],
        categoryPhrase: words.filter((_, j) => j !== i).join(' ').trim(),
      }
    }
  }

  const wholePhraseHit = words.length > 1 ? resolveAccount(cleaned, accounts, aliases) : undefined
  if (wholePhraseHit) {
    return {
      account: wholePhraseHit.entity,
      accountConfidence: wholePhraseHit.confidence,
      accountPhrase: cleaned,
      categoryPhrase: '',
    }
  }

  return { account: undefined, accountConfidence: undefined, accountPhrase: cleaned, categoryPhrase: cleaned }
}

// Pure grammar/filler words stripped out before scanning a free-text question
// for a category mention — none of these collide with a real lexicon keyword
// or category name, so it's safe to discard them wholesale.
const QUERY_STOPWORDS = new Set([
  'how', 'much', 'many', 'can', 'could', 'should', 'i', 'a', 'an', 'the', 'is', 'are', 'do',
  'does', 'to', 'for', 'me', 'my', 'on', 'in', 'of', 'left', 'have', 'has', 'afford', 'spend',
  'spending', 'budget', 'good', 'recommend', 'recommendation', 'suggest', 'suggestion', 'what',
  'whats', 'this', 'month', 'ok', 'okay', 'if', 'want', 'wanna', 'need', 'get', 'going',
])

/** Scans a free-text question (not a stripped "categoryPhrase") for any
 * category it might be about. Deliberately skips the Levenshtein fuzzy pass
 * used for transaction parsing — full sentences have too many unrelated
 * words for edit-distance matching to stay safe, so this only trusts exact
 * alias/lexicon hits plus an exact category-name substring check. */
function findMentionedCategory(
  text: string,
  categories: Category[],
  aliases: CommandAlias[],
): Category | undefined {
  const normText = normalize(text)
  const words = normText.split(/\s+/).filter((w) => w && !QUERY_STOPWORDS.has(w))
  for (const w of words) {
    const hit = findByAlias(w, 'category', aliases, categories) ?? findByLexicon(w, categories)
    if (hit) return hit
  }
  for (const c of categories) {
    if (normText.includes(normalize(c.name))) return c
  }
  return undefined
}

// Budget/spending questions: "how much can I spend on dining", "what's a
// good budget for me", "can I afford to eat out". Checked before the
// transfer/expense/income parsing below so words like "spend" or "budget"
// never get misrouted into logging a transaction.
const QUERY_RE = /\b(how much|how many|what'?s|what is|can i|should i|recommend|suggest|good budget|budget (for|advice)|afford)\b/

// "Should I buy this ₱X?" — a one-off purchase decision, checked against the
// relevant category's remaining budget plus the impulse-cooldown rule.
const PURCHASE_RE = /\b(should i buy|can i buy|worth buying|worth it|is it worth)\b/

// "How's my budget?" — a general health check against the 50/30/20 guideline,
// as opposed to a question about one specific category.
const BUDGET_HEALTH_RE = /\b(how(?:'s| is) my budget|is my budget (good|ok|okay|fine|healthy)|am i doing (good|ok|okay|well)|how am i doing (financially|with money|money-wise))\b/

// The single gate for "is this a question, not a transaction" — the union of
// all three patterns above, so PURCHASE_RE/BUDGET_HEALTH_RE phrasings that
// don't happen to also match QUERY_RE (e.g. "is it worth buying...", "how is
// my budget") still get routed into the query branch instead of falling
// through and getting misfiled as a transaction.
function isBudgetQuery(text: string): boolean {
  return QUERY_RE.test(text) || PURCHASE_RE.test(text) || BUDGET_HEALTH_RE.test(text) || text.trim().endsWith('?')
}

const AMOUNT_RE = /(\d[\d,]*(?:\.\d+)?)/
const CURRENCY_WORDS_RE = /\b(pesos?|php|peso)\b/gi

function extractAmount(text: string): { amount: number | undefined; rest: string } {
  const match = text.match(AMOUNT_RE)
  if (!match) return { amount: undefined, rest: text }
  const amount = Number(match[1].replace(/,/g, ''))
  const idx = match.index ?? 0
  const rest = (text.slice(0, idx) + ' ' + text.slice(idx + match[0].length))
    .replace(CURRENCY_WORDS_RE, ' ')
    .replace(/[₱$]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return { amount, rest }
}

// Most-recent-first transactions, capped so "last transaction"/"last <x>
// expense" style lookups don't have to rescan an unbounded history — recency
// is all that matters for finding a target, so anything older than this is
// assumed to not be what "last" refers to.
const RECENT_TRANSACTION_LIMIT = 50

function recentTransactions(transactions: Transaction[]): Transaction[] {
  return [...transactions].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, RECENT_TRANSACTION_LIMIT)
}

/** The transaction identified as the target of a deleteTransaction/
 * editTransaction command, plus whichever category/account filter (if any)
 * was used to find it — carried through as the same accountId/categoryId
 * fields (and confidences) every other command uses, so it plugs straight
 * into the existing fuzzy-confirmation gate without any new machinery. */
interface TransactionTarget {
  transaction: Transaction
  categoryId?: number
  categoryConfidence?: MatchConfidence
  categoryPhrase?: string
  accountId?: number
  accountConfidence?: MatchConfidence
  accountPhrase?: string
}

/** Finds the most recent transaction matching an optional free-text filter
 * (a mentioned category and/or account — e.g. "groceries", "gcash", or both
 * words together). Returns a `reason` instead of a `target` whenever nothing
 * can be found, so the caller can surface a specific message rather than a
 * generic parse failure.
 *
 * Note: if the filter term only resolves 'fuzzy' and the user later taps
 * "Fix" in the confirmation UI, the override only changes which
 * account/category is *reported* for execution — it does not re-run this
 * lookup against the corrected entity. That's an accepted simplification
 * (matching how fuzzy corrections already work for every other command):
 * the mandatory destructive-action preview shows the actual resolved
 * transaction before anything executes, so a wrong guess is still caught,
 * just by "Cancel and retype" rather than "Fix". */
function findTransactionTarget(
  filterPhrase: string,
  ctx: ParseContext,
  aliases: CommandAlias[],
): { target?: TransactionTarget; reason?: string } {
  const pool = recentTransactions(ctx.transactions ?? [])
  if (pool.length === 0) return { reason: 'No transactions yet.' }

  let categoryId: number | undefined
  let categoryConfidence: MatchConfidence | undefined
  let categoryName: string | undefined
  let accountId: number | undefined
  let accountConfidence: MatchConfidence | undefined
  let accountName: string | undefined

  if (filterPhrase) {
    const categoryMatch = resolveCategory(filterPhrase, ctx.categories, aliases)
    if (categoryMatch) {
      categoryId = categoryMatch.entity.id
      categoryConfidence = categoryMatch.confidence
      categoryName = categoryMatch.entity.name
    }
    const accountMatch = resolveAccount(filterPhrase, ctx.accounts, aliases)
    if (accountMatch) {
      accountId = accountMatch.entity.id
      accountConfidence = accountMatch.confidence
      accountName = accountMatch.entity.name
    }
    if (categoryId === undefined && accountId === undefined) {
      return { reason: `Couldn't tell which transaction — "${filterPhrase}" isn't a known category or account.` }
    }
  }

  const match = pool.find(
    (t) =>
      (categoryId === undefined || t.categoryId === categoryId) &&
      (accountId === undefined || t.accountId === accountId),
  )
  if (!match) {
    const what = [categoryName, accountName].filter(Boolean).join(' at ')
    return { reason: what ? `No recent ${what} transaction found.` : 'No transactions yet.' }
  }

  return {
    target: {
      transaction: match,
      categoryId,
      categoryConfidence,
      categoryPhrase: filterPhrase || undefined,
      accountId,
      accountConfidence,
      accountPhrase: filterPhrase || undefined,
    },
  }
}

/** Short one-line description of a transaction for delete/edit confirmation
 * summaries — e.g. "Jul 31 - Groceries -₱200.00 (GCash)". */
function describeTransaction(t: Transaction, ctx: ParseContext): string {
  const category = ctx.categories.find((c) => c.id === t.categoryId)
  const account = ctx.accounts.find((a) => a.id === t.accountId)
  const signed = category ? signedAmount(t.amount, category.kind) : t.amount
  const dateLabel = parseISODate(t.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  return `${dateLabel} - ${category?.name ?? 'Unknown'} ${formatMoney(signed)}${account ? ` (${account.name})` : ''}`
}

export interface ParseContext {
  accounts: Account[]
  categories: Category[]
  aliases?: CommandAlias[]
  /** Account to prefer when no account can be resolved at all (e.g. the most
   * recently used one) — falls back to accounts[0] if omitted. */
  defaultAccountId?: number
  /** Needed only to answer budget/spending questions (type 'query') — omit
   * for plain transaction parsing. */
  budgets?: Budget[]
  transactions?: Transaction[]
  transfers?: Transfer[]
  /** Needed only for "log payout ..." — to find the next pending PayoutDate. */
  payoutSchedules?: PayoutSchedule[]
  payoutDates?: PayoutDate[]
  /** Needed only for "delete/remove bill ..." — to resolve the target bill by name. */
  recurringBills?: RecurringBill[]
}

export function parseCommand(rawInput: string, ctx: ParseContext): ParsedCommand {
  const raw = rawInput.trim()
  const text = raw.toLowerCase()
  const date = todayISO()
  const aliases = ctx.aliases ?? []
  const expenseCategories = ctx.categories.filter((c) => c.kind === 'expense' && !c.system)
  const incomeCategories = ctx.categories.filter((c) => c.kind === 'income' && !c.system)

  const unrecognized: ParsedCommand = {
    type: 'unrecognized',
    date,
    raw,
    summary: "Couldn't understand that — try something like \"expense 200 groceries\" or \"add gcash 500\".",
  }

  // The four action blocks below are all anchored to the start of the string
  // (^bill, ^payout, ^budget, ...) and are checked BEFORE the budget/spending
  // Q&A block that follows them. This matters: a natural phrasing like
  // "budget for dining 3000" also matches the Q&A trigger's "budget for"
  // sub-pattern (meant for "what's my budget advice"-style questions) — since
  // these action blocks are more specific (anchored) they get first refusal,
  // so a real "set a budget" command never gets swallowed by the Q&A branch.

  // Add payout schedule: "add payout schedule bonus gotyme" — a one-time
  // setup action (which account/category a recurring payout lands in).
  // Checked before the plain "log payout ..." trigger below, which it would
  // otherwise also match on the leading "payout" word — anchoring both to
  // the start of the string keeps them mutually exclusive regardless of
  // check order, but this one is more specific so it's listed first.
  if (/^(add |create |new )?payout schedule\b/.test(text)) {
    const cleaned = text
      .replace(/^(add|create|new)\b/, ' ')
      .replace(/\bpayout schedule\b/, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    if (!cleaned) return unrecognized

    const { account, accountConfidence, accountPhrase, categoryPhrase } = splitAccountAndCategoryText(
      cleaned,
      ctx.accounts,
      aliases,
    )
    const categoryMatch = categoryPhrase ? resolveCategory(categoryPhrase, incomeCategories, aliases) : undefined
    const resolvedCategory =
      categoryMatch?.entity ?? incomeCategories.find((c) => c.name.startsWith('Other')) ?? incomeCategories[0]
    if (!resolvedCategory) return unrecognized
    // Falling back to the default "Other" bucket is a deliberate, safe choice
    // (not a guess), so it's 'exact' confidence just like a real match.
    const categoryConfidence: MatchConfidence = categoryMatch?.confidence ?? 'exact'

    const defaultAccount = ctx.accounts.find((a) => a.id === ctx.defaultAccountId) ?? ctx.accounts[0]
    const resolvedAccount = account ?? defaultAccount
    if (!resolvedAccount) return unrecognized
    // accountConfidence is only undefined when `account` itself is undefined
    // (see splitAccountAndCategoryText) — falling back to the default account
    // is, like the category fallback above, a deliberate choice, not a guess.
    const resolvedAccountConfidence: MatchConfidence = accountConfidence ?? 'exact'

    const label = categoryPhrase ? properCase(categoryPhrase) : resolvedCategory.name

    return {
      type: 'addPayoutSchedule',
      categoryId: resolvedCategory.id,
      accountId: resolvedAccount.id,
      scheduleLabel: label,
      date,
      raw,
      accountPhrase,
      categoryPhrase,
      accountConfidence: resolvedAccountConfidence,
      categoryConfidence,
      summary: `Add payout schedule "${label}" · ${resolvedCategory.name} · ${resolvedAccount.name}`,
    }
  }

  // Log payout: "log payout 20000", "payout 20000 gotyme" — fulfills the
  // next pending (unlogged, due) date on an active payout schedule, so it
  // clears the "pending payout" nag banner (unlike a plain "salary 20000",
  // which logs the income but isn't tied to any specific schedule date).
  if (/^(log |record )?payout\b/.test(text)) {
    const { amount, rest } = extractAmount(text)
    if (!amount) return unrecognized

    const nextPending = getNextPendingPayout(ctx.payoutSchedules ?? [], ctx.payoutDates ?? [])
    if (!nextPending) {
      return { type: 'unrecognized', date, raw, summary: 'No pending payout to log right now.' }
    }
    const { payoutDate: pending, schedule } = nextPending
    const category = ctx.categories.find((c) => c.id === schedule.categoryId)
    if (!category) return unrecognized

    const cleaned = rest
      .replace(/^(log|record)\b/, ' ')
      .replace(/\bpayout\b/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    const { account, accountConfidence, accountPhrase } = splitAccountAndCategoryText(cleaned, ctx.accounts, aliases)
    const resolvedAccount = account ?? ctx.accounts.find((a) => a.id === schedule.accountId) ?? ctx.accounts[0]
    if (!resolvedAccount) return unrecognized
    // Falling back to the schedule's own account (or accounts[0]) is a
    // deliberate default, not a guess, so it's 'exact' confidence.
    const resolvedAccountConfidence: MatchConfidence = accountConfidence ?? 'exact'

    return {
      type: 'logPayout',
      amount,
      accountId: resolvedAccount.id,
      // The category comes straight from the payout schedule, never a
      // text match, so it's always trustworthy.
      categoryId: category.id,
      categoryConfidence: 'exact',
      payoutDateId: pending.id,
      date,
      raw,
      accountPhrase,
      accountConfidence: resolvedAccountConfidence,
      summary: `Log payout ₱${amount.toLocaleString()} · ${category.name} · ${resolvedAccount.name} (${schedule.label})`,
    }
  }

  // Delete recurring bill: "remove bill netflix", "delete the netflix bill".
  // Checked before the "add bill ..." block below — its trigger requires the
  // string to start with add/create/new (or nothing) directly followed by
  // "bill", so "delete"/"remove" never falls into it, but this is listed
  // first anyway to keep the destructive commands grouped together.
  if (/^(remove|delete)\b.*\bbill\b/.test(text)) {
    const cleaned = text
      .replace(/^(remove|delete)\b/, ' ')
      .replace(/\bthe\b/g, ' ')
      .replace(/\b(recurring\s+)?bill\b/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    if (!cleaned) {
      return { type: 'unrecognized', date, raw, summary: 'Which bill? Try "delete bill netflix".' }
    }

    const bills = ctx.recurringBills ?? []
    if (bills.length === 0) {
      return { type: 'unrecognized', date, raw, summary: 'No recurring bills set up yet.' }
    }
    const match = fuzzyFind(cleaned, bills)
    if (!match) {
      return {
        type: 'unrecognized',
        date,
        raw,
        summary: `No bill named "${properCase(cleaned)}" found to delete.`,
      }
    }
    const bill = match.entity
    return {
      type: 'deleteBill',
      billId: bill.id,
      date,
      raw,
      summary: `Delete bill: ${bill.name} (₱${bill.amount.toLocaleString()}, due day ${bill.dueDay})?`,
    }
  }

  // Delete budget: "remove budget dining", "clear budget for groceries".
  // Checked before "set budget ..." below — that trigger requires an
  // optional "set "/"add " prefix directly followed by "budget", so
  // remove/delete/clear never match it, but again grouped here with the
  // other destructive commands for clarity.
  if (/^(remove|delete|clear)\s+budget\b/.test(text)) {
    const cleaned = text
      .replace(/^(remove|delete|clear)\b/, ' ')
      .replace(/\bbudget\b/g, ' ')
      .replace(/\bfor\b/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    if (!cleaned) {
      return { type: 'unrecognized', date, raw, summary: 'Which budget? Try "clear budget dining".' }
    }

    const categoryMatch = resolveCategory(cleaned, expenseCategories, aliases)
    if (!categoryMatch) {
      return { type: 'unrecognized', date, raw, summary: `"${properCase(cleaned)}" isn't a known category.` }
    }
    const { entity: category, confidence: categoryConfidence } = categoryMatch
    const budget = (ctx.budgets ?? []).find((b) => b.categoryId === category.id)
    if (!budget) {
      return { type: 'unrecognized', date, raw, summary: `No budget set for ${category.name} to clear.` }
    }

    return {
      type: 'deleteBudget',
      budgetId: budget.id,
      categoryId: category.id,
      categoryConfidence,
      categoryPhrase: cleaned,
      date,
      raw,
      summary: `Clear budget: ${category.name} (₱${budget.monthlyLimit.toLocaleString()}/mo)?`,
    }
  }

  // Add recurring bill: "add bill netflix 149 due 15", "recurring bill rent
  // 8000 due 1 landbank". Same account/category resolution as expense
  // parsing, reusing the leftover phrase as both the bill's display name and
  // the text checked against the category lexicon/fuzzy match.
  if (/^(add |create |new )?(recurring )?bill\b/.test(text)) {
    const dueDayMatch = text.match(/\bdue\s+(\d{1,2})\b/)
    const dueDay = dueDayMatch ? Math.min(31, Math.max(1, Number(dueDayMatch[1]))) : 1
    const withoutDue = text.replace(/\bdue\s+\d{1,2}\b/, ' ')

    const { amount, rest } = extractAmount(withoutDue)
    if (!amount) return unrecognized

    const cleaned = rest
      .replace(/^(add|create|new)\b/, ' ')
      .replace(/\b(recurring|bill)\b/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    if (!cleaned) return unrecognized

    const { account, accountConfidence, accountPhrase, categoryPhrase } = splitAccountAndCategoryText(
      cleaned,
      ctx.accounts,
      aliases,
    )
    if (!categoryPhrase) return unrecognized

    const categoryMatch = resolveCategory(categoryPhrase, expenseCategories, aliases)
    const category = categoryMatch?.entity ?? expenseCategories.find((c) => c.name.startsWith('Other')) ?? expenseCategories[0]
    if (!category) return unrecognized
    const categoryConfidence: MatchConfidence = categoryMatch?.confidence ?? 'exact'

    const defaultAccount = ctx.accounts.find((a) => a.id === ctx.defaultAccountId) ?? ctx.accounts[0]
    const resolvedAccount = account ?? defaultAccount
    if (!resolvedAccount) return unrecognized
    const resolvedAccountConfidence: MatchConfidence = accountConfidence ?? 'exact'

    const billName = properCase(categoryPhrase)

    return {
      type: 'addRecurringBill',
      amount,
      accountId: resolvedAccount.id,
      categoryId: category.id,
      billName,
      dueDay,
      date,
      raw,
      accountPhrase,
      categoryPhrase,
      accountConfidence: resolvedAccountConfidence,
      categoryConfidence,
      summary: `Recurring bill "${billName}" ₱${amount.toLocaleString()} · due day ${dueDay} · ${category.name} · ${resolvedAccount.name}`,
    }
  }

  // Set budget: "budget dining 3000", "set budget 2000 for groceries" —
  // unlike expense/income, this never falls back to a general "Other"
  // category: a budget only makes sense attached to something specific.
  if (/^(set |add )?budget\b/.test(text)) {
    const { amount, rest } = extractAmount(text)
    if (!amount) return unrecognized

    const cleaned = rest
      .replace(/^(set|add)\b/, ' ')
      .replace(/\b(budget|for)\b/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    if (!cleaned) return unrecognized

    const categoryMatch = resolveCategory(cleaned, expenseCategories, aliases)
    if (!categoryMatch) return unrecognized
    const { entity: category, confidence: categoryConfidence } = categoryMatch

    return {
      type: 'setBudget',
      amount,
      categoryId: category.id,
      categoryPhrase: cleaned,
      categoryConfidence,
      date,
      raw,
      summary: `Set ${category.name} budget to ₱${amount.toLocaleString()}/month`,
    }
  }

  // Delete/edit an existing transaction: "delete last transaction", "undo
  // last groceries expense", "remove last transaction at gcash", "change
  // last transaction to 150", "fix last transaction category to dining",
  // "move last transaction to gotyme". Both triggers are anchored (^) and
  // require both "last" and a transaction-ish word somewhere in the string,
  // so this can't misfire on an unrelated sentence that happens to start
  // with "change"/"move"/etc. Checked before the transfer block below, which
  // would otherwise swallow "move last transaction to gcash" via its bare
  // "move" trigger.
  const TX_TARGET_WORD_RE = /\b(transaction|expense|income|payment|purchase|entry)\b/
  const isDeleteTxCmd = /^(delete|remove|undo)\b/.test(text) && /\blast\b/.test(text) && TX_TARGET_WORD_RE.test(text)
  const isEditTxCmd =
    /^(change|edit|fix|update|move)\b/.test(text) && /\blast\b/.test(text) && TX_TARGET_WORD_RE.test(text)

  if (isDeleteTxCmd) {
    const filterPhrase = text
      .replace(/^(delete|remove|undo)\b/, ' ')
      .replace(/\blast\b/, ' ')
      .replace(/\b(transaction|expense|income|payment|purchase|entry)\b/g, ' ')
      .replace(/\b(at|my|the)\b/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()

    const { target, reason } = findTransactionTarget(filterPhrase, ctx, aliases)
    if (!target) {
      return { type: 'unrecognized', date, raw, summary: reason ?? "Couldn't find a transaction to delete." }
    }

    return {
      type: 'deleteTransaction',
      transactionId: target.transaction.id,
      categoryId: target.categoryId,
      categoryConfidence: target.categoryConfidence,
      categoryPhrase: target.categoryPhrase,
      accountId: target.accountId,
      accountConfidence: target.accountConfidence,
      accountPhrase: target.accountPhrase,
      date,
      raw,
      summary: `Delete: ${describeTransaction(target.transaction, ctx)}?`,
    }
  }

  if (isEditTxCmd) {
    if (!/\bto\b/.test(text)) {
      return {
        type: 'unrecognized',
        date,
        raw,
        summary: 'Missing new value — try "change last transaction to 150".',
      }
    }

    const [beforePartRaw, afterPartRaw] = text.split(/\bto\b/)
    const beforePart = beforePartRaw ?? ''
    const afterPart = (afterPartRaw ?? '').trim()
    if (!afterPart) {
      return {
        type: 'unrecognized',
        date,
        raw,
        summary: 'Missing new value — try "change last transaction to 150".',
      }
    }
    const wantsCategoryChange = /\bcategory\b/.test(text)

    const filterPhrase = beforePart
      .replace(/^(change|edit|fix|update|move)\b/, ' ')
      .replace(/\blast\b/, ' ')
      .replace(/\b(transaction|expense|income|payment|purchase|entry|category)\b/g, ' ')
      .replace(/\b(at|my|the)\b/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()

    const { target, reason } = findTransactionTarget(filterPhrase, ctx, aliases)
    if (!target) {
      return { type: 'unrecognized', date, raw, summary: reason ?? "Couldn't find a transaction to edit." }
    }

    const baseFields = {
      transactionId: target.transaction.id,
      categoryId: target.categoryId,
      categoryConfidence: target.categoryConfidence,
      categoryPhrase: target.categoryPhrase,
      accountId: target.accountId,
      accountConfidence: target.accountConfidence,
      accountPhrase: target.accountPhrase,
      date,
      raw,
    }

    if (wantsCategoryChange) {
      const newCategoryMatch = resolveCategory(afterPart, ctx.categories, aliases)
      if (!newCategoryMatch) {
        return { type: 'unrecognized', date, raw, summary: `"${afterPart}" isn't a known category.` }
      }
      return {
        ...baseFields,
        type: 'editTransaction',
        newCategoryId: newCategoryMatch.entity.id,
        newCategoryConfidence: newCategoryMatch.confidence,
        summary: `Change: ${describeTransaction(target.transaction, ctx)} → category ${newCategoryMatch.entity.name}?`,
      }
    }

    const { amount: newAmount } = extractAmount(afterPart)
    if (newAmount !== undefined) {
      const category = ctx.categories.find((c) => c.id === target.transaction.categoryId)
      const newSigned = category ? signedAmount(newAmount, category.kind) : newAmount
      return {
        ...baseFields,
        type: 'editTransaction',
        newAmount,
        summary: `Change: ${describeTransaction(target.transaction, ctx)} to ${formatMoney(newSigned)}?`,
      }
    }

    // Not a number and not a category change — treat as "move to <account>".
    const newAccountMatch = resolveAccount(afterPart, ctx.accounts, aliases)
    if (!newAccountMatch) {
      return {
        type: 'unrecognized',
        date,
        raw,
        summary: `"${afterPart}" isn't a known account, category, or amount.`,
      }
    }
    return {
      ...baseFields,
      type: 'editTransaction',
      newAccountId: newAccountMatch.entity.id,
      newAccountConfidence: newAccountMatch.confidence,
      summary: `Move: ${describeTransaction(target.transaction, ctx)} → ${newAccountMatch.entity.name}?`,
    }
  }

  // Budget/spending questions — answered entirely by a local script, no
  // network, no external AI. See financialContext.ts for the computation and
  // financialKnowledge.ts for the baked-in budgeting guidelines it reasons
  // against (50/30/20 split, impulse-purchase cooldown, etc).
  if (isBudgetQuery(text)) {
    const financialContext = buildFinancialContext(
      ctx.accounts,
      ctx.categories,
      ctx.transactions ?? [],
      ctx.transfers ?? [],
      ctx.budgets ?? [],
    )

    if (PURCHASE_RE.test(text)) {
      const { amount, rest } = extractAmount(text)
      const category = findMentionedCategory(rest, expenseCategories, aliases)
      return {
        type: 'query',
        date,
        raw,
        summary: composePurchaseAdvice(financialContext, amount, category?.name),
      }
    }

    if (BUDGET_HEALTH_RE.test(text)) {
      return {
        type: 'query',
        date,
        raw,
        summary: composeBudgetHealthCheck(financialContext),
      }
    }

    const category = findMentionedCategory(text, expenseCategories, aliases)
    return {
      type: 'query',
      date,
      raw,
      summary: composeLocalAnswer(financialContext, category?.name),
    }
  }

  // Transfer: "transfer 500 from gcash to gotyme" / "move 500 gcash to gotyme"
  // Matches on "transfer"/"move" alone (not also requiring "to" up front) so a
  // missing destination is rejected with a specific message here, rather than
  // silently falling through to the expense parser below and getting logged
  // as a mis-categorized expense instead of a rejected transfer.
  if (/\b(transfer|move)\b/.test(text)) {
    const { amount, rest } = extractAmount(text)
    if (!/\bto\b/.test(rest)) {
      return {
        type: 'unrecognized',
        date,
        raw,
        summary: 'Missing destination — try "transfer 500 gcash to savings".',
      }
    }
    const [beforeTo, afterTo] = rest.split(/\bto\b/)
    const fromText = (beforeTo ?? '').replace(/\b(transfer|move|from)\b/g, ' ')
    const toText = afterTo ?? ''
    const fromMatch = resolveAccount(fromText, ctx.accounts, aliases)
    const toMatch = resolveAccount(toText, ctx.accounts, aliases)
    if (amount && fromMatch && toMatch && fromMatch.entity.id !== toMatch.entity.id) {
      return {
        type: 'transfer',
        amount,
        fromAccountId: fromMatch.entity.id,
        toAccountId: toMatch.entity.id,
        fromAccountPhrase: fromText.trim(),
        toAccountPhrase: toText.trim(),
        fromAccountConfidence: fromMatch.confidence,
        toAccountConfidence: toMatch.confidence,
        date,
        raw,
        summary: `Transfer ₱${amount.toLocaleString()} from ${fromMatch.entity.name} to ${toMatch.entity.name}`,
      }
    }
    return unrecognized
  }

  // Add account / add balance: "add maribank with 500 pesos", "add gcash 500"
  if (/^(add|create)\b/.test(text) && !/\b(expense|income|transaction)\b/.test(text)) {
    const { amount, rest } = extractAmount(text)
    const name = rest
      .replace(/^(add|create)\b/, '')
      .replace(/\b(account|with|balance)\b/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()

    if (name) {
      const existingMatch = resolveAccount(name, ctx.accounts, aliases)
      if (existingMatch) {
        const existingAccount = existingMatch.entity
        if (amount) {
          return {
            type: 'addBalance',
            amount,
            accountId: existingAccount.id,
            accountPhrase: name,
            accountConfidence: existingMatch.confidence,
            date,
            raw,
            summary: `Add ₱${amount.toLocaleString()} balance to ${existingAccount.name}`,
          }
        }
        return unrecognized
      }
      const properName = properCase(name)
      return {
        type: 'createAccount',
        amount,
        newAccountName: properName,
        date,
        raw,
        summary: amount
          ? `Create account "${properName}" with ₱${amount.toLocaleString()} starting balance`
          : `Create account "${properName}"`,
      }
    }
    return unrecognized
  }

  // Expense: "expense 2200 cash", "spent 500 on groceries gcash", "paid 100 transport"
  // "paid" alone is an expense trigger ("paid rent 500"), but "got paid" is an
  // income phrase — and since "paid" is a substring word of "got paid", it
  // would otherwise trip the expense trigger too and win the tie-break below,
  // misfiling a payday as an expense. Suppress the bare "paid" expense signal
  // whenever "got paid" is present.
  const hasGotPaid = /\bgot paid\b/.test(text)
  const isExpense = /\b(expense|spent|spend|pay)\b/.test(text) || (/\bpaid\b/.test(text) && !hasGotPaid)
  const isIncome = /\b(income|received|receive|earned|salary)\b/.test(text) || hasGotPaid

  if (isExpense || isIncome || AMOUNT_RE.test(text)) {
    const { amount, rest } = extractAmount(text)
    if (!amount) return unrecognized

    // Note: "salary" is deliberately NOT stripped here — it doubles as both
    // the income-detection trigger word and the real "Salary" category name,
    // so it needs to survive into `cleaned` for category matching below.
    const cleaned = rest
      .replace(/\b(expense|spent|spend|paid|pay|income|received|receive|earned|got|on|from|using|via)\b/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()

    const kind: 'expense' | 'income' = isIncome && !isExpense ? 'income' : 'expense'
    const categories = kind === 'expense' ? expenseCategories : incomeCategories

    const { account, accountConfidence, accountPhrase, categoryPhrase } = splitAccountAndCategoryText(
      cleaned,
      ctx.accounts,
      aliases,
    )

    const categoryMatch = categoryPhrase ? resolveCategory(categoryPhrase, categories, aliases) : undefined
    const category = categoryMatch?.entity

    const defaultAccount = ctx.accounts.find((a) => a.id === ctx.defaultAccountId) ?? ctx.accounts[0]
    const resolvedAccount = account ?? defaultAccount
    if (!resolvedAccount) return unrecognized
    const resolvedAccountConfidence: MatchConfidence = accountConfidence ?? 'exact'

    // A matched category wins outright. Otherwise fall back to the general
    // bucket, but keep the specific word you typed (e.g. "jeep") as the
    // transaction's note so you can still tell entries apart later.
    const resolvedCategory = category ?? categories.find((c) => c.name.startsWith('Other')) ?? categories[0]
    if (!resolvedCategory) return unrecognized
    // No match at all falls back to "Other" — a deliberate, safe bucket, so
    // 'exact' confidence just like the account fallback above.
    const resolvedCategoryConfidence: MatchConfidence = categoryMatch?.confidence ?? 'exact'

    const note = !category && categoryPhrase ? properCase(categoryPhrase) : undefined
    const categoryLabel = note ? `${resolvedCategory.name} ("${note}")` : resolvedCategory.name

    return {
      type: kind,
      amount,
      accountId: resolvedAccount.id,
      categoryId: resolvedCategory.id,
      note,
      date,
      raw,
      accountPhrase,
      categoryPhrase,
      accountConfidence: resolvedAccountConfidence,
      categoryConfidence: resolvedCategoryConfidence,
      summary: `${kind === 'expense' ? 'Expense' : 'Income'} ₱${amount.toLocaleString()} · ${categoryLabel} · ${resolvedAccount.name}`,
    }
  }

  return unrecognized
}

/** The four fields a fuzzy match can land on — used by CommandBar to know
 * which part(s) of a parsed command need confirmation before it's safe to
 * execute/persist. */
export type FuzzyField = 'accountId' | 'categoryId' | 'fromAccountId' | 'toAccountId'

/** Which of a parsed command's resolved fields are 'fuzzy' — i.e. need user
 * confirmation before the command is safe to execute/persist. Exact/alias
 * matches and deliberate fallbacks (default account, "Other" category) are
 * excluded, since those already execute immediately today. */
export function getFuzzyFields(cmd: ParsedCommand): FuzzyField[] {
  const fields: FuzzyField[] = []
  if (cmd.accountId !== undefined && cmd.accountConfidence === 'fuzzy') fields.push('accountId')
  if (cmd.categoryId !== undefined && cmd.categoryConfidence === 'fuzzy') fields.push('categoryId')
  if (cmd.fromAccountId !== undefined && cmd.fromAccountConfidence === 'fuzzy') fields.push('fromAccountId')
  if (cmd.toAccountId !== undefined && cmd.toAccountConfidence === 'fuzzy') fields.push('toAccountId')
  return fields
}

/** Convenience wrapper around `getFuzzyFields` for a simple yes/no gate. */
export function hasLowConfidenceMatch(cmd: ParsedCommand): boolean {
  return getFuzzyFields(cmd).length > 0
}

/** The entity id currently guessed for a given field. */
export function fuzzyFieldEntityId(cmd: ParsedCommand, field: FuzzyField): number | undefined {
  return cmd[field]
}

/** The phrase originally typed for a given fuzzy field, and the alias entity
 * type it belongs to — used to save a CommandAlias once the user confirms or
 * corrects that field. */
export function fuzzyFieldPhrase(
  cmd: ParsedCommand,
  field: FuzzyField,
): { phrase: string; entityType: CommandAlias['entityType'] } | undefined {
  const phrase =
    field === 'accountId'
      ? cmd.accountPhrase
      : field === 'categoryId'
        ? cmd.categoryPhrase
        : field === 'fromAccountId'
          ? cmd.fromAccountPhrase
          : cmd.toAccountPhrase
  const entityType: CommandAlias['entityType'] = field === 'categoryId' ? 'category' : 'account'
  return phrase ? { phrase, entityType } : undefined
}

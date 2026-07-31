import type { Account, Budget, Category, CommandAlias, PayoutDate, PayoutSchedule, Transaction, Transfer } from '../db'
import { todayISO } from './dates'
import { CATEGORY_KEYWORDS } from './categoryLexicon'
import { buildFinancialContext, composeBudgetHealthCheck, composeLocalAnswer, composePurchaseAdvice } from './financialContext'

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
  | 'query'
  | 'unrecognized'

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
  date: string
  summary: string
  raw: string
  /** The phrase tried against accounts — recorded so a correction can be
   * saved as a reusable alias. */
  accountPhrase?: string
  /** The phrase tried against categories (or used to name a new one). */
  categoryPhrase?: string
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

/** Finds the entity whose name best matches `text`. Tries the whole phrase
 * first (exact, then substring, then edit-distance), then falls back to
 * checking each individual word — so "grocery run" still finds "Groceries"
 * even though the two-word phrase itself doesn't match. */
function fuzzyFind<T extends { name: string }>(text: string, candidates: T[]): T | undefined {
  const normText = normalize(text)
  if (!normText || candidates.length === 0) return undefined
  const words = normText.split(/\s+/).filter(Boolean)

  for (const c of candidates) {
    if (normText === normalize(c.name)) return c
  }
  for (const c of candidates) {
    const cName = normalize(c.name)
    if (normText.includes(cName) || cName.includes(normText)) return c
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
  return best?.c
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

function resolveAccount(phrase: string, accounts: Account[], aliases: CommandAlias[]): Account | undefined {
  return findByAlias(phrase, 'account', aliases, accounts) ?? fuzzyFind(phrase, accounts)
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
): { account: Account | undefined; accountPhrase: string; categoryPhrase: string } {
  const words = cleaned.split(/\s+/).filter(Boolean)

  for (let i = 0; i < words.length; i++) {
    const hit = resolveAccount(words[i], accounts, aliases)
    if (hit) {
      return {
        account: hit,
        accountPhrase: words[i],
        categoryPhrase: words.filter((_, j) => j !== i).join(' ').trim(),
      }
    }
  }

  const wholePhraseHit = words.length > 1 ? resolveAccount(cleaned, accounts, aliases) : undefined
  if (wholePhraseHit) {
    return { account: wholePhraseHit, accountPhrase: cleaned, categoryPhrase: '' }
  }

  return { account: undefined, accountPhrase: cleaned, categoryPhrase: cleaned }
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

    const { account, accountPhrase, categoryPhrase } = splitAccountAndCategoryText(cleaned, ctx.accounts, aliases)
    const category = categoryPhrase
      ? findByAlias(categoryPhrase, 'category', aliases, incomeCategories) ??
        findByLexicon(categoryPhrase, incomeCategories) ??
        fuzzyFind(categoryPhrase, incomeCategories)
      : undefined
    const resolvedCategory = category ?? incomeCategories.find((c) => c.name.startsWith('Other')) ?? incomeCategories[0]
    if (!resolvedCategory) return unrecognized

    const defaultAccount = ctx.accounts.find((a) => a.id === ctx.defaultAccountId) ?? ctx.accounts[0]
    const resolvedAccount = account ?? defaultAccount
    if (!resolvedAccount) return unrecognized

    const label = categoryPhrase ? properCase(categoryPhrase) : resolvedCategory.name

    return {
      type: 'addPayoutSchedule',
      categoryId: resolvedCategory.id,
      accountId: resolvedAccount.id,
      scheduleLabel: label,
      date,
      raw,
      accountPhrase,
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

    const activeSchedules = (ctx.payoutSchedules ?? []).filter((s) => s.active)
    const pending = (ctx.payoutDates ?? [])
      .filter((pd) => !pd.loggedTransactionId && pd.date <= date && activeSchedules.some((s) => s.id === pd.scheduleId))
      .sort((a, b) => a.date.localeCompare(b.date))[0]

    if (!pending) {
      return { type: 'unrecognized', date, raw, summary: 'No pending payout to log right now.' }
    }
    const schedule = activeSchedules.find((s) => s.id === pending.scheduleId)
    const category = schedule ? ctx.categories.find((c) => c.id === schedule.categoryId) : undefined
    if (!schedule || !category) return unrecognized

    const cleaned = rest
      .replace(/^(log|record)\b/, ' ')
      .replace(/\bpayout\b/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    const { account, accountPhrase } = splitAccountAndCategoryText(cleaned, ctx.accounts, aliases)
    const resolvedAccount = account ?? ctx.accounts.find((a) => a.id === schedule.accountId) ?? ctx.accounts[0]
    if (!resolvedAccount) return unrecognized

    return {
      type: 'logPayout',
      amount,
      accountId: resolvedAccount.id,
      categoryId: category.id,
      payoutDateId: pending.id,
      date,
      raw,
      accountPhrase,
      summary: `Log payout ₱${amount.toLocaleString()} · ${category.name} · ${resolvedAccount.name} (${schedule.label})`,
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

    const { account, accountPhrase, categoryPhrase } = splitAccountAndCategoryText(cleaned, ctx.accounts, aliases)
    if (!categoryPhrase) return unrecognized

    const category = findByAlias(categoryPhrase, 'category', aliases, expenseCategories) ??
      findByLexicon(categoryPhrase, expenseCategories) ??
      fuzzyFind(categoryPhrase, expenseCategories) ??
      expenseCategories.find((c) => c.name.startsWith('Other')) ??
      expenseCategories[0]
    if (!category) return unrecognized

    const defaultAccount = ctx.accounts.find((a) => a.id === ctx.defaultAccountId) ?? ctx.accounts[0]
    const resolvedAccount = account ?? defaultAccount
    if (!resolvedAccount) return unrecognized

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

    const category = findByAlias(cleaned, 'category', aliases, expenseCategories) ??
      findByLexicon(cleaned, expenseCategories) ??
      fuzzyFind(cleaned, expenseCategories)
    if (!category) return unrecognized

    return {
      type: 'setBudget',
      amount,
      categoryId: category.id,
      date,
      raw,
      summary: `Set ${category.name} budget to ₱${amount.toLocaleString()}/month`,
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
    const fromAccount = resolveAccount(fromText, ctx.accounts, aliases)
    const toAccount = resolveAccount(toText, ctx.accounts, aliases)
    if (amount && fromAccount && toAccount && fromAccount.id !== toAccount.id) {
      return {
        type: 'transfer',
        amount,
        fromAccountId: fromAccount.id,
        toAccountId: toAccount.id,
        date,
        raw,
        summary: `Transfer ₱${amount.toLocaleString()} from ${fromAccount.name} to ${toAccount.name}`,
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
      const existingAccount = resolveAccount(name, ctx.accounts, aliases)
      if (existingAccount) {
        if (amount) {
          return {
            type: 'addBalance',
            amount,
            accountId: existingAccount.id,
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

    const { account, accountPhrase, categoryPhrase } = splitAccountAndCategoryText(
      cleaned,
      ctx.accounts,
      aliases,
    )

    const category = categoryPhrase
      ? findByAlias(categoryPhrase, 'category', aliases, categories) ??
        findByLexicon(categoryPhrase, categories) ??
        fuzzyFind(categoryPhrase, categories)
      : undefined

    const defaultAccount = ctx.accounts.find((a) => a.id === ctx.defaultAccountId) ?? ctx.accounts[0]
    const resolvedAccount = account ?? defaultAccount
    if (!resolvedAccount) return unrecognized

    // A matched category wins outright. Otherwise fall back to the general
    // bucket, but keep the specific word you typed (e.g. "jeep") as the
    // transaction's note so you can still tell entries apart later.
    const resolvedCategory = category ?? categories.find((c) => c.name.startsWith('Other')) ?? categories[0]
    if (!resolvedCategory) return unrecognized

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
      summary: `${kind === 'expense' ? 'Expense' : 'Income'} ₱${amount.toLocaleString()} · ${categoryLabel} · ${resolvedAccount.name}`,
    }
  }

  return unrecognized
}

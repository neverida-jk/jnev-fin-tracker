import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import db, {
  addCategory,
  addCommandAliasManually,
  archiveCategory,
  deleteCategory,
  deleteCommandAlias,
  getOrCreateBalanceAdjustmentCategory,
  unarchiveCategory,
  updateCategory,
  updateInvestedValue,
} from './db'

async function clearAllTables() {
  await db.transaction('rw', db.tables, async () => {
    for (const table of db.tables) {
      await table.clear()
    }
  })
}

beforeEach(async () => {
  await clearAllTables()
})

afterEach(async () => {
  await clearAllTables()
})

describe('addCategory', () => {
  it('creates a category with the given name, kind, and color', async () => {
    const id = await addCategory({ name: 'Groceries', kind: 'expense', color: '#f97316' })
    const category = await db.categories.get(id)
    expect(category).toMatchObject({ name: 'Groceries', kind: 'expense', color: '#f97316' })
  })

  it('trims surrounding whitespace from the name', async () => {
    const id = await addCategory({ name: '  Dining  ', kind: 'expense', color: '#ec4899' })
    const category = await db.categories.get(id)
    expect(category?.name).toBe('Dining')
  })

  it('rejects a blank name', async () => {
    await expect(addCategory({ name: '', kind: 'expense', color: '#000' })).rejects.toThrow(
      'Category name cannot be empty.',
    )
  })

  it('rejects a whitespace-only name', async () => {
    await expect(addCategory({ name: '   ', kind: 'expense', color: '#000' })).rejects.toThrow(
      'Category name cannot be empty.',
    )
  })

  it('rejects a duplicate name+kind combo, case-insensitively', async () => {
    await addCategory({ name: 'Groceries', kind: 'expense', color: '#f97316' })
    await expect(addCategory({ name: 'groceries', kind: 'expense', color: '#111111' })).rejects.toThrow(
      'A expense category named "groceries" already exists.',
    )
  })

  it('allows the same name across different kinds', async () => {
    await addCategory({ name: 'Other', kind: 'expense', color: '#64748b' })
    const incomeId = await addCategory({ name: 'Other', kind: 'income', color: '#84cc16' })
    const category = await db.categories.get(incomeId)
    expect(category?.name).toBe('Other')
  })
})

describe('updateCategory', () => {
  it('renames and recolors an existing category', async () => {
    const id = await addCategory({ name: 'Groceries', kind: 'expense', color: '#f97316' })
    await updateCategory(id, { name: 'Food & Groceries', color: '#ff0000' })
    const category = await db.categories.get(id)
    expect(category).toMatchObject({ name: 'Food & Groceries', color: '#ff0000' })
  })

  it('trims the new name and rejects a blank one', async () => {
    const id = await addCategory({ name: 'Groceries', kind: 'expense', color: '#f97316' })
    await updateCategory(id, { name: '  Food  ' })
    expect((await db.categories.get(id))?.name).toBe('Food')

    await expect(updateCategory(id, { name: '   ' })).rejects.toThrow('Category name cannot be empty.')
  })

  it('leaves fields not included in the patch untouched', async () => {
    const id = await addCategory({ name: 'Groceries', kind: 'expense', color: '#f97316' })
    await updateCategory(id, { color: '#00ff00' })
    const category = await db.categories.get(id)
    expect(category?.name).toBe('Groceries')
    expect(category?.color).toBe('#00ff00')
  })

  it('refuses to rename or recolor a system category', async () => {
    const systemCategory = await getOrCreateBalanceAdjustmentCategory()
    await expect(updateCategory(systemCategory.id, { name: 'Hacked' })).rejects.toThrow(
      'System categories cannot be renamed or recolored.',
    )
    const unchanged = await db.categories.get(systemCategory.id)
    expect(unchanged?.name).toBe('Balance Adjustment')
  })

  it('throws when the category does not exist', async () => {
    await expect(updateCategory(9999, { name: 'Ghost' })).rejects.toThrow('Category not found.')
  })
})

describe('updateInvestedValue', () => {
  async function addAccount(type: 'investment' | 'checking' = 'investment'): Promise<number> {
    return db.accounts.add({
      id: undefined as unknown as number,
      name: 'GoTrade',
      type,
      startingBalance: 0,
      createdAt: '',
    })
  }

  it('records the value and today as the update date', async () => {
    const id = await addAccount()
    await updateInvestedValue(id, 6500, new Date(2026, 6, 20))
    const account = await db.accounts.get(id)
    expect(account?.investedValue).toBe(6500)
    expect(account?.investedValueUpdatedAt).toBe('2026-07-20')
  })

  it('overwrites a previous value on a later update', async () => {
    const id = await addAccount()
    await updateInvestedValue(id, 6500, new Date(2026, 6, 20))
    await updateInvestedValue(id, 7200, new Date(2026, 6, 27))
    const account = await db.accounts.get(id)
    expect(account?.investedValue).toBe(7200)
    expect(account?.investedValueUpdatedAt).toBe('2026-07-27')
  })

  it('refuses a negative value', async () => {
    const id = await addAccount()
    await expect(updateInvestedValue(id, -100)).rejects.toThrow('Enter a valid, non-negative value.')
  })

  it('refuses a non-investment account', async () => {
    const id = await addAccount('checking')
    await expect(updateInvestedValue(id, 100)).rejects.toThrow('Only investment accounts track a current value.')
  })

  it('throws when the account does not exist', async () => {
    await expect(updateInvestedValue(9999, 100)).rejects.toThrow('Account not found.')
  })
})

describe('archiveCategory / unarchiveCategory', () => {
  it('round-trips a category through archive and unarchive', async () => {
    const id = await addCategory({ name: 'Subscriptions', kind: 'expense', color: '#a855f7' })

    await archiveCategory(id)
    expect((await db.categories.get(id))?.archived).toBe(true)

    await unarchiveCategory(id)
    expect((await db.categories.get(id))?.archived).toBe(false)
  })

  it('refuses to archive a system category', async () => {
    const systemCategory = await getOrCreateBalanceAdjustmentCategory()
    await expect(archiveCategory(systemCategory.id)).rejects.toThrow('System categories cannot be archived.')
    expect((await db.categories.get(systemCategory.id))?.archived).toBeUndefined()
  })

  it('throws when archiving a category that does not exist', async () => {
    await expect(archiveCategory(9999)).rejects.toThrow('Category not found.')
  })
})

describe('deleteCategory', () => {
  it('deletes a category that nothing references', async () => {
    const id = await addCategory({ name: 'Unused', kind: 'expense', color: '#000000' })
    await deleteCategory(id)
    expect(await db.categories.get(id)).toBeUndefined()
  })

  it('refuses to delete a category still referenced by a transaction', async () => {
    const accountId = await db.accounts.add({
      id: undefined as unknown as number,
      name: 'GCash',
      type: 'checking',
      startingBalance: 0,
      createdAt: '',
    })
    const categoryId = await addCategory({ name: 'Groceries', kind: 'expense', color: '#f97316' })
    await db.transactions.add({
      id: undefined as unknown as number,
      accountId,
      categoryId,
      amount: 200,
      date: '2026-07-01',
      note: '',
      createdAt: '2026-07-01T00:00:00.000Z',
    })

    await expect(deleteCategory(categoryId)).rejects.toThrow(
      'This category still has transactions or a budget using it. Archive it instead of deleting.',
    )
    expect(await db.categories.get(categoryId)).toBeDefined()
  })

  it('refuses to delete a category still referenced by a budget', async () => {
    const categoryId = await addCategory({ name: 'Dining', kind: 'expense', color: '#ec4899' })
    await db.budgets.add({
      id: undefined as unknown as number,
      categoryId,
      period: 'monthly',
      limit: 3000,
    })

    await expect(deleteCategory(categoryId)).rejects.toThrow(
      'This category still has transactions or a budget using it. Archive it instead of deleting.',
    )
    expect(await db.categories.get(categoryId)).toBeDefined()
  })

  it('refuses to delete a system category', async () => {
    const systemCategory = await getOrCreateBalanceAdjustmentCategory()
    await expect(deleteCategory(systemCategory.id)).rejects.toThrow('System categories cannot be deleted.')
    expect(await db.categories.get(systemCategory.id)).toBeDefined()
  })

  it('throws when the category does not exist', async () => {
    await expect(deleteCategory(9999)).rejects.toThrow('Category not found.')
  })
})

describe('addCommandAliasManually', () => {
  it('creates a new normalized alias and returns its id', async () => {
    const id = await addCommandAliasManually('  My WALLET  ', 'account', 1)
    const alias = await db.commandAliases.get(id)
    expect(alias).toMatchObject({ phrase: 'my wallet', entityType: 'account', entityId: 1 })
  })

  it('rejects a blank phrase', async () => {
    await expect(addCommandAliasManually('   ', 'account', 1)).rejects.toThrow('Phrase cannot be empty.')
    expect(await db.commandAliases.count()).toBe(0)
  })

  it('overwrites the entityId when the same phrase+entityType already exists, returning the existing id', async () => {
    const firstId = await addCommandAliasManually('groceries', 'category', 10)
    const secondId = await addCommandAliasManually('Groceries', 'category', 20)

    expect(secondId).toBe(firstId)
    expect(await db.commandAliases.count()).toBe(1)
    const alias = await db.commandAliases.get(firstId)
    expect(alias?.entityId).toBe(20)
  })

  it('treats the same phrase as distinct aliases when entityType differs', async () => {
    const accountId = await addCommandAliasManually('cash', 'account', 1)
    const categoryId = await addCommandAliasManually('cash', 'category', 2)

    expect(accountId).not.toBe(categoryId)
    expect(await db.commandAliases.count()).toBe(2)
  })
})

describe('deleteCommandAlias', () => {
  it('deletes an existing alias', async () => {
    const id = await addCommandAliasManually('wallet', 'account', 1)
    await deleteCommandAlias(id)
    expect(await db.commandAliases.get(id)).toBeUndefined()
  })

  it('throws when the alias does not exist', async () => {
    await expect(deleteCommandAlias(9999)).rejects.toThrow('Command alias not found.')
  })
})

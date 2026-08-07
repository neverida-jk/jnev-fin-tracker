import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PayoutDate, PayoutSchedule, RecurringBill } from '../db'
import {
  checkAndNotify,
  getNotificationPermission,
  isNotificationSupported,
  requestNotificationPermission,
} from './notifications'

// Mirrors aiEngine.test.ts's approach: this module reads Notification,
// navigator.serviceWorker, and localStorage straight off globalThis, none of
// which exist under vitest's node environment by default — every test
// installs/removes exactly the shape it needs.

function installLocalStorageMock(): Map<string, string> {
  const store = new Map<string, string>()
  const mock = {
    getItem: (key: string) => (store.has(key) ? (store.get(key) as string) : null),
    setItem: (key: string, value: string) => {
      store.set(key, String(value))
    },
    removeItem: (key: string) => {
      store.delete(key)
    },
    clear: () => {
      store.clear()
    },
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    get length() {
      return store.size
    },
  }
  ;(globalThis as Record<string, unknown>).localStorage = mock
  return store
}

const notificationConstructorMock = vi.fn()

function installNotification(permission: NotificationPermission, requestResult: NotificationPermission = permission) {
  class FakeNotification {
    static permission = permission
    static requestPermission = vi.fn().mockResolvedValue(requestResult)
    constructor(title: string, options?: NotificationOptions) {
      notificationConstructorMock(title, options)
    }
  }
  ;(globalThis as Record<string, unknown>).Notification = FakeNotification
  return FakeNotification
}

const showNotificationMock = vi.fn().mockResolvedValue(undefined)

function installServiceWorker() {
  ;(globalThis as Record<string, unknown>).navigator = {
    serviceWorker: { ready: Promise.resolve({ showNotification: showNotificationMock }) },
  }
}

function bill(overrides: Partial<RecurringBill> = {}): RecurringBill {
  return { id: 1, name: 'Rent', amount: 8000, frequency: 'monthly', dueDay: 15, accountId: 1, categoryId: 1, active: true, ...overrides }
}

function schedule(overrides: Partial<PayoutSchedule> = {}): PayoutSchedule {
  return { id: 1, label: 'Salary', accountId: 1, categoryId: 1, active: true, ...overrides }
}

function payoutDate(overrides: Partial<PayoutDate> = {}): PayoutDate {
  return { id: 1, scheduleId: 1, date: '2026-07-15', ...overrides }
}

beforeEach(() => {
  installLocalStorageMock()
  notificationConstructorMock.mockReset()
  showNotificationMock.mockClear()
})

afterEach(() => {
  delete (globalThis as Record<string, unknown>).localStorage
  delete (globalThis as Record<string, unknown>).Notification
  delete (globalThis as Record<string, unknown>).navigator
})

describe('isNotificationSupported / getNotificationPermission', () => {
  it('reports unsupported when the Notification global does not exist', () => {
    expect(isNotificationSupported()).toBe(false)
    expect(getNotificationPermission()).toBe('unsupported')
  })

  it('reflects the current Notification.permission when supported', () => {
    installNotification('granted')
    expect(isNotificationSupported()).toBe(true)
    expect(getNotificationPermission()).toBe('granted')
  })
})

describe('requestNotificationPermission', () => {
  it('returns unsupported without calling anything when Notification does not exist', async () => {
    expect(await requestNotificationPermission()).toBe('unsupported')
  })

  it('delegates to Notification.requestPermission and returns its result', async () => {
    const Fake = installNotification('default', 'granted')
    expect(await requestNotificationPermission()).toBe('granted')
    expect(Fake.requestPermission).toHaveBeenCalled()
  })
})

describe('checkAndNotify', () => {
  it('does nothing when permission is not granted', async () => {
    installNotification('default')
    installServiceWorker()
    await checkAndNotify([bill({ dueDay: 15 })], [], [], new Date(2026, 6, 15))
    expect(showNotificationMock).not.toHaveBeenCalled()
  })

  it('notifies for a bill due today via the service worker when permission is granted', async () => {
    installNotification('granted')
    installServiceWorker()
    await checkAndNotify([bill({ dueDay: 15 })], [], [], new Date(2026, 6, 15))
    expect(showNotificationMock).toHaveBeenCalledWith('Rent is due soon', expect.objectContaining({ tag: 'bill-1' }))
  })

  it('does not notify for a bill due 5 days from now', async () => {
    installNotification('granted')
    installServiceWorker()
    await checkAndNotify([bill({ dueDay: 20 })], [], [], new Date(2026, 6, 15))
    expect(showNotificationMock).not.toHaveBeenCalled()
  })

  it('notifies for an overdue bill', async () => {
    installNotification('granted')
    installServiceWorker()
    await checkAndNotify([bill({ dueDay: 1 })], [], [], new Date(2026, 6, 15))
    expect(showNotificationMock).toHaveBeenCalledWith('Rent is overdue', expect.objectContaining({ tag: 'bill-1' }))
  })

  it('notifies for a pending payout', async () => {
    installNotification('granted')
    installServiceWorker()
    await checkAndNotify([], [schedule()], [payoutDate({ date: '2026-07-15' })], new Date(2026, 6, 15))
    expect(showNotificationMock).toHaveBeenCalledWith(
      'Salary payout is here',
      expect.objectContaining({ tag: 'payout-1' }),
    )
  })

  it('does not re-notify a second time the same day', async () => {
    installNotification('granted')
    installServiceWorker()
    const today = new Date(2026, 6, 15)
    await checkAndNotify([bill({ dueDay: 15 })], [], [], today)
    showNotificationMock.mockClear()
    await checkAndNotify([bill({ dueDay: 15 })], [], [], today)
    expect(showNotificationMock).not.toHaveBeenCalled()
  })

  it('falls back to the plain Notification constructor when there is no service worker', async () => {
    installNotification('granted')
    await checkAndNotify([bill({ dueDay: 15 })], [], [], new Date(2026, 6, 15))
    expect(notificationConstructorMock).toHaveBeenCalledWith(
      'Rent is due soon',
      expect.objectContaining({ tag: 'bill-1' }),
    )
  })
})

import { Landmark, PiggyBank, CreditCard, Wallet, TrendingUp, Smartphone } from 'lucide-react'
import type { AccountType } from '../db'

export const ACCOUNT_TYPES: AccountType[] = [
  'ewallet',
  'checking',
  'savings',
  'credit',
  'cash',
  'investment',
]

export const ACCOUNT_ICONS: Record<AccountType, typeof Landmark> = {
  ewallet: Smartphone,
  checking: Landmark,
  savings: PiggyBank,
  credit: CreditCard,
  cash: Wallet,
  investment: TrendingUp,
}

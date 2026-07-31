// A small offline "mini classifier": common Philippine-context words grouped
// by the category they usually belong to. Checked before exact-name fuzzy
// matching so a never-typed-before word from a familiar word-family (e.g.
// "tricycle" or "grab") still lands in the right bucket, instead of only
// working for words you've typed and corrected before. Words with no home
// here still fall through to the general "Other" bucket as a note.
export const CATEGORY_KEYWORDS: Record<string, string[]> = {
  Transport: [
    'jeep', 'jeepney', 'tricycle', 'trike', 'traysikel', 'grab', 'angkas', 'uber', 'taxi',
    'fare', 'pamasahe', 'gas', 'gasoline', 'toll', 'parking', 'mrt', 'lrt', 'bus', 'motor',
    'habal', 'habalhabal', 'padyak', 'byahe',
  ],
  Groceries: [
    'grocery', 'groceries', 'palengke', 'market', 'tinda', 'rice', 'bigas', 'ulam',
    'sarisari', 'suki', 'puregold', 'robinsons', 'gaisano', 'supermarket',
  ],
  Dining: [
    'restaurant', 'kainan', 'jollibee', 'mcdo', 'mcdonalds', 'kfc', 'chowking', 'milktea',
    'coffee', 'starbucks', 'lunch', 'dinner', 'breakfast', 'merienda', 'takeout', 'delivery',
    'foodpanda', 'grabfood', 'kain', 'eat', 'eating', 'dine', 'dineout', 'diningout',
  ],
  Utilities: [
    'kuryente', 'meralco', 'electric', 'electricity', 'water', 'maynilad', 'wifi', 'pldt',
    'globe', 'load', 'prepaid', 'postpaid', 'internet', 'bill', 'converge',
  ],
  Subscriptions: [
    'netflix', 'spotify', 'disney', 'hbo', 'viu', 'iwant', 'youtube',
  ],
  Rent: [
    'rent', 'apartment', 'boarding', 'bedspace', 'dorm', 'renta', 'upa',
  ],
  'Other Income': [
    'freelance', 'bonus', '13th', 'allowance', 'gift', 'reimbursement', 'refund',
  ],
}

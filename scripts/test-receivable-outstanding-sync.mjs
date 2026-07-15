import fs from 'node:fs';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const migration = fs.readFileSync(
  `${root}/database/migrations/202607120010_sync_receivable_outstanding_from_transactions.sql`,
  'utf8',
);
const payDialog = fs.readFileSync(
  `${root}/src/components/PayReceivableDialog.tsx`,
  'utf8',
);
const customersHook = fs.readFileSync(
  `${root}/src/hooks/useCustomers.ts`,
  'utf8',
);
const receivablesTable = fs.readFileSync(
  `${root}/src/components/ReceivablesTable.tsx`,
  'utf8',
);

assert.match(migration, /AFTER INSERT OR UPDATE OF paid_amount, payment_status, total/);
assert.match(migration, /INSERT INTO public\.receivables/);
assert.match(migration, /UPDATE public\.receivables/);
assert.match(migration, /paid_amount = LEAST\(COALESCE\(NEW\.paid_amount, 0\), COALESCE\(NEW\.total, 0\)\)/);
assert.match(migration, /WHEN COALESCE\(NEW\.paid_amount, 0\) >= COALESCE\(NEW\.total, 0\) THEN 'paid'/);
assert.match(migration, /WHEN COALESCE\(NEW\.paid_amount, 0\) > 0 THEN 'partial'/);
assert.match(migration, /WHERE transaction_id = NEW\.id/);
assert.match(payDialog, /queryClient\.invalidateQueries\(\{ queryKey: \['customers'\] \}\)/);
assert.doesNotMatch(customersHook, /\.from\('receivables'\)/);
assert.match(customersHook, /\.eq\('branch_id', currentBranch\?\.id\)/);
assert.match(customersHook, /const outstandingAmount = Math\.max\(0, totalAmount - paidAmount\)/);
assert.match(customersHook, /if \(outstandingAmount <= 0 \|\| transaction\.is_voided \|\| transaction\.is_cancelled\) continue/);
assert.match(receivablesTable, /\(Number\(t\.total\) \|\| 0\) > \(Number\(t\.paidAmount\) \|\| 0\)/);
assert.doesNotMatch(receivablesTable, /t\.paymentStatus === 'Belum Lunas' \|\| t\.paymentStatus === 'Partial'/);

console.log('receivable outstanding sync regression: PASS');

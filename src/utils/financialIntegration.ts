// financialIntegration.ts
//
// ⚠️ CATATAN ARSITEKTUR (2026-04):
// Fungsi-fungsi createCommissionExpense, deleteCommissionExpense,
// deleteTransactionCommissionExpenses, updateCommissionExpense,
// dan syncCommissionsToExpenses telah DIHAPUS.
//
// ALASAN:
// Komisi (commission_entries) adalah alat pantau/pelaporan saja — bukan beban keuangan.
// Beban gaji (termasuk komponen komisi) dicatat secara resmi saat payroll diproses
// via payroll_records → create_payroll_journal RPC → journal_entries.
// Menyimpan komisi ke tabel expenses mengakibatkan double-counting dengan payroll.
//
// File ini sengaja dikosongkan dan dipertahankan agar tidak ada import error.
// Jika di masa depan ada kebutuhan integrasi keuangan lain (bukan komisi),
// tambahkan di sini.

export {};
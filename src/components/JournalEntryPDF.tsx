import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { JournalEntry } from '@/types/journal';
import { format } from 'date-fns';
import { id } from 'date-fns/locale/id';

const formatCurrency = (amount: number) => {
  return new Intl.NumberFormat('id-ID', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
};

/**
 * Generate PDF for a single journal entry (Bukti Jurnal)
 */
export const generateSingleJournalPDF = (
  entry: JournalEntry,
  companyName: string = 'PT AQUVIT MANUFACTURE'
) => {
  const doc = new jsPDF('p', 'mm', 'a4');
  const pageWidth = doc.internal.pageSize.getWidth();
  let yPos = 15;

  // Header
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text(companyName, pageWidth / 2, yPos, { align: 'center' });

  yPos += 7;
  doc.setFontSize(12);
  doc.text('BUKTI JURNAL', pageWidth / 2, yPos, { align: 'center' });

  yPos += 5;
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.text('(Journal Voucher)', pageWidth / 2, yPos, { align: 'center' });

  // Line separator
  yPos += 5;
  doc.setLineWidth(0.5);
  doc.line(14, yPos, pageWidth - 14, yPos);

  yPos += 8;

  // Entry Info - Two columns
  doc.setFontSize(10);

  // Left column
  doc.setFont('helvetica', 'bold');
  doc.text('No. Jurnal:', 14, yPos);
  doc.setFont('helvetica', 'normal');
  doc.text(entry.entryNumber, 50, yPos);

  // Right column - Tanggal dan Jam
  doc.setFont('helvetica', 'bold');
  doc.text('Tanggal:', pageWidth / 2 + 10, yPos);
  doc.setFont('helvetica', 'normal');
  doc.text(`${format(entry.entryDate, 'd MMMM yyyy', { locale: id })} - ${format(entry.createdAt, 'HH:mm', { locale: id })}`, pageWidth / 2 + 35, yPos);

  yPos += 6;

  // Status
  doc.setFont('helvetica', 'bold');
  doc.text('Status:', 14, yPos);
  doc.setFont('helvetica', 'normal');
  const statusText = entry.isVoided ? 'VOID (Dibatalkan)' : entry.status === 'posted' ? 'POSTED' : 'DRAFT';
  doc.text(statusText, 50, yPos);

  // Reference Type
  if (entry.referenceType) {
    doc.setFont('helvetica', 'bold');
    doc.text('Tipe:', pageWidth / 2 + 10, yPos);
    doc.setFont('helvetica', 'normal');
    const typeLabels: Record<string, string> = {
      'manual': 'Manual',
      'transaction': 'Transaksi Penjualan',
      'expense': 'Pengeluaran',
      'payroll': 'Pembayaran Gaji',
      'transfer': 'Transfer',
      'adjustment': 'Penyesuaian',
      'closing': 'Penutup',
      'opening': 'Pembukaan',
    };
    doc.text(typeLabels[entry.referenceType] || entry.referenceType, pageWidth / 2 + 35, yPos);
  }

  yPos += 6;

  // Description
  doc.setFont('helvetica', 'bold');
  doc.text('Keterangan:', 14, yPos);
  yPos += 5;
  doc.setFont('helvetica', 'normal');

  // Handle long descriptions
  const descLines = doc.splitTextToSize(entry.description || '-', pageWidth - 28);
  doc.text(descLines, 14, yPos);
  yPos += descLines.length * 5 + 5;

  // Journal Lines Table
  const tableData = entry.lines.map((line, index) => [
    (index + 1).toString(),
    line.accountCode || '',
    line.accountName || '',
    line.description || '',
    line.debitAmount > 0 ? formatCurrency(line.debitAmount) : '',
    line.creditAmount > 0 ? formatCurrency(line.creditAmount) : '',
  ]);

  // Add total row
  tableData.push([
    '',
    '',
    '',
    'TOTAL',
    formatCurrency(entry.totalDebit),
    formatCurrency(entry.totalCredit),
  ]);

  autoTable(doc, {
    startY: yPos,
    head: [['No', 'Kode Akun', 'Nama Akun', 'Keterangan', 'Debit', 'Credit']],
    body: tableData,
    theme: 'grid',
    styles: {
      fontSize: 9,
      cellPadding: 2,
    },
    headStyles: {
      fillColor: [71, 85, 105],
      fontStyle: 'bold',
      halign: 'center',
    },
    columnStyles: {
      0: { cellWidth: 12, halign: 'center' },
      1: { cellWidth: 25, font: 'courier' },
      2: { cellWidth: 45 },
      3: { cellWidth: 40 },
      4: { cellWidth: 30, halign: 'right', font: 'courier' },
      5: { cellWidth: 30, halign: 'right', font: 'courier' },
    },
    didParseCell: function (hookData) {
      // Style total row
      if (hookData.row.index === tableData.length - 1) {
        hookData.cell.styles.fontStyle = 'bold';
        hookData.cell.styles.fillColor = [240, 240, 240];
      }
    },
    margin: { left: 14, right: 14 },
  });

  yPos = (doc as any).lastAutoTable.finalY + 10;

  // Metadata
  doc.setFontSize(8);
  doc.setFont('helvetica', 'italic');
  doc.text(`Dibuat oleh: ${entry.createdByName || '-'}`, 14, yPos);
  doc.text(`Tanggal: ${format(entry.createdAt, 'dd MMM yyyy HH:mm', { locale: id })}`, 14, yPos + 4);

  if (entry.approvedByName) {
    doc.text(`Diposting oleh: ${entry.approvedByName}`, pageWidth / 2, yPos);
    if (entry.approvedAt) {
      doc.text(`Tanggal: ${format(entry.approvedAt, 'dd MMM yyyy HH:mm', { locale: id })}`, pageWidth / 2, yPos + 4);
    }
  }

  if (entry.isVoided) {
    yPos += 10;
    doc.setTextColor(255, 0, 0);
    doc.setFont('helvetica', 'bold');
    doc.text('JURNAL DIBATALKAN (VOID)', pageWidth / 2, yPos, { align: 'center' });
    doc.setFont('helvetica', 'normal');
    doc.text(`Dibatalkan oleh: ${entry.voidedByName || '-'}`, 14, yPos + 5);
    doc.text(`Alasan: ${entry.voidReason || '-'}`, 14, yPos + 9);
    doc.setTextColor(0, 0, 0);
  }

  // Signature section
  yPos = (doc as any).lastAutoTable.finalY + 35;

  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');

  // Three signature boxes
  const signatureWidth = 50;
  const startX = 25;
  const gap = (pageWidth - 50 - signatureWidth * 3) / 2;

  // Dibuat
  doc.text('Dibuat oleh,', startX, yPos);
  doc.line(startX, yPos + 20, startX + signatureWidth, yPos + 20);
  doc.text('(_________________)', startX, yPos + 25);

  // Disetujui
  doc.text('Disetujui oleh,', startX + signatureWidth + gap, yPos);
  doc.line(startX + signatureWidth + gap, yPos + 20, startX + signatureWidth * 2 + gap, yPos + 20);
  doc.text('(_________________)', startX + signatureWidth + gap, yPos + 25);

  // Mengetahui
  doc.text('Mengetahui,', startX + (signatureWidth + gap) * 2, yPos);
  doc.line(startX + (signatureWidth + gap) * 2, yPos + 20, startX + signatureWidth * 3 + gap * 2, yPos + 20);
  doc.text('(_________________)', startX + (signatureWidth + gap) * 2, yPos + 25);

  // Footer
  const pageHeight = doc.internal.pageSize.getHeight();
  doc.setFontSize(7);
  doc.setFont('helvetica', 'italic');
  doc.text(
    `Dicetak pada: ${format(new Date(), 'dd MMM yyyy HH:mm', { locale: id })}`,
    pageWidth / 2,
    pageHeight - 10,
    { align: 'center' }
  );

  return doc;
};

/**
 * Generate PDF for multiple journal entries (Laporan Jurnal)
 */
export const generateJournalReportPDF = (
  entries: JournalEntry[],
  dateFrom?: Date,
  dateTo?: Date,
  companyName: string = 'PT AQUVIT MANUFACTURE'
) => {
  const doc = new jsPDF('l', 'mm', 'a4'); // Landscape
  const pageWidth = doc.internal.pageSize.getWidth();
  let yPos = 15;

  // Header
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text(companyName, pageWidth / 2, yPos, { align: 'center' });

  yPos += 7;
  doc.setFontSize(12);
  doc.text('LAPORAN JURNAL UMUM', pageWidth / 2, yPos, { align: 'center' });

  yPos += 5;
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');

  if (dateFrom && dateTo) {
    const periodText = `Periode: ${format(dateFrom, 'd MMMM yyyy', { locale: id })} s/d ${format(dateTo, 'd MMMM yyyy', { locale: id })}`;
    doc.text(periodText, pageWidth / 2, yPos, { align: 'center' });
  } else {
    doc.text('Semua Periode', pageWidth / 2, yPos, { align: 'center' });
  }

  yPos += 3;
  doc.setFontSize(8);
  doc.text('(Disajikan dalam Rupiah)', pageWidth / 2, yPos, { align: 'center' });

  yPos += 8;

  // Summary
  const totalDebit = entries.reduce((sum, e) => sum + (e.isVoided ? 0 : e.totalDebit), 0);
  const totalCredit = entries.reduce((sum, e) => sum + (e.isVoided ? 0 : e.totalCredit), 0);
  const postedCount = entries.filter(e => e.status === 'posted' && !e.isVoided).length;
  const draftCount = entries.filter(e => e.status === 'draft' && !e.isVoided).length;
  const voidedCount = entries.filter(e => e.isVoided).length;

  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.text('RINGKASAN:', 14, yPos);
  yPos += 5;
  doc.setFont('helvetica', 'normal');
  doc.text(`Total Jurnal: ${entries.length} | Posted: ${postedCount} | Draft: ${draftCount} | Void: ${voidedCount}`, 14, yPos);
  yPos += 4;
  doc.text(`Total Debit: Rp ${formatCurrency(totalDebit)} | Total Credit: Rp ${formatCurrency(totalCredit)}`, 14, yPos);
  yPos += 8;

  // Table data - Flatten entries with their lines
  const tableData: (string | { content: string; styles?: any })[][] = [];

  entries.forEach((entry) => {
    // Entry header row - dengan jam dari createdAt
    tableData.push([
      { content: `${format(entry.entryDate, 'dd/MM/yy', { locale: id })} ${format(entry.createdAt, 'HH:mm', { locale: id })}`, styles: { fontStyle: 'bold' } },
      { content: entry.entryNumber, styles: { fontStyle: 'bold' } },
      { content: entry.description.substring(0, 50) + (entry.description.length > 50 ? '...' : ''), styles: { fontStyle: 'bold' } },
      { content: '', styles: {} },
      { content: '', styles: {} },
      { content: '', styles: {} },
      { content: '', styles: {} },
      {
        content: entry.isVoided ? 'VOID' : entry.status.toUpperCase(),
        styles: {
          fontStyle: 'bold',
          textColor: entry.isVoided ? [255, 0, 0] : entry.status === 'posted' ? [0, 128, 0] : [128, 128, 128]
        }
      },
    ]);

    // Entry lines
    entry.lines.forEach((line) => {
      tableData.push([
        '',
        '',
        `    ${line.accountCode} - ${line.accountName}`,
        line.description || '',
        line.debitAmount > 0 ? formatCurrency(line.debitAmount) : '',
        line.creditAmount > 0 ? formatCurrency(line.creditAmount) : '',
        '',
        '',
      ]);
    });

    // Entry totals
    tableData.push([
      '',
      '',
      '',
      { content: 'Subtotal:', styles: { halign: 'right', fontStyle: 'italic' } },
      { content: formatCurrency(entry.totalDebit), styles: { fontStyle: 'bold' } },
      { content: formatCurrency(entry.totalCredit), styles: { fontStyle: 'bold' } },
      '',
      '',
    ]);
  });

  autoTable(doc, {
    startY: yPos,
    head: [['Tanggal / Jam', 'No. Jurnal', 'Akun / Keterangan', 'Deskripsi', 'Debit', 'Credit', 'Tipe', 'Status']],
    body: tableData,
    theme: 'striped',
    styles: {
      fontSize: 8,
      cellPadding: 1.5,
    },
    headStyles: {
      fillColor: [71, 85, 105],
      fontStyle: 'bold',
      halign: 'center',
      fontSize: 9,
    },
    columnStyles: {
      0: { cellWidth: 32 },  // Lebih lebar untuk tanggal+jam
      1: { cellWidth: 28, font: 'courier' },
      2: { cellWidth: 65 },
      3: { cellWidth: 45 },
      4: { cellWidth: 28, halign: 'right', font: 'courier' },
      5: { cellWidth: 28, halign: 'right', font: 'courier' },
      6: { cellWidth: 25, halign: 'center' },
      7: { cellWidth: 20, halign: 'center' },
    },
    margin: { left: 14, right: 14 },
    didDrawPage: function(data) {
      // Footer on each page
      const pageCount = doc.getNumberOfPages();
      const pageHeight = doc.internal.pageSize.getHeight();
      doc.setFontSize(7);
      doc.setFont('helvetica', 'italic');
      doc.text(
        `Halaman ${data.pageNumber} dari ${pageCount}`,
        pageWidth / 2,
        pageHeight - 8,
        { align: 'center' }
      );
      doc.text(
        `Dicetak pada: ${format(new Date(), 'dd MMM yyyy HH:mm', { locale: id })}`,
        pageWidth - 14,
        pageHeight - 8,
        { align: 'right' }
      );
    },
  });

  // Grand Total
  const finalY = (doc as any).lastAutoTable.finalY + 5;

  autoTable(doc, {
    startY: finalY,
    body: [
      [
        { content: 'GRAND TOTAL', styles: { fontStyle: 'bold', halign: 'right' } },
        { content: `Rp ${formatCurrency(totalDebit)}`, styles: { fontStyle: 'bold', halign: 'right' } },
        { content: `Rp ${formatCurrency(totalCredit)}`, styles: { fontStyle: 'bold', halign: 'right' } },
      ],
    ],
    theme: 'plain',
    styles: {
      fontSize: 10,
      cellPadding: 3,
      fillColor: [230, 240, 250],
    },
    columnStyles: {
      0: { cellWidth: 180 },
      1: { cellWidth: 50 },
      2: { cellWidth: 50 },
    },
    margin: { left: 14, right: 14 },
  });

  return doc;
};

/**
 * Download single journal entry PDF
 */
export const downloadSingleJournalPDF = (entry: JournalEntry, companyName?: string) => {
  const doc = generateSingleJournalPDF(entry, companyName);
  const fileName = `Jurnal_${entry.entryNumber.replace(/\//g, '-')}_${format(entry.entryDate, 'yyyyMMdd')}.pdf`;
  doc.save(fileName);
};

/**
 * Print single journal entry
 */
export const printSingleJournal = (entry: JournalEntry, companyName?: string) => {
  const doc = generateSingleJournalPDF(entry, companyName);
  doc.autoPrint();
  window.open(doc.output('bloburl'), '_blank');
};

/**
 * Download journal report PDF
 */
export const downloadJournalReportPDF = (
  entries: JournalEntry[],
  dateFrom?: Date,
  dateTo?: Date,
  companyName?: string
) => {
  const doc = generateJournalReportPDF(entries, dateFrom, dateTo, companyName);
  const fileName = dateFrom && dateTo
    ? `Laporan_Jurnal_${format(dateFrom, 'yyyyMMdd')}_${format(dateTo, 'yyyyMMdd')}.pdf`
    : `Laporan_Jurnal_${format(new Date(), 'yyyyMMdd')}.pdf`;
  doc.save(fileName);
};

/**
 * Print journal report
 */
export const printJournalReport = (
  entries: JournalEntry[],
  dateFrom?: Date,
  dateTo?: Date,
  companyName?: string
) => {
  const doc = generateJournalReportPDF(entries, dateFrom, dateTo, companyName);
  doc.autoPrint();
  window.open(doc.output('bloburl'), '_blank');
};

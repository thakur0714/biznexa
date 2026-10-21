import type {
  ReportConsultantsResponse,
  ReportCustomersResponse,
  ReportSalesResponse,
  ReportServicesResponse,
  ReportSupportResponse,
} from '@biznexa/types';

/**
 * RFC 4180 CSV cell escaping with formula injection defense.
 * Cells starting with =, +, -, @ are prefixed with ' so spreadsheet programs
 * treat them as plain text instead of executing formulas.
 */
export function escapeCsvCell(val: string | number | null | undefined): string {
  if (val == null) return '""';
  let s = String(val);
  if (/^[=+\-@]/.test(s)) s = `'${s}`;
  return `"${s.replaceAll('"', '""')}"`;
}

type Cell = string | number | null | undefined;

/** One CSV line of escaped cells. */
const row = (cells: Cell[]) => cells.map(escapeCsvCell).join(',');

/** A titled block: its `--- TITLE ---` line, the column headings and one line per record. */
const section = (title: string, header: string[], rows: Cell[][]) => [`--- ${title} ---`, row(header), ...rows.map(row)];

export function generateSalesCsv(data: ReportSalesResponse): string {
  return [
    ...section(
      'SALES REPORT SUMMARY',
      ['Total Revenue (paise)', 'Total Orders', 'Discount Total (paise)', 'Refund Total (paise)'],
      [[data.total.revenue, data.total.orders, data.total.discountTotal, data.total.refundTotal]],
    ),
    '',
    ...section('REVENUE BY MONTH', ['Month', 'Label', 'Orders', 'Revenue (paise)'], data.monthly.map((m) => [m.month, m.label, m.orders, m.revenue])),
    '',
    ...section(
      'REVENUE BY SERVICE',
      ['Service ID', 'Service Name', 'Category Name', 'Orders', 'Revenue (paise)'],
      data.serviceWise.map((s) => [s.serviceId, s.serviceName, s.categoryName, s.orders, s.revenue]),
    ),
    '',
    ...section(
      'REVENUE BY CATEGORY',
      ['Category ID', 'Category Name', 'Orders', 'Revenue (paise)'],
      data.categoryWise.map((c) => [c.categoryId, c.categoryName, c.orders, c.revenue]),
    ),
    '',
    ...section(
      'COUPON IMPACT',
      ['Total Discount Given (paise)', 'Orders With Coupon'],
      [[data.couponImpact.discountGiven, data.couponImpact.ordersWithCoupon]],
    ),
    '',
    row(['Coupon Code', 'Type', 'Orders Count', 'Discount Given (paise)']),
    ...data.couponImpact.coupons.map((cp) => row([cp.code, cp.type, cp.ordersCount, cp.discountGiven])),
  ].join('\r\n');
}

export function generateCustomersCsv(data: ReportCustomersResponse): string {
  return section('CUSTOMERS REPORT', ['Metric', 'Count'], [
    ['Total Customers', data.total],
    ['New Customers in Range', data.newInRange],
    ['Active Customers (90d)', data.activeLast90Days],
  ]).join('\r\n');
}

export function generateServicesCsv(data: ReportServicesResponse): string {
  return [
    ...section(
      'SERVICES REPORT SUMMARY',
      ['Total Orders', 'Total Revenue (paise)', 'Average Turnaround (Days)', 'Total SLA Breaches'],
      [[data.summary.totalOrders, data.summary.totalRevenue, data.summary.avgTurnaroundDays, data.summary.totalSlaBreaches]],
    ),
    '',
    ...section(
      'POPULAR SERVICES',
      ['Service ID', 'Service Name', 'Category Name', 'Orders', 'Revenue (paise)', 'Avg Turnaround (Days)', 'SLA Breaches'],
      data.popularServices.map((s) => [s.serviceId, s.serviceName, s.categoryName, s.orders, s.revenue, s.avgTurnaroundDays ?? 'N/A', s.slaBreaches]),
    ),
    '',
    ...section('APPLICATIONS BY STATUS', ['Status', 'Label', 'Count'], data.applicationsByStatus.map((st) => [st.status, st.label, st.count])),
    '',
    ...section(
      'SLA BREACHES PER SERVICE',
      ['Service ID', 'Service Name', 'Category Name', 'Breach Count'],
      data.slaBreaches.map((b) => [b.serviceId, b.serviceName, b.categoryName, b.breachCount]),
    ),
  ].join('\r\n');
}

export function generateConsultantsCsv(data: ReportConsultantsResponse): string {
  return [
    ...section(
      'CONSULTANTS REPORT SUMMARY',
      ['Total Consultants', 'Active Consultants', 'Bookings Count', 'Booking Revenue (paise)', 'Average Rating'],
      [[data.summary.total, data.summary.active, data.summary.bookingsCount, data.summary.bookingRevenue, data.summary.averageRating]],
    ),
    '',
    ...section('BY VERIFICATION STATUS', ['Status', 'Label', 'Count'], data.byVerificationStatus.map((s) => [s.status, s.label, s.count])),
    '',
    ...section(
      'CONSULTANTS LIST',
      ['Consultant ID', 'Name', 'Slug', 'Category', 'Verification Status', 'Rating', 'Reviews', 'Bookings', 'Booking Revenue (paise)'],
      data.consultants.map((c) => [c.consultantId, c.name, c.slug, c.category, c.verificationStatus, c.rating, c.reviewCount, c.bookingsCount, c.bookingRevenue]),
    ),
  ].join('\r\n');
}

export function generateSupportCsv(data: ReportSupportResponse): string {
  return [
    ...section(
      'SUPPORT REPORT SUMMARY',
      ['Total Tickets', 'Open Tickets', 'Resolved Tickets', 'Avg First Response (hours)', 'Avg Resolution (hours)'],
      [[data.summary.totalTickets, data.summary.openTickets, data.summary.resolvedTickets, data.summary.avgFirstResponseHours, data.summary.avgResolutionHours]],
    ),
    '',
    ...section('TICKETS BY STATUS', ['Status', 'Label', 'Count'], data.byStatus.map((s) => [s.status, s.label, s.count])),
    '',
    ...section(
      'SUPPORT TICKETS',
      ['Ticket Code', 'Subject', 'Status', 'Priority', 'Customer Name', 'Assigned To', 'Created At', 'First Response (h)', 'Resolution (h)'],
      data.recentTickets.map((t) => [
        t.code,
        t.subject,
        t.status,
        t.priority,
        t.customerName,
        t.assignedToName ?? 'Unassigned',
        t.createdAt,
        t.firstResponseHours ?? 'N/A',
        t.resolutionHours ?? 'N/A',
      ]),
    ),
  ].join('\r\n');
}

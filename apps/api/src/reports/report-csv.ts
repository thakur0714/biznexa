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
  return `"${s.replace(/"/g, '""')}"`;
}

export function generateSalesCsv(data: ReportSalesResponse): string {
  const lines: string[] = [];

  // Summary
  lines.push('--- SALES REPORT SUMMARY ---');
  lines.push(
    ['Total Revenue (paise)', 'Total Orders', 'Discount Total (paise)', 'Refund Total (paise)'].map(escapeCsvCell).join(','),
  );
  lines.push(
    [data.total.revenue, data.total.orders, data.total.discountTotal, data.total.refundTotal].map(escapeCsvCell).join(','),
  );
  lines.push('');

  // Monthly
  lines.push('--- REVENUE BY MONTH ---');
  lines.push(['Month', 'Label', 'Orders', 'Revenue (paise)'].map(escapeCsvCell).join(','));
  for (const m of data.monthly) {
    lines.push([m.month, m.label, m.orders, m.revenue].map(escapeCsvCell).join(','));
  }
  lines.push('');

  // Service Wise
  lines.push('--- REVENUE BY SERVICE ---');
  lines.push(['Service ID', 'Service Name', 'Category Name', 'Orders', 'Revenue (paise)'].map(escapeCsvCell).join(','));
  for (const s of data.serviceWise) {
    lines.push([s.serviceId, s.serviceName, s.categoryName, s.orders, s.revenue].map(escapeCsvCell).join(','));
  }
  lines.push('');

  // Category Wise
  lines.push('--- REVENUE BY CATEGORY ---');
  lines.push(['Category ID', 'Category Name', 'Orders', 'Revenue (paise)'].map(escapeCsvCell).join(','));
  for (const c of data.categoryWise) {
    lines.push([c.categoryId, c.categoryName, c.orders, c.revenue].map(escapeCsvCell).join(','));
  }
  lines.push('');

  // Coupon Impact
  lines.push('--- COUPON IMPACT ---');
  lines.push(
    ['Total Discount Given (paise)', 'Orders With Coupon'].map(escapeCsvCell).join(','),
  );
  lines.push(
    [data.couponImpact.discountGiven, data.couponImpact.ordersWithCoupon].map(escapeCsvCell).join(','),
  );
  lines.push('');
  lines.push(['Coupon Code', 'Type', 'Orders Count', 'Discount Given (paise)'].map(escapeCsvCell).join(','));
  for (const cp of data.couponImpact.coupons) {
    lines.push([cp.code, cp.type, cp.ordersCount, cp.discountGiven].map(escapeCsvCell).join(','));
  }

  return lines.join('\r\n');
}

export function generateCustomersCsv(data: ReportCustomersResponse): string {
  const lines: string[] = [];
  lines.push('--- CUSTOMERS REPORT ---');
  lines.push(['Metric', 'Count'].map(escapeCsvCell).join(','));
  lines.push(['Total Customers', data.total].map(escapeCsvCell).join(','));
  lines.push(['New Customers in Range', data.newInRange].map(escapeCsvCell).join(','));
  lines.push(['Active Customers (90d)', data.activeLast90Days].map(escapeCsvCell).join(','));
  return lines.join('\r\n');
}

export function generateServicesCsv(data: ReportServicesResponse): string {
  const lines: string[] = [];

  // Summary
  lines.push('--- SERVICES REPORT SUMMARY ---');
  lines.push(
    ['Total Orders', 'Total Revenue (paise)', 'Average Turnaround (Days)', 'Total SLA Breaches'].map(escapeCsvCell).join(','),
  );
  lines.push(
    [data.summary.totalOrders, data.summary.totalRevenue, data.summary.avgTurnaroundDays, data.summary.totalSlaBreaches].map(escapeCsvCell).join(','),
  );
  lines.push('');

  // Popular Services
  lines.push('--- POPULAR SERVICES ---');
  lines.push(
    ['Service ID', 'Service Name', 'Category Name', 'Orders', 'Revenue (paise)', 'Avg Turnaround (Days)', 'SLA Breaches'].map(escapeCsvCell).join(','),
  );
  for (const s of data.popularServices) {
    lines.push([s.serviceId, s.serviceName, s.categoryName, s.orders, s.revenue, s.avgTurnaroundDays ?? 'N/A', s.slaBreaches].map(escapeCsvCell).join(','));
  }
  lines.push('');

  // Applications by Status
  lines.push('--- APPLICATIONS BY STATUS ---');
  lines.push(['Status', 'Label', 'Count'].map(escapeCsvCell).join(','));
  for (const st of data.applicationsByStatus) {
    lines.push([st.status, st.label, st.count].map(escapeCsvCell).join(','));
  }
  lines.push('');

  // SLA Breaches per Service
  lines.push('--- SLA BREACHES PER SERVICE ---');
  lines.push(['Service ID', 'Service Name', 'Category Name', 'Breach Count'].map(escapeCsvCell).join(','));
  for (const b of data.slaBreaches) {
    lines.push([b.serviceId, b.serviceName, b.categoryName, b.breachCount].map(escapeCsvCell).join(','));
  }

  return lines.join('\r\n');
}

export function generateConsultantsCsv(data: ReportConsultantsResponse): string {
  const lines: string[] = [];

  // Summary
  lines.push('--- CONSULTANTS REPORT SUMMARY ---');
  lines.push(
    ['Total Consultants', 'Active Consultants', 'Bookings Count', 'Booking Revenue (paise)', 'Average Rating'].map(escapeCsvCell).join(','),
  );
  lines.push(
    [data.summary.total, data.summary.active, data.summary.bookingsCount, data.summary.bookingRevenue, data.summary.averageRating].map(escapeCsvCell).join(','),
  );
  lines.push('');

  // By Verification Status
  lines.push('--- BY VERIFICATION STATUS ---');
  lines.push(['Status', 'Label', 'Count'].map(escapeCsvCell).join(','));
  for (const s of data.byVerificationStatus) {
    lines.push([s.status, s.label, s.count].map(escapeCsvCell).join(','));
  }
  lines.push('');

  // Consultants detail
  lines.push('--- CONSULTANTS LIST ---');
  lines.push(
    ['Consultant ID', 'Name', 'Slug', 'Category', 'Verification Status', 'Rating', 'Reviews', 'Bookings', 'Booking Revenue (paise)'].map(escapeCsvCell).join(','),
  );
  for (const c of data.consultants) {
    lines.push([
      c.consultantId,
      c.name,
      c.slug,
      c.category,
      c.verificationStatus,
      c.rating,
      c.reviewCount,
      c.bookingsCount,
      c.bookingRevenue,
    ].map(escapeCsvCell).join(','));
  }

  return lines.join('\r\n');
}

export function generateSupportCsv(data: ReportSupportResponse): string {
  const lines: string[] = [];

  // Summary
  lines.push('--- SUPPORT REPORT SUMMARY ---');
  lines.push(
    ['Total Tickets', 'Open Tickets', 'Resolved Tickets', 'Avg First Response (hours)', 'Avg Resolution (hours)'].map(escapeCsvCell).join(','),
  );
  lines.push(
    [data.summary.totalTickets, data.summary.openTickets, data.summary.resolvedTickets, data.summary.avgFirstResponseHours, data.summary.avgResolutionHours].map(escapeCsvCell).join(','),
  );
  lines.push('');

  // By Status
  lines.push('--- TICKETS BY STATUS ---');
  lines.push(['Status', 'Label', 'Count'].map(escapeCsvCell).join(','));
  for (const s of data.byStatus) {
    lines.push([s.status, s.label, s.count].map(escapeCsvCell).join(','));
  }
  lines.push('');

  // Tickets
  lines.push('--- SUPPORT TICKETS ---');
  lines.push(
    ['Ticket Code', 'Subject', 'Status', 'Priority', 'Customer Name', 'Assigned To', 'Created At', 'First Response (h)', 'Resolution (h)'].map(escapeCsvCell).join(','),
  );
  for (const t of data.recentTickets) {
    lines.push([
      t.code,
      t.subject,
      t.status,
      t.priority,
      t.customerName,
      t.assignedToName ?? 'Unassigned',
      t.createdAt,
      t.firstResponseHours ?? 'N/A',
      t.resolutionHours ?? 'N/A',
    ].map(escapeCsvCell).join(','));
  }

  return lines.join('\r\n');
}

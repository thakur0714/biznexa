import {
  escapeCsvCell,
  generateConsultantsCsv,
  generateCustomersCsv,
  generateSalesCsv,
  generateServicesCsv,
  generateSupportCsv,
} from './report-csv';

describe('escapeCsvCell formula injection defense and RFC 4180 escaping', () => {
  it('escapes cells starting with =, +, -, @ by prefixing with a single quote', () => {
    expect(escapeCsvCell('=1+1')).toBe(`"'=1+1"`);
    expect(escapeCsvCell('+919999999999')).toBe(`"'+919999999999"`);
    expect(escapeCsvCell('-100')).toBe(`"'-100"`);
    expect(escapeCsvCell('@SUM(A1:A10)')).toBe(`"'@SUM(A1:A10)"`);
    expect(escapeCsvCell('=cmd|\' /C calc\'!A0')).toBe(`"'=cmd|' /C calc'!A0"`);
  });

  it('handles null, undefined and normal values', () => {
    expect(escapeCsvCell(null)).toBe('""');
    expect(escapeCsvCell(undefined)).toBe('""');
    expect(escapeCsvCell('Normal Text')).toBe('"Normal Text"');
    expect(escapeCsvCell('Text with "quotes"')).toBe('"Text with ""quotes"""');
    expect(escapeCsvCell(12345)).toBe('"12345"');
  });

  it('generates sales CSV with expected sections and values', () => {
    const csv = generateSalesCsv({
      range: { from: '2026-10-01T00:00:00.000Z', to: '2026-10-17T00:00:00.000Z' },
      total: { revenue: 500000, orders: 5, discountTotal: 25000, refundTotal: 0 },
      monthly: [{ month: '2026-10', label: 'Oct 2026', orders: 5, revenue: 500000 }],
      serviceWise: [{ serviceId: 's1', serviceName: 'GST Registration', categoryName: 'Tax', orders: 5, revenue: 500000 }],
      categoryWise: [{ categoryId: 'c1', categoryName: 'Tax', orders: 5, revenue: 500000 }],
      couponImpact: {
        discountGiven: 25000,
        ordersWithCoupon: 2,
        coupons: [{ code: 'SAVE10', type: 'PERCENTAGE', ordersCount: 2, discountGiven: 25000 }],
      },
    });

    expect(csv).toContain('--- SALES REPORT SUMMARY ---');
    expect(csv).toContain('"500000"');
    expect(csv).toContain('"GST Registration"');
    expect(csv).toContain('"SAVE10"');
  });

  it('generates customers CSV', () => {
    const csv = generateCustomersCsv({
      range: { from: '2026-10-01T00:00:00.000Z', to: '2026-10-17T00:00:00.000Z' },
      total: 150,
      newInRange: 20,
      activeLast90Days: 45,
    });
    expect(csv).toContain('--- CUSTOMERS REPORT ---');
    expect(csv).toContain('"150"');
    expect(csv).toContain('"20"');
    expect(csv).toContain('"45"');
  });

  it('generates services CSV', () => {
    const csv = generateServicesCsv({
      range: { from: '2026-10-01T00:00:00.000Z', to: '2026-10-17T00:00:00.000Z' },
      summary: { totalOrders: 10, totalRevenue: 1000000, avgTurnaroundDays: 2.5, totalSlaBreaches: 1 },
      popularServices: [{ serviceId: 's1', serviceName: 'Pvt Ltd Inc', categoryName: 'Corporate', orders: 10, revenue: 1000000, avgTurnaroundDays: 2.5, slaBreaches: 1 }],
      applicationsByStatus: [{ status: 'COMPLETED', label: 'Completed', count: 10 }],
      slaBreaches: [{ serviceId: 's1', serviceName: 'Pvt Ltd Inc', categoryName: 'Corporate', breachCount: 1 }],
    });
    expect(csv).toContain('--- SERVICES REPORT SUMMARY ---');
    expect(csv).toContain('"Pvt Ltd Inc"');
    expect(csv).toContain('"2.5"');
  });

  it('generates consultants CSV', () => {
    const csv = generateConsultantsCsv({
      range: { from: '2026-10-01T00:00:00.000Z', to: '2026-10-17T00:00:00.000Z' },
      summary: { total: 5, active: 4, bookingsCount: 12, bookingRevenue: 60000, averageRating: 4.8 },
      byVerificationStatus: [{ status: 'APPROVED', label: 'Approved', count: 4 }],
      consultants: [{
        consultantId: 'c1',
        name: 'Dr. John Doe',
        slug: 'john-doe',
        category: 'CA',
        verificationStatus: 'APPROVED',
        rating: 4.8,
        reviewCount: 10,
        bookingsCount: 12,
        bookingRevenue: 60000,
      }],
    });
    expect(csv).toContain('--- CONSULTANTS REPORT SUMMARY ---');
    expect(csv).toContain('"Dr. John Doe"');
    expect(csv).toContain('"60000"');
  });

  it('generates support CSV and protects against formula injection in subjects', () => {
    const csv = generateSupportCsv({
      range: { from: '2026-10-01T00:00:00.000Z', to: '2026-10-17T00:00:00.000Z' },
      summary: { totalTickets: 1, openTickets: 0, resolvedTickets: 1, avgFirstResponseHours: 1.0, avgResolutionHours: 2.0 },
      byStatus: [{ status: 'RESOLVED', label: 'Resolved', count: 1 }],
      recentTickets: [{
        id: 't1',
        code: 'TICK-101',
        subject: '=1+1 dangerous formula',
        status: 'RESOLVED',
        priority: 'HIGH',
        customerName: '+919999999999',
        assignedToName: null,
        createdAt: '2026-10-17T10:00:00.000Z',
        firstResponseAt: '2026-10-17T11:00:00.000Z',
        resolvedAt: '2026-10-17T12:00:00.000Z',
        firstResponseHours: 1.0,
        resolutionHours: 2.0,
      }],
    });
    expect(csv).toContain('--- SUPPORT REPORT SUMMARY ---');
    expect(csv).toContain(`"'=1+1 dangerous formula"`);
    expect(csv).toContain(`"'+919999999999"`);
  });
});

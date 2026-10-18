import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { PublicConsultantProfile, PublicConsultantSlots } from '@biznexa/types';
import { ConsultantProfileView } from './profile-view';

const profile: PublicConsultantProfile = {
  id: '11111111-1111-4111-8111-111111111111', slug: 'asha-rao', name: 'Asha Rao', category: 'CA',
  qualification: 'Chartered Accountant', experienceYears: 8, expertise: ['GST', 'Tax'], languages: ['English', 'Hindi'],
  city: 'Pune', state: 'Maharashtra', area: 'Kothrud', bio: 'Practical advice for growing businesses.', photoUrl: null,
  feePerSession: 120000, sessionMinutes: 30, consultationTypes: ['VIDEO', 'AUDIO'], rating: 4.8, reviewCount: 12, isOnline: true, isFeatured: false,
  ratingSummary: { average: 4.8, reviewCount: 12, breakdown: { '1': 0, '2': 0, '3': 1, '4': 2, '5': 9 } },
  services: [{ id: '22222222-2222-4222-8222-222222222222', slug: 'gst-registration', name: 'GST Registration', category: 'Tax' }],
  verifiedReviews: [],
};
const slots: PublicConsultantSlots = {
  consultant: { slug: profile.slug, name: profile.name, category: profile.category, qualification: profile.qualification, feePerSession: profile.feePerSession, sessionMinutes: 30, consultationTypes: ['VIDEO'] },
  timezone: 'Asia/Kolkata', from: '2026-10-18', to: '2026-10-24',
  slots: [{ date: '2026-10-20', time: '10:00', startAt: '2026-10-20T04:30:00.000Z', endAt: '2026-10-20T05:00:00.000Z' }],
};

describe('ConsultantProfileView', () => {
  it('renders consultant details, availability, booking links and Person/ProfessionalService JSON-LD', () => {
    const { container } = render(<ConsultantProfileView profile={profile} slots={slots} />);
    expect(screen.getByRole('heading', { name: 'Asha Rao' })).toBeInTheDocument();
    expect(screen.getByText('GST Registration')).toBeInTheDocument();
    expect(screen.getByText('Next available slots')).toBeInTheDocument();
    expect(screen.getByText(/Tue, 20 Oct, 10:00/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Book a consultation' })).toHaveAttribute('href', '/consultants/asha-rao/book');
    const graph = JSON.parse(container.querySelector('script[type="application/ld+json"]')?.textContent || '{}');
    expect(graph['@graph'].map((entry: { '@type': string }) => entry['@type'])).toEqual(['Person', 'ProfessionalService']);
  });

  it('shows the empty review state and gracefully handles missing slots', () => {
    render(<ConsultantProfileView profile={profile} slots={null} />);
    expect(screen.getByText('No written reviews yet.')).toBeInTheDocument();
    expect(screen.getByText('Availability is temporarily unavailable.')).toBeInTheDocument();
  });
});

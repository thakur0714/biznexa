import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ConsultantCard } from './consultant-card';

const consultant = {
  id: '11111111-1111-4111-8111-111111111111', slug: 'asha-rao', name: 'Asha Rao', category: 'CA' as const,
  qualification: 'Chartered Accountant', city: 'Pune', state: 'Maharashtra', area: 'Kothrud', expertise: ['GST', 'Tax'],
  languages: ['English', 'Hindi'], bio: null, photoUrl: null, feePerSession: 120000, sessionMinutes: 30,
  consultationTypes: ['VIDEO' as const], rating: 4.8, reviewCount: 12, isOnline: true, availableToday: true,
};

describe('ConsultantCard', () => {
  it('shows the professional details and links to their profile', () => {
    render(<ConsultantCard consultant={consultant} />);
    expect(screen.getByRole('heading', { name: 'Asha Rao' })).toBeInTheDocument();
    expect(screen.getByText('Chartered Accountant')).toBeInTheDocument();
    expect(screen.getByText('Pune, Maharashtra')).toBeInTheDocument();
    expect(screen.getByText('Available today')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View profile' })).toHaveAttribute('href', '/consultants/asha-rao');
  });

  it('uses a photo when present and omits the availability badge when unavailable', () => {
    const { container } = render(<ConsultantCard consultant={{ ...consultant, photoUrl: 'https://cdn.example.test/asha.jpg', availableToday: false }} />);
    expect(container.querySelector('img')).toHaveAttribute('src', 'https://cdn.example.test/asha.jpg');
    expect(screen.queryByText('Available today')).not.toBeInTheDocument();
  });
});

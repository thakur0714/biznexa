import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ConsultantCard } from './consultant-card';

const consultant = {
  id: '11111111-1111-4111-8111-111111111111', slug: 'asha-rao', name: 'Asha Rao', category: 'CA' as const,
  qualification: 'Chartered Accountant', experienceYears: 8, city: 'Pune', state: 'Maharashtra', area: 'Kothrud', expertise: ['GST', 'Tax'],
  languages: ['English', 'Hindi'], bio: null, photoUrl: null, feePerSession: 120000, sessionMinutes: 30,
  consultationTypes: ['AUDIO' as const, 'VIDEO' as const], rating: 4.8, reviewCount: 12, isOnline: false, availableToday: true, isFeatured: false,
};

describe('ConsultantCard', () => {
  it('shows the professional details, verified badge and experience', () => {
    render(<ConsultantCard consultant={consultant} />);
    expect(screen.getByRole('heading', { name: 'Asha Rao' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Verified consultant' })).toBeInTheDocument();
    expect(screen.getByText('Chartered Accountant · 8 yrs experience')).toBeInTheDocument();
    expect(screen.getByText('Pune, Maharashtra')).toBeInTheDocument();
    expect(screen.getByText('English, Hindi')).toBeInTheDocument();
    expect(screen.queryByText(/^\+\d+$/)).not.toBeInTheDocument();
    expect(screen.getByText('Audio')).toBeInTheDocument();
    expect(screen.getByText('Video')).toBeInTheDocument();
  });

  it('links to booking and to the profile', () => {
    render(<ConsultantCard consultant={consultant} />);
    expect(screen.getByRole('link', { name: 'Book consultation' })).toHaveAttribute('href', '/consultants/asha-rao/book');
    expect(screen.getByRole('link', { name: 'View profile' })).toHaveAttribute('href', '/consultants/asha-rao');
  });

  it('shows the first three languages and a count of the rest', () => {
    render(<ConsultantCard consultant={{ ...consultant, languages: ['English', 'Hindi', 'Marathi', 'Gujarati', 'Tamil'] }} />);
    expect(screen.getByText(/English, Hindi, Marathi/)).toBeInTheDocument();
    expect(screen.getByText('+2')).toBeInTheDocument();
    expect(screen.queryByText(/Gujarati/)).not.toBeInTheDocument();
  });

  it('shows Online instead of the availability chip when the consultant is online', () => {
    render(<ConsultantCard consultant={{ ...consultant, isOnline: true }} />);
    expect(screen.getByText('Online')).toBeInTheDocument();
    expect(screen.queryByText('Available today')).not.toBeInTheDocument();
  });

  it('shows Available today when offline but bookable today', () => {
    render(<ConsultantCard consultant={consultant} />);
    expect(screen.getByText('Available today')).toBeInTheDocument();
    expect(screen.queryByText('Online')).not.toBeInTheDocument();
  });

  it('uses a photo when present and omits the availability badge when unavailable', () => {
    const { container } = render(<ConsultantCard consultant={{ ...consultant, photoUrl: 'https://cdn.example.test/asha.jpg', availableToday: false }} />);
    expect(container.querySelector('img')).toHaveAttribute('src', 'https://cdn.example.test/asha.jpg');
    expect(screen.queryByText('Available today')).not.toBeInTheDocument();
  });
});

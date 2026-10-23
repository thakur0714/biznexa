import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CategorySeo } from './category-seo';

vi.mock('server-only', () => ({}));

const faqs = [{ question: 'How long does GST registration take?', answer: '<p>Usually 3–7 working days.</p>' }];

function jsonLdScript(container: HTMLElement) {
  return container.querySelector('script[type="application/ld+json"]');
}

describe('CategorySeo', () => {
  it('renders nothing without content or FAQs', () => {
    const { container } = render(<CategorySeo category={{ seoContent: null, faqs: [] }} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the SEO content and the FAQs with FAQPage JSON-LD', () => {
    const { container } = render(<CategorySeo category={{ seoContent: '<h2>About GST services</h2><p>Everything you need.</p>', faqs }} />);
    expect(screen.getByRole('heading', { name: 'About GST services' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Frequently asked questions' })).toBeInTheDocument();
    expect(screen.getByText('How long does GST registration take?')).toBeInTheDocument();
    expect(screen.getByText('Usually 3–7 working days.')).toBeInTheDocument();
    const ld = JSON.parse(jsonLdScript(container)?.innerHTML ?? '{}');
    expect(ld['@type']).toBe('FAQPage');
    expect(ld.mainEntity[0].name).toBe('How long does GST registration take?');
  });

  it('leaves out the JSON-LD and FAQ heading when there are no FAQs', () => {
    const { container } = render(<CategorySeo category={{ seoContent: '<p>Everything you need.</p>', faqs: [] }} />);
    expect(screen.getByText('Everything you need.')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Frequently asked questions' })).not.toBeInTheDocument();
    expect(jsonLdScript(container)).toBeNull();
  });
});

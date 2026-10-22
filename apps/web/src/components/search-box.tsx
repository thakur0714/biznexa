'use client';

import { useRouter } from 'next/navigation';
import { Fragment, useEffect, useId, useRef, useState } from 'react';
import { formatINR, type CatalogueSearchResponse } from '@biznexa/types';
import { Icon } from './icons';

type Results = CatalogueSearchResponse;

/** Service search with live suggestions (combobox pattern, keyboard friendly). */
export function SearchBox({ size = 'lg', autoFocus = false, defaultValue = '' }: Readonly<{ size?: 'lg' | 'md'; autoFocus?: boolean; defaultValue?: string }>) {
  const router = useRouter();
  const listId = useId();
  const [q, setQ] = useState(defaultValue);
  const [results, setResults] = useState<Results | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (autoFocus) {
      inputRef.current?.focus();
    }
  }, [autoFocus]);

  const options = results
    ? [
        ...results.services.map((s) => ({ key: `service:${s.id}`, group: 'Services', href: `/services/${s.category.slug}/${s.slug}`, label: s.name, meta: s.category.name, price: s.startingPrice })),
        ...results.posts.map((p) => ({ key: `post:${p.slug}`, group: 'Articles', href: `/blog/${p.slug}`, label: p.title, meta: p.excerpt ?? 'Article', price: null as number | null })),
        ...results.categories.map((c) => ({ key: `category:${c.slug}`, group: 'Categories', href: `/services/${c.slug}`, label: `All ${c.name} services`, meta: 'Category', price: null as number | null })),
      ]
    : [];

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) return;
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/catalogue/search?q=${encodeURIComponent(term)}`, { signal: ctrl.signal });
        if (res.ok) {
          setResults(await res.json());
          setActive(-1);
          setOpen(true);
        }
      } catch {
        /* typing again cancels the previous request */
      }
    }, 180);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => boxRef.current && !boxRef.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  function submit(e: React.SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    if (active >= 0 && options[active]) return router.push(options[active].href);
    const term = q.trim();
    if (term) router.push(`/services?q=${encodeURIComponent(term)}`);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (!open || !options.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => (a + 1) % options.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => (a <= 0 ? options.length - 1 : a - 1));
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  const big = size === 'lg';
  return (
    <div ref={boxRef} className="relative">
      <form role="search" onSubmit={submit} className={`flex items-center rounded-lg border-2 border-night bg-white shadow-[4px_4px_0_0_#121a45] focus-within:border-ink ${big ? 'h-16' : 'h-12'}`}>
        <Icon name="search" size={big ? 22 : 18} className="ml-4 shrink-0 text-muted" />
        <label htmlFor={`${listId}-input`} className="sr-only">
          What service are you looking for?
        </label>
        <input
          ref={inputRef}
          id={`${listId}-input`}
          role="combobox"
          aria-expanded={open && options.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
          autoComplete="off"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            if (e.target.value.trim().length < 2) setResults(null);
          }}
          onFocus={() => results && setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="What service are you looking for?"
          className={`min-w-0 flex-1 bg-transparent px-3 outline-none placeholder:text-muted ${big ? 'text-lg' : 'text-[15px]'}`}
        />
        <button type="submit" className={`mr-2 shrink-0 rounded-md bg-marigold font-semibold text-night hover:bg-marigold-600 ${big ? 'h-12 px-5' : 'h-9 px-4 text-sm'}`}>
          <span className="hidden sm:inline">Explore services</span>
          <span className="sm:hidden">Search</span>
        </button>
      </form>

      {open && results && (
        <ul id={listId} role="listbox" // NOSONAR: ARIA combobox pattern; a <select> or <datalist> cannot hold links and group headings
          className="absolute inset-x-0 top-[calc(100%+8px)] z-30 max-h-[360px] overflow-auto rounded-lg border border-rule bg-white py-1.5 shadow-[0_20px_40px_-18px_rgba(18,26,69,0.4)]">
          {options.length === 0 && <li className="px-4 py-3 text-sm text-muted">No matching service. Try a simpler word like “GST” or “trademark”, or talk to an expert.</li>}
          {options.map((o, i) => (
            <Fragment key={o.key}>
            {(i === 0 || options[i - 1].group !== o.group) && <li role="presentation" /* NOSONAR: group heading inside the ARIA listbox */ className="px-4 pt-2 text-xs font-semibold uppercase tracking-wide text-muted">{o.group}</li>}
            <li // NOSONAR: ARIA combobox pattern (see the listbox)
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
            >
              <a
                href={o.href}
                onMouseEnter={() => setActive(i)}
                onClick={(e) => {
                  e.preventDefault();
                  router.push(o.href);
                }}
                className={`flex items-center justify-between gap-4 px-4 py-2.5 ${i === active ? 'bg-ink-050' : ''}`}
              >
                <span>
                  <span className="block font-medium text-night">{o.label}</span>
                  <span className="block text-xs text-muted">{o.meta}</span>
                </span>
                {o.price != null && <span className="num shrink-0 text-sm text-muted">from {formatINR(o.price)}</span>}
              </a>
            </li>
            </Fragment>
          ))}
        </ul>
      )}
    </div>
  );
}

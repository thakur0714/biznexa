import 'server-only';
import { sanitizeRichText } from '@biznexa/rich-text';

/**
 * Stored rich text (CMS pages, blog posts) on the website. The HTML is sanitised here with the same
 * allow-list the API used when saving (D60), so even a row written another way cannot inject markup;
 * this is the only place the website sets inner HTML from content. Server-only: the sanitiser never
 * ships to the browser.
 */
export function RichText({ html, className = '' }: { html: string; className?: string }) {
  return <div className={`rich-text ${className}`} dangerouslySetInnerHTML={{ __html: sanitizeRichText(html) }} />;
}

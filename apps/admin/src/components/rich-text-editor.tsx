'use client';

import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import { EditorContent, Extension, useEditor, useEditorState, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import { TableKit } from '@tiptap/extension-table';
import { useApi } from '@biznexa/api-client/react';
import { Button, Checkbox, Dialog, Field, Notice } from '@biznexa/ui';
import { isMediaPath, MEDIA_ACCEPT, MEDIA_MAX_MB, mediaTypeFromName, safeLinkHref, type MediaImage } from '@biznexa/types';

/**
 * Shared rich-text editor for CMS pages, homepage blocks and blog posts (M9.4, D60). Tiptap, limited
 * to what the sanitiser keeps: H2–H4, bold/italic/underline/strike, lists, links, quotes, tables,
 * code and images uploaded to the public media store. The API sanitises again on save.
 *
 * Keyboard: Tab reaches the toolbar once, arrow keys / Home / End move along it; Esc in the text
 * goes back to the toolbar (Tab inside a table moves between cells). Usual shortcuts work
 * (Ctrl/⌘+B, I, U, Z, Shift+Z).
 */
export function RichTextEditor({
  id,
  label,
  value,
  onChange,
  hint,
  error,
  disabled = false,
}: {
  id: string;
  label: string;
  /** HTML; '' for empty. */
  value: string;
  onChange: (html: string) => void;
  hint?: string;
  error?: string;
  disabled?: boolean;
}) {
  const labelId = `${id}-label`;
  const messageId = error ? `${id}-err` : hint ? `${id}-hint` : undefined;
  const toolbarRef = useRef<HTMLDivElement>(null);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);
  const [dialog, setDialog] = useState<'link' | 'image' | null>(null);

  const editor = useEditor({
    immediatelyRender: false,
    editable: !disabled,
    content: value,
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3, 4] },
        link: {
          openOnClick: false,
          autolink: true,
          defaultProtocol: 'https',
          // The sanitiser decides rel; target only when the editor asks for a new tab.
          HTMLAttributes: { rel: null, target: null },
          isAllowedUri: (url) => safeLinkHref(url) !== null,
        },
      }),
      // Pasted or loaded images we do not host are dropped here, as the sanitiser would on save.
      Image.extend({
        parseHTML: () => [{ tag: 'img[src]', getAttrs: (el) => (isMediaPath((el as HTMLElement).getAttribute('src') ?? '') ? null : false) }],
      }).configure({ allowBase64: false }),
      TableKit.configure({ table: { resizable: false } }),
      Extension.create({
        name: 'escapeToToolbar',
        addKeyboardShortcuts: () => ({
          Escape: () => {
            focusToolbar(toolbarRef.current);
            return true;
          },
        }),
      }),
    ],
    editorProps: { attributes: textboxAttributes(id, labelId, messageId, error) },
    onUpdate: ({ editor }) => onChangeRef.current(htmlOf(editor)),
  });

  // Follow `value` when the parent replaces it (e.g. after loading), not on every keystroke.
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const current = htmlOf(editor);
    if (value !== current) editor.commands.setContent(value, { emitUpdate: false });
  }, [editor, value]);

  useEffect(() => {
    editor?.setEditable(!disabled);
  }, [editor, disabled]);

  useEffect(() => {
    if (editor && !editor.isDestroyed) editor.setOptions({ editorProps: { attributes: textboxAttributes(id, labelId, messageId, error) } });
  }, [editor, id, labelId, messageId, error]);

  return (
    <div>
      <span id={labelId} className="mb-1.5 block text-sm font-medium text-night">
        {label}
      </span>
      <div className={`rounded-md border bg-white focus-within:border-ink ${error ? 'border-danger' : 'border-rule'}`}>
        {editor && <Toolbar editor={editor} editorId={id} toolbarRef={toolbarRef} label={label} disabled={disabled} onLink={() => setDialog('link')} onImage={() => setDialog('image')} />}
        <EditorContent editor={editor} />
      </div>
      {error ? (
        <p id={`${id}-err`} className="mt-1.5 text-sm text-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="mt-1.5 text-sm text-muted">
          {hint}
        </p>
      ) : null}
      {editor && dialog === 'link' && <LinkDialog editor={editor} onClose={() => setDialog(null)} />}
      {editor && dialog === 'image' && <ImageDialog editor={editor} onClose={() => setDialog(null)} />}
    </div>
  );
}

/** The editor's HTML without the empty paragraph Tiptap keeps at the end (so text can follow a table or image). */
function htmlOf(editor: Editor): string {
  return editor.isEmpty ? '' : editor.getHTML().replace(/(?:<p><\/p>)+$/, '');
}

function textboxAttributes(id: string, labelId: string, messageId?: string, error?: string): Record<string, string> {
  return {
    id,
    role: 'textbox',
    'aria-multiline': 'true',
    'aria-labelledby': labelId,
    ...(messageId ? { 'aria-describedby': messageId } : {}),
    ...(error ? { 'aria-invalid': 'true' } : {}),
    class: 'rich-text min-h-48 px-4 py-3 outline-none',
  };
}

function focusToolbar(toolbar: HTMLElement | null) {
  const target = toolbar?.querySelector<HTMLButtonElement>('button[tabindex="0"]') ?? toolbar?.querySelector<HTMLButtonElement>('button');
  target?.focus();
}

interface Tool {
  key: string;
  label: string;
  icon: ReactNode;
  run: () => void;
  /** Toggle state for aria-pressed; leave out for plain actions. */
  active?: boolean;
  enabled?: boolean;
}

function Toolbar({
  editor,
  editorId,
  toolbarRef,
  label,
  disabled,
  onLink,
  onImage,
}: {
  editor: Editor;
  editorId: string;
  toolbarRef: React.RefObject<HTMLDivElement | null>;
  label: string;
  disabled: boolean;
  onLink: () => void;
  onImage: () => void;
}) {
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      h2: e.isActive('heading', { level: 2 }),
      h3: e.isActive('heading', { level: 3 }),
      h4: e.isActive('heading', { level: 4 }),
      bold: e.isActive('bold'),
      italic: e.isActive('italic'),
      bulletList: e.isActive('bulletList'),
      orderedList: e.isActive('orderedList'),
      blockquote: e.isActive('blockquote'),
      link: e.isActive('link'),
      table: e.isActive('table'),
      canUndo: e.can().undo(),
      canRedo: e.can().redo(),
    }),
  });
  const chain = () => editor.chain().focus();
  const heading = (level: 2 | 3 | 4) => () => chain().toggleHeading({ level }).run();

  const tools: Tool[] = [
    { key: 'h2', label: 'Heading 2', icon: 'H2', run: heading(2), active: state.h2 },
    { key: 'h3', label: 'Heading 3', icon: 'H3', run: heading(3), active: state.h3 },
    { key: 'h4', label: 'Heading 4', icon: 'H4', run: heading(4), active: state.h4 },
    { key: 'bold', label: 'Bold', icon: <b>B</b>, run: () => chain().toggleBold().run(), active: state.bold },
    { key: 'italic', label: 'Italic', icon: <i className="font-serif">I</i>, run: () => chain().toggleItalic().run(), active: state.italic },
    { key: 'ul', label: 'Bulleted list', icon: <Icon d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01" />, run: () => chain().toggleBulletList().run(), active: state.bulletList },
    { key: 'ol', label: 'Numbered list', icon: <Icon d="M10 6h10M10 12h10M10 18h10M4 5l1.5-1v5M3.5 14.5c.5-1 2.5-1 2.5.5S3.5 17 3.5 19H6" />, run: () => chain().toggleOrderedList().run(), active: state.orderedList },
    { key: 'quote', label: 'Quote', icon: <Icon d="M7 7h4v4c0 3-1.5 5-4 6M15 7h4v4c0 3-1.5 5-4 6" />, run: () => chain().toggleBlockquote().run(), active: state.blockquote },
    { key: 'link', label: state.link ? 'Edit link' : 'Link', icon: <Icon d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />, run: onLink, active: state.link },
    { key: 'table', label: 'Insert table', icon: <Icon d="M4 5h16v14H4zM4 10h16M4 15h16M10 5v14" />, run: () => chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(), enabled: !state.table },
    { key: 'image', label: 'Insert image', icon: <Icon d="M4 5h16v14H4zM4 16l5-5 4 4 2-2 5 5M15 9h.01" />, run: onImage },
    { key: 'undo', label: 'Undo', icon: <Icon d="M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3" />, run: () => chain().undo().run(), enabled: state.canUndo },
    { key: 'redo', label: 'Redo', icon: <Icon d="m15 14 5-5-5-5M20 9H10a6 6 0 0 0 0 12h3" />, run: () => chain().redo().run(), enabled: state.canRedo },
  ];
  const tableTools: Tool[] = state.table
    ? [
        { key: 'row-add', label: 'Add row below', icon: 'Row +', run: () => chain().addRowAfter().run() },
        { key: 'col-add', label: 'Add column right', icon: 'Col +', run: () => chain().addColumnAfter().run() },
        { key: 'row-del', label: 'Delete row', icon: 'Row −', run: () => chain().deleteRow().run() },
        { key: 'col-del', label: 'Delete column', icon: 'Col −', run: () => chain().deleteColumn().run() },
        { key: 'table-del', label: 'Delete table', icon: 'Delete table', run: () => chain().deleteTable().run() },
      ]
    : [];
  const all = [...tools, ...tableTools];

  // Roving tabindex (WAI-ARIA toolbar): one stop in the tab order, arrows move within.
  const [current, setCurrent] = useState(0);
  const index = Math.min(current, all.length - 1);
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const moves: Record<string, number> = { ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: all.length - 1 };
    if (!(e.key in moves)) return;
    e.preventDefault();
    const next = (moves[e.key] + all.length) % all.length;
    setCurrent(next);
    toolbarRef.current?.querySelectorAll<HTMLButtonElement>('button')[next]?.focus();
  }

  const button = (t: Tool, i: number) => (
    <button
      key={t.key}
      type="button"
      tabIndex={i === index ? 0 : -1}
      aria-label={t.label}
      title={t.label}
      aria-pressed={t.active === undefined ? undefined : t.active}
      // aria-disabled, not disabled: the button stays focusable, so the toolbar never drops out of the tab order.
      aria-disabled={disabled || t.enabled === false || undefined}
      onFocus={() => setCurrent(i)}
      onClick={() => !disabled && t.enabled !== false && t.run()}
      className={`inline-flex h-9 min-w-9 items-center justify-center rounded px-2 text-sm text-night transition-colors hover:bg-ink-050 focus-visible:outline-2 focus-visible:outline-ink aria-disabled:opacity-40 ${
        t.active ? 'bg-ink-050 text-ink' : ''
      }`}
    >
      {t.icon}
    </button>
  );

  return (
    <div ref={toolbarRef} role="toolbar" aria-label={`${label} formatting`} aria-controls={editorId} onKeyDown={onKeyDown} className="border-b border-rule p-1">
      <div className="flex flex-wrap gap-0.5">{tools.map(button)}</div>
      {tableTools.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-0.5 border-t border-rule pt-1" aria-label="Table">
          {tableTools.map((t, i) => button(t, tools.length + i))}
        </div>
      )}
    </div>
  );
}

function Icon({ d }: { d: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );
}

function LinkDialog({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  const fieldId = useId();
  const existing = editor.getAttributes('link') as { href?: string; target?: string };
  const [href, setHref] = useState(existing.href ?? '');
  const [newTab, setNewTab] = useState(existing.target === '_blank');
  const [error, setError] = useState<string | undefined>();

  function submit(e: FormEvent) {
    e.preventDefault();
    const safe = safeLinkHref(href);
    if (!safe) return setError('Enter a web address (https://…), an email (mailto:…), a phone (tel:…) or a page path like /about.');
    const link = { href: safe, target: newTab ? '_blank' : null };
    const chain = editor.chain().focus().extendMarkRange('link');
    // With nothing selected, insert the address itself as the link text.
    if (editor.state.selection.empty && !editor.isActive('link')) chain.insertContent({ type: 'text', text: safe, marks: [{ type: 'link', attrs: link }] }).run();
    else chain.setLink(link).run();
    onClose();
  }

  function remove() {
    editor.chain().focus().extendMarkRange('link').unsetLink().run();
    onClose();
  }

  return (
    <Dialog open onClose={onClose} title={existing.href ? 'Edit link' : 'Add link'}>
      <form onSubmit={submit} noValidate className="space-y-4">
        <Field id={fieldId} label="Link address" value={href} onChange={(e) => setHref(e.target.value)} error={error} placeholder="https://example.com or /services" autoFocus />
        <Checkbox id={`${fieldId}-tab`} label="Open in a new tab" checked={newTab} onChange={(e) => setNewTab(e.target.checked)} />
        <div className="flex flex-wrap justify-end gap-2">
          {existing.href && (
            <Button type="button" variant="ghost" onClick={remove}>
              Remove link
            </Button>
          )}
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="ink">
            Save link
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function ImageDialog({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  const api = useApi();
  const fileId = useId();
  const altId = useId();
  const [file, setFile] = useState<File | null>(null);
  const [alt, setAlt] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!file) return setError('Choose an image.');
    if (!mediaTypeFromName(file.name)) return setError('Only JPG, PNG, WebP or GIF images can be used.');
    if (file.size > MEDIA_MAX_MB * 1024 * 1024) return setError(`This image is too large. The limit is ${MEDIA_MAX_MB} MB.`);
    setUploading(true);
    setError(null);
    try {
      const body = new FormData();
      body.append('file', file);
      // Same trick as the document uploads: satisfies the generated multipart type, still sent as FormData.
      const uploadBody = Object.assign(body, { file: file.name });
      const image = await api.call<MediaImage>((client) => client.POST('/api/admin/media/images', { body: uploadBody }));
      editor.chain().focus().setImage({ src: image.url, alt: alt.trim() }).run();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not upload this image.');
      setUploading(false);
    }
  }

  return (
    <Dialog open onClose={() => !uploading && onClose()} title="Insert image" description={`JPG, PNG, WebP or GIF, up to ${MEDIA_MAX_MB} MB. Images are public on the website.`}>
      <form onSubmit={submit} noValidate className="space-y-4">
        {error && <Notice tone="error">{error}</Notice>}
        <div>
          <label htmlFor={fileId} className="mb-1.5 block text-sm font-medium text-night">
            Image
          </label>
          <input id={fileId} type="file" accept={MEDIA_ACCEPT} onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="block w-full text-sm file:mr-3 file:rounded-md file:border file:border-rule file:bg-white file:px-3 file:py-2" />
        </div>
        <Field id={altId} label="Alt text" hint="Describe the image for people who cannot see it. Leave empty if it is only decoration." value={alt} onChange={(e) => setAlt(e.target.value)} maxLength={250} />
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={uploading}>
            Cancel
          </Button>
          <Button type="submit" variant="ink" disabled={uploading}>
            {uploading ? 'Uploading…' : 'Upload and insert'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Editor } from '@tiptap/react';
import { mediaImageSchema } from '@biznexa/types';
import { RichTextEditor } from '@/components/rich-text-editor';

const IMG = '/api/media/ab/0123456789abcdef0123456789abcdef.webp';

const post = vi.fn();
vi.mock('@biznexa/api-client/react', () => ({
  useApi: () => ({
    call: async (fn: (client: { POST: typeof post }) => Promise<{ data: unknown }>) => (await fn({ POST: post })).data,
  }),
}));

// ProseMirror measures the DOM to scroll the selection into view; jsdom has no layout.
beforeAll(() => {
  const rect = { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) };
  Range.prototype.getBoundingClientRect = () => rect as DOMRect;
  Range.prototype.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] }) as unknown as DOMRectList;
  document.elementFromPoint = () => null;
});

let latest = '';

function Harness({ initial = '', error }: Readonly<{ initial?: string; error?: string }>) {
  const [html, setHtml] = useState(initial);
  return (
    <RichTextEditor
      id="body"
      label="Content"
      value={html}
      error={error}
      hint="Shown on the website"
      onChange={(next) => {
        latest = next;
        setHtml(next);
      }}
    />
  );
}

async function setup(initial = '', error?: string) {
  latest = initial;
  render(<Harness initial={initial} error={error} />);
  const textbox = await screen.findByRole('textbox', { name: 'Content' });
  const editor = (textbox as HTMLElement & { editor: Editor }).editor;
  return { textbox, editor };
}

const tool = (name: string) => screen.getByRole('button', { name });

beforeEach(() => {
  post.mockReset();
});

describe('RichTextEditor', () => {
  it('is a labelled textbox with a named toolbar of labelled buttons', async () => {
    const { textbox } = await setup('<p>Hello</p>');
    expect(textbox).toHaveAttribute('aria-multiline', 'true');
    expect(textbox).toHaveAttribute('aria-describedby', 'body-hint');
    expect(screen.getByRole('toolbar', { name: 'Content formatting' })).toBeInTheDocument();
    for (const name of ['Heading 2', 'Heading 3', 'Heading 4', 'Bold', 'Italic', 'Bulleted list', 'Numbered list', 'Quote', 'Link', 'Insert table', 'Insert image', 'Undo', 'Redo']) {
      expect(tool(name)).toBeInTheDocument();
    }
    expect(textbox).toHaveTextContent('Hello');
  });

  it('marks the textbox invalid and points to the error', async () => {
    const { textbox } = await setup('', 'Content is required');
    expect(textbox).toHaveAttribute('aria-invalid', 'true');
    expect(textbox).toHaveAttribute('aria-describedby', 'body-err');
    expect(screen.getByText('Content is required')).toBeInTheDocument();
  });

  it('has one tab stop in the toolbar and moves with arrow keys, Home and End', async () => {
    await setup('<p>x</p>');
    const toolbar = screen.getByRole('toolbar');
    const buttons = Array.from(toolbar.querySelectorAll('button'));
    expect(buttons.filter((b) => b.tabIndex === 0)).toHaveLength(1);

    buttons[0].focus();
    fireEvent.keyDown(toolbar, { key: 'ArrowRight' });
    expect(tool('Heading 3')).toHaveFocus();
    fireEvent.keyDown(toolbar, { key: 'End' });
    expect(tool('Redo')).toHaveFocus();
    fireEvent.keyDown(toolbar, { key: 'ArrowRight' });
    expect(tool('Heading 2')).toHaveFocus();
    fireEvent.keyDown(toolbar, { key: 'ArrowLeft' });
    expect(tool('Redo')).toHaveFocus();
    // Disabled tools stay focusable so the tab stop never disappears.
    expect(tool('Redo')).toHaveAttribute('aria-disabled', 'true');
    expect(tool('Redo').tabIndex).toBe(0);
  });

  it('applies headings, marks, lists and quotes', async () => {
    const { editor } = await setup('<p>Hello world</p>');
    fireEvent.click(tool('Heading 2'));
    expect(latest).toBe('<h2>Hello world</h2>');
    expect(tool('Heading 2')).toHaveAttribute('aria-pressed', 'true');

    act(() => {
      editor.commands.selectAll();
    });
    fireEvent.click(tool('Bold'));
    expect(latest).toBe('<h2><strong>Hello world</strong></h2>');

    const fresh = () => act(() => {
      editor.chain().setContent('<p>Item</p>', { emitUpdate: false }).setTextSelection(2).run();
    });
    fresh();
    fireEvent.click(tool('Bulleted list'));
    expect(latest).toBe('<ul><li><p>Item</p></li></ul>');
    fresh();
    fireEvent.click(tool('Numbered list'));
    expect(latest).toBe('<ol><li><p>Item</p></li></ol>');
    fresh();
    fireEvent.click(tool('Quote'));
    expect(latest).toBe('<blockquote><p>Item</p></blockquote>');
  });

  it('undoes and redoes', async () => {
    await setup('<p>Hello</p>');
    fireEvent.click(tool('Heading 3'));
    expect(latest).toBe('<h3>Hello</h3>');
    fireEvent.click(tool('Undo'));
    expect(latest).toBe('<p>Hello</p>');
    fireEvent.click(tool('Redo'));
    expect(latest).toBe('<h3>Hello</h3>');
  });

  it('inserts a table and shows the table tools inside it', async () => {
    await setup('<p>Intro</p>');
    fireEvent.click(tool('Insert table'));
    expect(latest).toMatch(/<table[^>]*>.*<th[^>]*>.*<\/table>/s);
    expect(tool('Add row below')).toBeInTheDocument();
    const rowsBefore = (latest.match(/<tr>/g) ?? []).length;
    fireEvent.click(tool('Add row below'));
    expect((latest.match(/<tr>/g) ?? []).length).toBe(rowsBefore + 1);
    fireEvent.click(tool('Delete table'));
    expect(latest).not.toMatch(/<table/);
    expect(screen.queryByRole('button', { name: 'Add row below' })).not.toBeInTheDocument();
  });

  it('refuses unsafe link addresses and adds safe ones', async () => {
    const { editor } = await setup('<p>Read our guide</p>');
    act(() => {
      editor.commands.selectAll();
    });
    fireEvent.click(tool('Link'));
    const address = await screen.findByLabelText('Link address');

    fireEvent.change(address, { target: { value: 'javascript:alert(1)' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save link' }));
    expect(await screen.findByText(/Enter a web address/)).toBeInTheDocument();
    expect(latest).toBe('<p>Read our guide</p>');

    fireEvent.change(address, { target: { value: 'example.com/guide' } });
    fireEvent.click(screen.getByLabelText('Open in a new tab'));
    fireEvent.click(screen.getByRole('button', { name: 'Save link' }));
    expect(latest).toBe('<p><a target="_blank" href="https://example.com/guide">Read our guide</a></p>');
  });

  it('removes a link', async () => {
    const { editor } = await setup('<p><a href="/about">About</a></p>');
    act(() => {
      editor.commands.setTextSelection(2);
    });
    fireEvent.click(tool('Edit link'));
    fireEvent.click(await screen.findByRole('button', { name: 'Remove link' }));
    expect(latest).toBe('<p>About</p>');
  });

  it('uploads an image to the media store and inserts it with alt text', async () => {
    post.mockResolvedValue({ data: mediaImageSchema.parse({ url: IMG, mimeType: 'image/webp', sizeBytes: 900, width: 10, height: 10 }) });
    await setup('<p>Before</p>');
    fireEvent.click(tool('Insert image'));
    const input = await screen.findByLabelText('Image');
    fireEvent.change(input, { target: { files: [new File(['x'], 'office.webp', { type: 'image/webp' })] } });
    fireEvent.change(screen.getByLabelText('Alt text'), { target: { value: 'Our office' } });
    fireEvent.click(screen.getByRole('button', { name: 'Upload and insert' }));

    await waitFor(() => expect(latest).toContain(`<img src="${IMG}" alt="Our office">`));
    expect(post).toHaveBeenCalledWith('/api/admin/media/images', expect.objectContaining({ body: expect.any(FormData) }));
    const body = post.mock.calls[0][1].body as FormData;
    expect((body.get('file') as File).name).toBe('office.webp');
  });

  it('checks type and size before uploading, and shows API errors', async () => {
    await setup('<p>x</p>');
    fireEvent.click(tool('Insert image'));
    const input = await screen.findByLabelText('Image');
    const submit = () => fireEvent.click(screen.getByRole('button', { name: 'Upload and insert' }));

    fireEvent.change(input, { target: { files: [new File(['<svg/>'], 'logo.svg', { type: 'image/svg+xml' })] } });
    submit();
    expect(await screen.findByText(/Only JPG, PNG, WebP or GIF/)).toBeInTheDocument();

    const big = new File(['x'], 'big.png', { type: 'image/png' });
    Object.defineProperty(big, 'size', { value: 5 * 1024 * 1024 + 1 });
    fireEvent.change(input, { target: { files: [big] } });
    submit();
    expect(await screen.findByText(/too large. The limit is 5 MB/)).toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();

    post.mockRejectedValue(new Error('This file is not a real PNG image. Please upload the original picture.'));
    fireEvent.change(input, { target: { files: [new File(['x'], 'fake.png', { type: 'image/png' })] } });
    submit();
    expect(await screen.findByText(/not a real PNG image/)).toBeInTheDocument();
    expect(latest).toBe('<p>x</p>');
  });

  it('drops images it does not host when content is loaded or pasted', async () => {
    await setup(`<p>a</p><img src="https://evil.example/x.png"><img src="data:image/png;base64,AAAA"><img src="${IMG}" alt="ok">`);
    const imgs = screen.getByRole('textbox', { name: 'Content' }).querySelectorAll('img');
    expect(Array.from(imgs).map((i) => i.getAttribute('src'))).toEqual([IMG]);
  });

  it('Esc moves focus from the text to the toolbar', async () => {
    const { textbox } = await setup('<p>x</p>');
    textbox.focus();
    fireEvent.keyDown(textbox, { key: 'Escape' });
    expect(tool('Heading 2')).toHaveFocus();
  });

  it('reports an empty document as an empty string', async () => {
    const { editor } = await setup('<p>x</p>');
    act(() => {
      editor.commands.clearContent(true);
    });
    expect(latest).toBe('');
  });
});

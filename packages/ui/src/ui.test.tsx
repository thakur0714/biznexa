import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { vi } from 'vitest';
import { Badge, Button, Checkbox, Dialog, EmptyState, Field, Select, Table, TextArea, ToastProvider, useToast } from './index';

describe('Field and Select', () => {
  it('link the label and describe the control with its error', () => {
    render(
      <>
        <Field id="email" label="Email" error="Enter a valid email" />
        <Select id="sort" label="Sort by" hint="Applies at once">
          <option value="a">A</option>
        </Select>
      </>,
    );
    const input = screen.getByLabelText('Email');
    expect(input).toHaveProperty('ariaInvalid', 'true');
    expect(input.getAttribute('aria-describedby')).toBe('email-err');
    expect(screen.getByText('Enter a valid email').id).toBe('email-err');

    const select = screen.getByLabelText('Sort by');
    expect(select.tagName).toBe('SELECT');
    expect(select.getAttribute('aria-describedby')).toBe('sort-hint');
  });
});

describe('TextArea and Checkbox', () => {
  it('label the control and describe it with its error or hint', () => {
    render(
      <>
        <TextArea id="about" label="About" error="Too long" />
        <Checkbox id="live" label="Show on the website" hint="Hidden when off" defaultChecked />
      </>,
    );
    const about = screen.getByLabelText('About');
    expect(about.tagName).toBe('TEXTAREA');
    expect(about.getAttribute('aria-invalid')).toBe('true');
    expect(document.getElementById(about.getAttribute('aria-describedby')!)?.textContent).toBe('Too long');
    const live = screen.getByLabelText<HTMLInputElement>('Show on the website');
    expect(live.checked).toBe(true);
    expect(document.getElementById(live.getAttribute('aria-describedby')!)?.textContent).toBe('Hidden when off');
    fireEvent.click(live);
    expect(live.checked).toBe(false);
  });
});

describe('Button', () => {
  it('keeps the browser default type so it submits forms', () => {
    const onSubmit = vi.fn((e: React.SubmitEvent<HTMLFormElement>) => e.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <Button>Save</Button>
      </form>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSubmit).toHaveBeenCalledOnce();
  });
});

describe('Badge, EmptyState, Table', () => {
  it('render their content', () => {
    render(
      <>
        <Badge tone="success">Active</Badge>
        <EmptyState title="Nothing here" description="Try again" action={<a href="/">Reset</a>} />
        <Table caption="Prices">
          <tbody>
            <tr>
              <td>1</td>
            </tr>
          </tbody>
        </Table>
      </>,
    );
    expect(screen.getByText('Active').className).toContain('text-seal');
    expect(screen.getByText('Nothing here')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Reset' })).toBeTruthy();
    expect(screen.getByRole('table', { name: 'Prices' })).toBeTruthy();
  });
});

describe('Dialog', () => {
  function Harness({ onClose }: Readonly<{ onClose?: () => void }>) {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button onClick={() => setOpen(true)}>Open</button>
        <Dialog
          open={open}
          onClose={() => {
            onClose?.();
            setOpen(false);
          }}
          title="Delete service?"
          description="This cannot be undone."
        />
      </>
    );
  }

  it('opens modally with an accessible name and closes on the native close event (Escape)', () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    const dialog = document.querySelector('dialog')!;
    expect(dialog.open).toBe(false);

    fireEvent.click(screen.getByText('Open'));
    expect(dialog.open).toBe(true);
    expect(screen.getByRole('dialog', { name: 'Delete service?' })).toBeTruthy();
    expect(dialog.getAttribute('aria-describedby')).toBe(screen.getByText('This cannot be undone.').id);

    act(() => dialog.close());
    expect(onClose).toHaveBeenCalledOnce();
    expect(dialog.open).toBe(false);
  });

  it('closes on a backdrop click but not on a click inside', () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    fireEvent.click(screen.getByText('Open'));
    fireEvent.click(screen.getByText('Delete service?'));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(document.querySelector('dialog')!);
    expect(onClose).toHaveBeenCalledOnce();
  });
});

describe('Toast', () => {
  function Trigger({ message, tone }: Readonly<{ message: string; tone?: 'info' | 'success' | 'error' }>) {
    const toast = useToast();
    return <button onClick={() => toast(message, tone)}>{message}</button>;
  }

  it('announces, caps the stack, can be dismissed and expires', async () => {
    vi.useFakeTimers();
    render(
      <ToastProvider>
        {['One', 'Two', 'Three', 'Four'].map((m) => (
          <Trigger key={m} message={m} />
        ))}
        <Trigger message="Failed" tone="error" />
      </ToastProvider>,
    );
    const region = document.querySelector('[aria-live="polite"]')!;
    for (const m of ['One', 'Two', 'Three', 'Four']) fireEvent.click(screen.getByRole('button', { name: m }));
    expect(region.textContent).not.toContain('One');
    expect(region.querySelectorAll('p')).toHaveLength(3);

    fireEvent.click(screen.getAllByRole('button', { name: 'Dismiss notification' })[0]);
    expect(region.textContent).not.toContain('Two');

    fireEvent.click(screen.getByRole('button', { name: 'Failed' }));
    expect(screen.getByRole('alert').textContent).toContain('Failed');

    await act(() => vi.advanceTimersByTime(5000));
    expect(region.textContent).not.toContain('Four');
    expect(region.textContent).toContain('Failed');
    await act(() => vi.advanceTimersByTime(3000));
    expect(region.textContent).toBe('');
    vi.useRealTimers();
  });

  it('throws a clear error outside the provider', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<Trigger message="x" />)).toThrow('inside <ToastProvider>');
  });
});

describe('EmptyState as a section heading', () => {
  it('renders the title as the requested heading with an id', () => {
    render(<EmptyState title="No orders" titleAs="h2" titleId="orders-h" />);
    const h = screen.getByRole('heading', { level: 2, name: 'No orders' });
    expect(h.id).toBe('orders-h');
  });
});

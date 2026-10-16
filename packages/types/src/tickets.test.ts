import { describe, expect, it } from 'vitest';
import {
  canTransition,
  assertTransition,
  allowedNext,
  TICKET_TRANSITIONS,
  TICKET_STATUSES,
  TICKET_PRIORITIES,
  createTicketInput,
  updateTicketStatusInput,
  updateTicketPriorityInput,
  updateTicketAssigneeInput,
  postTicketMessageInput,
} from './index';

describe('ticket state machine', () => {
  it('defines valid statuses and priorities', () => {
    expect(TICKET_STATUSES).toEqual(['OPEN', 'IN_PROGRESS', 'WAITING_FOR_CUSTOMER', 'RESOLVED', 'CLOSED']);
    expect(TICKET_PRIORITIES).toEqual(['LOW', 'MEDIUM', 'HIGH', 'URGENT']);
  });

  it('allows transitions from OPEN', () => {
    expect(allowedNext('ticket', 'OPEN')).toEqual(['IN_PROGRESS', 'WAITING_FOR_CUSTOMER', 'RESOLVED', 'CLOSED']);
    expect(canTransition('ticket', 'OPEN', 'IN_PROGRESS')).toBe(true);
    expect(canTransition('ticket', 'OPEN', 'WAITING_FOR_CUSTOMER')).toBe(true);
    expect(canTransition('ticket', 'OPEN', 'RESOLVED')).toBe(true);
    expect(canTransition('ticket', 'OPEN', 'CLOSED')).toBe(true);
    expect(canTransition('ticket', 'OPEN', 'OPEN')).toBe(false);
  });

  it('allows transitions from IN_PROGRESS', () => {
    expect(allowedNext('ticket', 'IN_PROGRESS')).toEqual(['WAITING_FOR_CUSTOMER', 'RESOLVED', 'CLOSED']);
    expect(canTransition('ticket', 'IN_PROGRESS', 'WAITING_FOR_CUSTOMER')).toBe(true);
    expect(canTransition('ticket', 'IN_PROGRESS', 'RESOLVED')).toBe(true);
    expect(canTransition('ticket', 'IN_PROGRESS', 'CLOSED')).toBe(true);
    expect(canTransition('ticket', 'IN_PROGRESS', 'OPEN')).toBe(false);
  });

  it('allows transitions from WAITING_FOR_CUSTOMER', () => {
    expect(allowedNext('ticket', 'WAITING_FOR_CUSTOMER')).toEqual(['IN_PROGRESS', 'RESOLVED', 'CLOSED']);
    expect(canTransition('ticket', 'WAITING_FOR_CUSTOMER', 'IN_PROGRESS')).toBe(true);
    expect(canTransition('ticket', 'WAITING_FOR_CUSTOMER', 'RESOLVED')).toBe(true);
    expect(canTransition('ticket', 'WAITING_FOR_CUSTOMER', 'CLOSED')).toBe(true);
    expect(canTransition('ticket', 'WAITING_FOR_CUSTOMER', 'OPEN')).toBe(false);
  });

  it('allows transitions from RESOLVED', () => {
    expect(allowedNext('ticket', 'RESOLVED')).toEqual(['IN_PROGRESS', 'CLOSED']);
    expect(canTransition('ticket', 'RESOLVED', 'IN_PROGRESS')).toBe(true);
    expect(canTransition('ticket', 'RESOLVED', 'CLOSED')).toBe(true);
    expect(canTransition('ticket', 'RESOLVED', 'OPEN')).toBe(false);
    expect(canTransition('ticket', 'RESOLVED', 'WAITING_FOR_CUSTOMER')).toBe(false);
  });

  it('allows no transitions from CLOSED (terminal)', () => {
    expect(allowedNext('ticket', 'CLOSED')).toEqual([]);
    expect(canTransition('ticket', 'CLOSED', 'OPEN')).toBe(false);
    expect(canTransition('ticket', 'CLOSED', 'IN_PROGRESS')).toBe(false);
    expect(canTransition('ticket', 'CLOSED', 'WAITING_FOR_CUSTOMER')).toBe(false);
    expect(canTransition('ticket', 'CLOSED', 'RESOLVED')).toBe(false);
    expect(() => assertTransition('ticket', 'CLOSED', 'OPEN')).toThrow(/Invalid ticket status change: CLOSED → OPEN/);
  });
});

describe('ticket input schemas', () => {
  it('validates createTicketInput', () => {
    expect(createTicketInput.safeParse({ subject: 'Need Help', description: 'Detailed problem description' }).success).toBe(true);
    expect(
      createTicketInput.safeParse({
        subject: 'Need Help',
        description: 'Detailed problem description',
        priority: 'HIGH',
        applicationId: '00000000-0000-0000-0000-000000000001',
      }).success,
    ).toBe(true);

    // Invalid priority
    expect(createTicketInput.safeParse({ subject: 'Need Help', description: 'Detailed problem description', priority: 'CRITICAL' }).success).toBe(false);
    // Too short subject
    expect(createTicketInput.safeParse({ subject: 'No', description: 'Detailed problem description' }).success).toBe(false);
    // Empty description
    expect(createTicketInput.safeParse({ subject: 'Need Help', description: '' }).success).toBe(false);
  });

  it('validates update inputs', () => {
    expect(updateTicketStatusInput.safeParse({ status: 'IN_PROGRESS' }).success).toBe(true);
    expect(updateTicketStatusInput.safeParse({ status: 'INVALID' }).success).toBe(false);

    expect(updateTicketPriorityInput.safeParse({ priority: 'URGENT' }).success).toBe(true);
    expect(updateTicketPriorityInput.safeParse({ priority: 'INVALID' }).success).toBe(false);

    expect(updateTicketAssigneeInput.safeParse({ assignedToId: '00000000-0000-0000-0000-000000000001' }).success).toBe(true);
    expect(updateTicketAssigneeInput.safeParse({ assignedToId: null }).success).toBe(true);
  });

  it('validates postTicketMessageInput', () => {
    expect(postTicketMessageInput.safeParse({ body: 'Hello support' }).success).toBe(true);
    expect(postTicketMessageInput.safeParse({ body: '' }).success).toBe(false);
    expect(postTicketMessageInput.safeParse({ body: '   ' }).success).toBe(false);
  });
});

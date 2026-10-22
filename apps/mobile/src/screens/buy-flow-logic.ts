import { formDataValidator, type FormData, type FormSchema, type PaymentStatusView } from '@biznexa/types';

export type BuyFlowStep = 'form' | 'documents' | 'payment' | 'complete';

export function nextBuyFlowStep(step: BuyFlowStep): BuyFlowStep {
  if (step === 'form') return 'documents';
  if (step === 'documents') return 'payment';
  return step;
}

export function validateWholeForm(form: FormSchema, values: FormData) {
  return formDataValidator(form).safeParse(values);
}

export function isPaymentConfirmed(status: PaymentStatusView): boolean {
  return status.outcome === 'PAID';
}


import type { Metadata } from 'next';
import { Suspense } from 'react';
import { RegisterForm } from './register-form';

export const metadata: Metadata = { title: 'Create your account', robots: { index: false } };

export default function RegisterPage() {
  return (
    <Suspense>
      <RegisterForm />
    </Suspense>
  );
}

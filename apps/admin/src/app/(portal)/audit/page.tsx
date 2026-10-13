import { Metadata } from 'next';
import { AuditLogView } from './audit-view';

export const metadata: Metadata = { title: 'Audit Log' };

export default function Page() {
  return <AuditLogView />;
}

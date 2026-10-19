'use client';

import { useState } from 'react';
import { useAuth } from '@/lib/auth';
import { PERMS } from '@biznexa/types';
import { Button } from '@biznexa/ui';
import { DeliveriesView } from './deliveries-view';
import { NotificationsView } from './notifications-view';
import { AnnouncementsView } from './announcements-view';

export function NotificationsHub() {
  const { user } = useAuth();
  const perms = user?.permissions ?? [];
  const canViewDeliveries = perms.includes(PERMS.NOTIFICATIONS_VIEW) || perms.includes(PERMS.ADMIN_ACCESS);
  const canManageTemplates = perms.includes(PERMS.SETTINGS_MANAGE) || perms.includes(PERMS.ADMIN_ACCESS);

  const [tab, setTab] = useState<'deliveries' | 'templates' | 'announcements'>('deliveries');

  if (canManageTemplates && !canViewDeliveries) {
    return <NotificationsView />;
  }

  if (canViewDeliveries && !canManageTemplates) {
    return <DeliveriesView />;
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2 border-b border-border pb-3">
        <Button
          variant={tab === 'deliveries' ? 'primary' : 'outline'}
          size="sm"
          onClick={() => setTab('deliveries')}
        >
          Delivery Log
        </Button>
        <Button
          variant={tab === 'templates' ? 'primary' : 'outline'}
          size="sm"
          onClick={() => setTab('templates')}
        >
          Templates
        </Button>
        <Button variant={tab === 'announcements' ? 'primary' : 'outline'} size="sm" onClick={() => setTab('announcements')}>
          Announcements
        </Button>
      </div>
      {tab === 'templates' ? <NotificationsView /> : tab === 'announcements' ? <AnnouncementsView /> : <DeliveriesView />}
    </div>
  );
}

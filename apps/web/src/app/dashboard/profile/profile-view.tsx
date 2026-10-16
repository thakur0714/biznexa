'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { NotificationChannel, UserNotificationPreferences } from '@biznexa/types';
import { Badge, Button, Checkbox, Dialog, Field, Notice } from '@biznexa/ui';
import { Icon } from '@/components/icons';
import { useAuth } from '@/lib/auth';
import { useApi } from '@biznexa/api-client/react';

const CHANNELS: readonly { id: NotificationChannel; label: string; desc: string }[] = [
  { id: 'EMAIL', label: 'Email', desc: 'Statements, invoices, and service updates' },
  { id: 'SMS', label: 'SMS', desc: 'Critical alerts and one-time verifications' },
  { id: 'PUSH', label: 'Browser Push', desc: 'Real-time notifications on desktop and mobile' },
  { id: 'IN_APP', label: 'In-App Center', desc: 'Bell notifications inside the BizNexa portal' },
  { id: 'WHATSAPP', label: 'WhatsApp', desc: 'Document notices and quick updates via WhatsApp' },
];

export function CustomerProfileView() {
  const router = useRouter();
  const { user, refresh, signOut } = useAuth();
  const api = useApi();

  // Personal details state
  const [name, setName] = useState(user?.name ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileSuccess, setProfileSuccess] = useState<string | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);


  // Password state
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordSuccess, setPasswordSuccess] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  // Notification preferences state
  const [marketingOptOut, setMarketingOptOut] = useState(false);
  const [channelPreferences, setChannelPreferences] = useState<Record<NotificationChannel, boolean>>({
    EMAIL: true,
    SMS: true,
    PUSH: true,
    IN_APP: true,
    WHATSAPP: true,
  });
  const [prefsLoading, setPrefsLoading] = useState(true);
  const [prefsSaving, setPrefsSaving] = useState(false);
  const [prefsSuccess, setPrefsSuccess] = useState<string | null>(null);
  const [prefsError, setPrefsError] = useState<string | null>(null);

  // Logout all dialog state
  const [logoutAllOpen, setLogoutAllOpen] = useState(false);
  const [loggingOutAll, setLoggingOutAll] = useState(false);
  const [logoutAllError, setLogoutAllError] = useState<string | null>(null);

  // Load preferences
  useEffect(() => {
    let cancelled = false;
    api
      .call<UserNotificationPreferences>((c) => c.GET('/api/notifications/preferences'))
      .then(
        (res) => {
          if (!cancelled) {
            setMarketingOptOut(res.marketingOptOut ?? false);
            setChannelPreferences({
              EMAIL: res.channelPreferences?.EMAIL ?? true,
              SMS: res.channelPreferences?.SMS ?? true,
              PUSH: res.channelPreferences?.PUSH ?? true,
              IN_APP: res.channelPreferences?.IN_APP ?? true,
              WHATSAPP: res.channelPreferences?.WHATSAPP ?? true,
            });
            setPrefsLoading(false);
          }
        },
        (err: Error) => {
          if (!cancelled) {
            setPrefsError(err.message || 'Failed to load notification preferences');
            setPrefsLoading(false);
          }
        },
      );
    return () => {
      cancelled = true;
    };
  }, [api]);

  // Handlers
  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setProfileSaving(true);
    setProfileSuccess(null);
    setProfileError(null);

    const trimmedName = name.trim();
    const trimmedEmail = email.trim();

    if (!trimmedName) {
      setProfileError('Please enter your full name');
      setProfileSaving(false);
      return;
    }

    try {
      await api.call((c) =>
        c.PATCH('/api/auth/me', {
          body: {
            name: trimmedName,
            email: trimmedEmail || undefined,
          },
        }),
      );
      await refresh();
      setProfileSuccess('Personal details updated successfully.');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to update profile details.';
      setProfileError(msg);
    } finally {
      setProfileSaving(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordSaving(true);
    setPasswordSuccess(null);
    setPasswordError(null);

    if (!currentPassword) {
      setPasswordError('Please enter your current password');
      setPasswordSaving(false);
      return;
    }
    if (newPassword.length < 8) {
      setPasswordError('New password must be at least 8 characters long');
      setPasswordSaving(false);
      return;
    }
    if (!/[A-Za-z]/.test(newPassword) || !/\d/.test(newPassword)) {
      setPasswordError('New password must contain at least one letter and one number');
      setPasswordSaving(false);
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('New passwords do not match');
      setPasswordSaving(false);
      return;
    }

    try {
      await api.call((c) =>
        c.POST('/api/auth/password/change', {
          body: {
            currentPassword,
            newPassword,
          },
        }),
      );
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setPasswordSuccess('Password updated successfully. Other active sessions have been signed out.');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to change password. Please check your current password.';
      setPasswordError(msg);
    } finally {
      setPasswordSaving(false);
    }
  };

  const handleSavePreferences = async (e: React.FormEvent) => {
    e.preventDefault();
    setPrefsSaving(true);
    setPrefsSuccess(null);
    setPrefsError(null);

    try {
      await api.call((c) =>
        c.PUT('/api/notifications/preferences', {
          body: {
            marketingOptOut,
            channelPreferences,
          },
        }),
      );
      setPrefsSuccess('Notification preferences saved successfully.');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to save notification preferences.';
      setPrefsError(msg);
    } finally {
      setPrefsSaving(false);
    }
  };

  const handleLogoutAllConfirm = async () => {
    setLoggingOutAll(true);
    setLogoutAllError(null);

    try {
      await api.call((c) => c.POST('/api/auth/logout-all'));
      await signOut();
      router.push('/login');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to log out of all devices.';
      setLogoutAllError(msg);
      setLoggingOutAll(false);
    }
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-night sm:text-3xl">Profile &amp; Settings</h1>
        <p className="mt-1 text-sm text-muted">
          Manage your personal details, security credentials, and communication preferences.
        </p>
      </div>

      {/* Section 1: Personal Details */}
      <section className="rounded-xl border border-rule bg-white p-6 shadow-sm">
        <div className="border-b border-rule pb-4">
          <h2 className="text-lg font-semibold text-night">Personal Details</h2>
          <p className="mt-1 text-xs text-muted">
            Update your registered account name and email address.
          </p>
        </div>

        <form onSubmit={handleUpdateProfile} className="mt-6 space-y-4">
          {profileSuccess && (
            <Notice tone="success">{profileSuccess}</Notice>
          )}
          {profileError && (
            <Notice tone="error">{profileError}</Notice>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field
              id="profile-name"
              label="Full Name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your full legal name"
              required
            />

            <Field
              id="profile-email"
              label="Email Address"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@example.com"
              hint={
                user?.emailVerified
                  ? 'Changing your email will require re-verification'
                  : 'Your email address is unverified'
              }
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <Field
                id="profile-mobile"
                label="Mobile Number"
                type="text"
                value={user?.mobile ?? 'Not linked'}
                disabled
                className="opacity-75"
                hint="Mobile number is verified and tied to your account login"
              />
            </div>
            <div className="flex flex-col justify-center gap-1.5 pt-2 sm:pt-4">
              <span className="text-xs font-medium text-muted">Account Status:</span>
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={user?.emailVerified ? 'success' : 'warning'}>
                  {user?.emailVerified ? 'Email Verified' : 'Email Unverified'}
                </Badge>
                {user?.mobile && (
                  <Badge tone={user?.mobileVerified ? 'success' : 'neutral'}>
                    {user?.mobileVerified ? 'Mobile Verified' : 'Mobile Pending'}
                  </Badge>
                )}
              </div>
            </div>
          </div>

          <div className="flex justify-end pt-2">
            <Button type="submit" disabled={profileSaving}>
              {profileSaving ? 'Saving...' : 'Save Personal Details'}
            </Button>
          </div>
        </form>
      </section>

      {/* Section 2: Change Password */}
      <section className="rounded-xl border border-rule bg-white p-6 shadow-sm">
        <div className="border-b border-rule pb-4">
          <h2 className="text-lg font-semibold text-night">Change Password</h2>
          <p className="mt-1 text-xs text-muted">
            Ensure your account uses a strong password. Changing it will sign out all other devices.
          </p>
        </div>

        <form onSubmit={handleChangePassword} className="mt-6 space-y-4">
          {passwordSuccess && (
            <Notice tone="success">{passwordSuccess}</Notice>
          )}
          {passwordError && (
            <Notice tone="error">{passwordError}</Notice>
          )}

          <div className="max-w-md space-y-4">
            <Field
              id="current-password"
              label="Current Password"
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              placeholder="••••••••"
              required
            />

            <Field
              id="new-password"
              label="New Password"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="••••••••"
              hint="Minimum 8 characters with at least one letter and one number"
              required
            />

            <Field
              id="confirm-password"
              label="Confirm New Password"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="••••••••"
              required
            />
          </div>

          <div className="flex justify-end pt-2">
            <Button type="submit" disabled={passwordSaving}>
              {passwordSaving ? 'Updating...' : 'Update Password'}
            </Button>
          </div>
        </form>
      </section>

      {/* Section 3: Notification Preferences */}
      <section className="rounded-xl border border-rule bg-white p-6 shadow-sm">
        <div className="border-b border-rule pb-4">
          <h2 className="text-lg font-semibold text-night">Notification Preferences</h2>
          <p className="mt-1 text-xs text-muted">
            Select your preferred communication channels. Transactional alerts for orders, invoices, and certificates cannot be turned off.
          </p>
        </div>

        {prefsLoading ? (
          <div className="py-8 text-center text-sm text-muted">Loading preferences...</div>
        ) : (
          <form onSubmit={handleSavePreferences} className="mt-6 space-y-6">
            {prefsSuccess && (
              <Notice tone="success">{prefsSuccess}</Notice>
            )}
            {prefsError && (
              <Notice tone="error">{prefsError}</Notice>
            )}

            {/* Category: Marketing opt-out */}
            <div className="rounded-lg border border-rule bg-paper/50 p-4">
              <Checkbox
                id="pref-marketing"
                checked={!marketingOptOut}
                onChange={(e) => setMarketingOptOut(!e.target.checked)}
                label={<span className="font-medium text-night">Marketing &amp; Promotional Updates</span>}
                hint="Receive product newsletters, compliance guides, and promotional discounts from BizNexa."
              />
            </div>

            {/* Per-channel toggles */}
            <div>
              <h3 className="text-sm font-semibold text-night mb-3">Notification Channels</h3>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {CHANNELS.map((ch) => (
                  <div key={ch.id} className="rounded-lg border border-rule p-3">
                    <Checkbox
                      id={`pref-channel-${ch.id}`}
                      checked={channelPreferences[ch.id] ?? true}
                      onChange={(e) =>
                        setChannelPreferences((prev) => ({
                          ...prev,
                          [ch.id]: e.target.checked,
                        }))
                      }
                      label={<span className="font-medium text-night">{ch.label}</span>}
                      hint={ch.desc}
                    />
                  </div>
                ))}
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <Button type="submit" disabled={prefsSaving}>
                {prefsSaving ? 'Saving...' : 'Save Preferences'}
              </Button>
            </div>
          </form>
        )}
      </section>

      {/* Section 4: Session Management */}
      <section className="rounded-xl border border-rule bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-night">Active Sessions</h2>
            <p className="mt-1 text-xs text-muted">
              Lost a device or want to log out everywhere? Revoke all active login sessions across devices.
            </p>
          </div>
          <div>
            <Button
              type="button"
              variant="outline"
              onClick={() => setLogoutAllOpen(true)}
              className="text-danger hover:border-danger hover:bg-danger/5"
            >
              <Icon name="lock" size={16} />
              <span>Log out of all devices</span>
            </Button>
          </div>
        </div>
      </section>

      {/* Confirmation Dialog */}
      <Dialog
        open={logoutAllOpen}
        onClose={() => !loggingOutAll && setLogoutAllOpen(false)}
        title="Log out of all devices?"
        description="This will instantly invalidate all active sessions across all browsers and devices. You will be redirected to the sign-in page."
        footer={
          <>
            <Button
              type="button"
              variant="outline"
              onClick={() => setLogoutAllOpen(false)}
              disabled={loggingOutAll}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleLogoutAllConfirm}
              disabled={loggingOutAll}
              className="bg-danger text-white hover:bg-danger/90"
            >
              {loggingOutAll ? 'Logging out...' : 'Yes, log out everywhere'}
            </Button>
          </>
        }
      >
        {logoutAllError && (
          <div className="mb-4">
            <Notice tone="error">{logoutAllError}</Notice>
          </div>
        )}
        <p className="text-sm text-muted">
          Are you sure you want to proceed? Any unsaved work in other sessions may be lost.
        </p>
      </Dialog>
    </div>
  );
}

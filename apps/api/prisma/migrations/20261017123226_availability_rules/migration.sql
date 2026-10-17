-- M8.6 (D57): exception dates are IST calendar dates. Existing values were stored as instants, so read them in IST.
ALTER TABLE "AvailabilitySlot" ALTER COLUMN "date" SET DATA TYPE DATE USING (("date" + interval '330 minutes')::date);

-- A row is either a weekly window (weekday, never blocked) or a date exception; times are "HH:MM" IST, end after start.
ALTER TABLE "AvailabilitySlot"
  ADD CONSTRAINT "AvailabilitySlot_kind_check" CHECK (
    ("weekday" IS NOT NULL AND "date" IS NULL AND "weekday" BETWEEN 0 AND 6 AND NOT "isBlocked")
    OR ("weekday" IS NULL AND "date" IS NOT NULL)
  ),
  ADD CONSTRAINT "AvailabilitySlot_times_check" CHECK (
    "startTime" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
    AND "endTime" ~ '^(([01][0-9]|2[0-3]):[0-5][0-9]|24:00)$'
    AND "endTime" > "startTime"
  );

-- AlterTable
ALTER TABLE "Consultant" ADD COLUMN     "bufferMinutes" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "minNoticeMinutes" INTEGER NOT NULL DEFAULT 120;

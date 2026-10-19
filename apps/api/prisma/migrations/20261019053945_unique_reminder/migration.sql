-- Delete duplicates, keeping the oldest row
DELETE FROM "Reminder" a USING (
    SELECT MIN("createdAt") as min_created, type, "sourceApplicationId", title
    FROM "Reminder"
    GROUP BY type, "sourceApplicationId", title
) b
WHERE a.type = b.type
  AND a."sourceApplicationId" = b."sourceApplicationId"
  AND a.title = b.title
  AND a."createdAt" > b.min_created;

-- CreateIndex
CREATE UNIQUE INDEX "Reminder_type_sourceApplicationId_title_key" ON "Reminder"("type", "sourceApplicationId", "title");

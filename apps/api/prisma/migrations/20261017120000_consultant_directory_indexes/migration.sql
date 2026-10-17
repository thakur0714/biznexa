CREATE INDEX "Consultant_state_city_area_idx" ON "Consultant"("state", "city", "area");
CREATE INDEX "Consultant_rating_idx" ON "Consultant"("rating");
CREATE INDEX "Consultant_experienceYears_idx" ON "Consultant"("experienceYears");
CREATE INDEX "Consultant_feePerSession_idx" ON "Consultant"("feePerSession");
CREATE INDEX "Consultant_languages_idx" ON "Consultant" USING GIN ("languages");
CREATE INDEX "Consultant_consultationTypes_idx" ON "Consultant" USING GIN ("consultationTypes");
CREATE INDEX "AvailabilitySlot_consultantId_weekday_isBlocked_idx" ON "AvailabilitySlot"("consultantId", "weekday", "isBlocked");
CREATE INDEX "AvailabilitySlot_consultantId_date_isBlocked_idx" ON "AvailabilitySlot"("consultantId", "date", "isBlocked");

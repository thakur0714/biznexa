-- Keep the existing BNC-YYYY-NNNNNN format while serializing each calendar year's counter
-- in the same transaction that creates the certificate.
CREATE TABLE "CertificateSequence" (
    "year" INTEGER NOT NULL,
    "lastNumber" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CertificateSequence_pkey" PRIMARY KEY ("year")
);

-- Seed from existing automatically formatted numbers so deployment never reissues one.
INSERT INTO "CertificateSequence" ("year", "lastNumber", "updatedAt")
SELECT
    (regexp_match("certificateNumber", '^BNC-([0-9]{4})-([0-9]{6,})$'))[1]::integer,
    MAX((regexp_match("certificateNumber", '^BNC-([0-9]{4})-([0-9]{6,})$'))[2]::integer),
    now()
FROM "Certificate"
WHERE "certificateNumber" ~ '^BNC-[0-9]{4}-[0-9]{6,}$'
GROUP BY (regexp_match("certificateNumber", '^BNC-([0-9]{4})-([0-9]{6,})$'))[1]::integer;

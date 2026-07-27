-- CreateEnum
CREATE TYPE "BusinessType" AS ENUM (
  'RESTAURANT',
  'RETAIL',
  'SERVICES',
  'SAAS',
  'CONSTRUCTION',
  'PROFESSIONAL',
  'HEALTHCARE',
  'MANUFACTURING',
  'OTHER'
);

-- CreateEnum
CREATE TYPE "EmployeeRange" AS ENUM (
  'SOLO',
  'SMALL',
  'MEDIUM',
  'LARGE',
  'ENTERPRISE'
);

-- CreateTable
CREATE TABLE "business_profiles" (
    "id" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "business_type" "BusinessType" NOT NULL,
    "employee_range" "EmployeeRange" NOT NULL,
    "monthly_rent" DECIMAL(12,2),
    "monthly_revenue" DECIMAL(14,2),
    "location" TEXT,
    "business_notes" TEXT,
    "completed_at" TIMESTAMP(3),
    "skipped_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "business_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "business_profiles_user_id_key" ON "business_profiles"("user_id");

-- AddForeignKey
ALTER TABLE "business_profiles"
  ADD CONSTRAINT "business_profiles_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "profiles"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

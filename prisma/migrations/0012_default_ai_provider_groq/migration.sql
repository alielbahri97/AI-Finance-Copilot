-- Prefer free Groq for new profiles; leave existing choices untouched.
ALTER TABLE "profiles" ALTER COLUMN "ai_provider" SET DEFAULT 'GROQ';

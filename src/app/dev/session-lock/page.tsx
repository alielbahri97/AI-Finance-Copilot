import { notFound } from "next/navigation";

import { SessionLockTestClient } from "./session-lock-test-client";

export const dynamic = "force-dynamic";

export default function SessionLockTestPage() {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }
  return <SessionLockTestClient />;
}

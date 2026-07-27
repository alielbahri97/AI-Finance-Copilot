import "server-only";

import { exactHooks } from "./exact";
import { gmailHooks } from "./gmail";
import { gocardlessHooks } from "./gocardless";
import { googleCalendarHooks } from "./google-calendar";
import { outlookHooks } from "./outlook";
import { plaidHooks } from "./plaid";
import { quickbooksHooks } from "./quickbooks";
import { slackHooks } from "./slack";
import { teamsHooks } from "./teams";
import { tinkHooks } from "./tink";
import type { ProviderHooks } from "./types";
import { xeroHooks } from "./xero";

const HOOKS: Record<string, ProviderHooks> = {
  plaid: plaidHooks,
  tink: tinkHooks,
  gocardless: gocardlessHooks,
  quickbooks: quickbooksHooks,
  xero: xeroHooks,
  exact: exactHooks,
  gmail: gmailHooks,
  outlook: outlookHooks,
  slack: slackHooks,
  teams: teamsHooks,
  "google-calendar": googleCalendarHooks,
};

export function getProviderHooks(providerId: string): ProviderHooks {
  return HOOKS[providerId] ?? {};
}

"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2Icon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

const PLAID_SCRIPT_SRC = "https://cdn.plaid.com/link/v2/stable/link-initialize.js";

interface PlaidLinkHandler {
  open: () => void;
}

interface PlaidGlobal {
  create: (config: {
    token: string;
    onSuccess: (publicToken: string, metadata: { institution?: { name?: string } }) => void;
    onExit: (error: { display_message?: string } | null) => void;
  }) => PlaidLinkHandler;
}

declare global {
  interface Window {
    Plaid?: PlaidGlobal;
  }
}

function loadPlaidScript(): Promise<PlaidGlobal> {
  return new Promise((resolve, reject) => {
    if (window.Plaid) return resolve(window.Plaid);
    const existing = document.querySelector(`script[src="${PLAID_SCRIPT_SRC}"]`);
    const script = existing ?? document.createElement("script");
    const onLoad = () =>
      window.Plaid ? resolve(window.Plaid) : reject(new Error("Plaid failed to load"));
    if (existing) {
      onLoad();
      return;
    }
    script.setAttribute("src", PLAID_SCRIPT_SRC);
    script.addEventListener("load", onLoad);
    script.addEventListener("error", () => reject(new Error("Could not load Plaid Link")));
    document.head.appendChild(script);
  });
}

/** Opens Plaid Link and exchanges the public token server-side. */
export function PlaidConnectButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const connect = useCallback(async () => {
    setBusy(true);
    try {
      const tokenResponse = await fetch("/api/integrations/plaid/link-token", {
        method: "POST",
      });
      const tokenBody = (await tokenResponse.json()) as { linkToken?: string; error?: string };
      if (!tokenResponse.ok || !tokenBody.linkToken) {
        throw new Error(tokenBody.error ?? "Could not create a Link token");
      }

      const plaid = await loadPlaidScript();
      const handler = plaid.create({
        token: tokenBody.linkToken,
        onSuccess: (publicToken, metadata) => {
          void (async () => {
            const exchangeResponse = await fetch("/api/integrations/plaid/exchange", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                publicToken,
                institution: metadata.institution?.name,
              }),
            });
            const body = (await exchangeResponse.json()) as { error?: string };
            if (!exchangeResponse.ok) {
              toast.error(body.error ?? "Could not complete the connection");
            } else {
              toast.success("Bank account connected via Plaid");
              router.refresh();
            }
            setBusy(false);
          })();
        },
        onExit: (error) => {
          if (error?.display_message) toast.error(error.display_message);
          setBusy(false);
        },
      });
      handler.open();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Plaid connection failed");
      setBusy(false);
    }
  }, [router]);

  return (
    <Button size="sm" onClick={connect} disabled={busy}>
      {busy ? <Loader2Icon className="size-4 animate-spin" /> : null}
      Connect
    </Button>
  );
}

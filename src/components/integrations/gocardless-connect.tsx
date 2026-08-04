"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BanknoteIcon,
  CalendarClockIcon,
  EyeIcon,
  Loader2Icon,
  LockIcon,
  PlugIcon,
  SearchIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/** Countries covered by GoCardless Bank Account Data (EEA + UK). */
const COUNTRIES: Array<{ code: string; name: string }> = [
  { code: "AT", name: "Austria" },
  { code: "BE", name: "Belgium" },
  { code: "BG", name: "Bulgaria" },
  { code: "HR", name: "Croatia" },
  { code: "CY", name: "Cyprus" },
  { code: "CZ", name: "Czechia" },
  { code: "DK", name: "Denmark" },
  { code: "EE", name: "Estonia" },
  { code: "FI", name: "Finland" },
  { code: "FR", name: "France" },
  { code: "DE", name: "Germany" },
  { code: "GR", name: "Greece" },
  { code: "HU", name: "Hungary" },
  { code: "IS", name: "Iceland" },
  { code: "IE", name: "Ireland" },
  { code: "IT", name: "Italy" },
  { code: "LV", name: "Latvia" },
  { code: "LI", name: "Liechtenstein" },
  { code: "LT", name: "Lithuania" },
  { code: "LU", name: "Luxembourg" },
  { code: "MT", name: "Malta" },
  { code: "NL", name: "Netherlands" },
  { code: "NO", name: "Norway" },
  { code: "PL", name: "Poland" },
  { code: "PT", name: "Portugal" },
  { code: "RO", name: "Romania" },
  { code: "SK", name: "Slovakia" },
  { code: "SI", name: "Slovenia" },
  { code: "ES", name: "Spain" },
  { code: "SE", name: "Sweden" },
  { code: "GB", name: "United Kingdom" },
];

const COUNTRY_STORAGE_KEY = "finpilot.gocardless.country";

interface InstitutionOption {
  id: string;
  name: string;
  logo: string | null;
  historyDays: number | null;
}

interface GoCardlessConnectButtonProps {
  /** Sensible starting country, derived from the profile server-side. */
  defaultCountry: string;
  /** Renders as "Reconnect"/"Renew" instead of "Connect bank". */
  variant?: "connect" | "reconnect" | "renew";
}

export function GoCardlessConnectButton({
  defaultCountry,
  variant = "connect",
}: GoCardlessConnectButtonProps) {
  const [open, setOpen] = useState(false);
  const [country, setCountry] = useState(defaultCountry);
  const [search, setSearch] = useState("");
  const [institutions, setInstitutions] = useState<InstitutionOption[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [redirecting, setRedirecting] = useState<string | null>(null);

  // The last-used country is a better default than any heuristic.
  useEffect(() => {
    const stored = window.localStorage.getItem(COUNTRY_STORAGE_KEY);
    if (stored && COUNTRIES.some((entry) => entry.code === stored)) {
      setCountry(stored);
    }
  }, []);

  const loadInstitutions = useCallback(async (countryCode: string) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/integrations/gocardless/institutions?country=${countryCode}`
      );
      const body = (await response.json()) as {
        institutions?: InstitutionOption[];
        error?: string;
      };
      if (!response.ok) throw new Error(body.error ?? "Could not load the bank list");
      setInstitutions(body.institutions ?? []);
    } catch (cause) {
      setInstitutions(null);
      setError(cause instanceof Error ? cause.message : "Could not load the bank list");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) void loadInstitutions(country);
  }, [open, country, loadInstitutions]);

  const filtered = useMemo(() => {
    if (!institutions) return [];
    const query = search.trim().toLowerCase();
    if (!query) return institutions;
    return institutions.filter((institution) =>
      institution.name.toLowerCase().includes(query)
    );
  }, [institutions, search]);

  const selectCountry = (code: string) => {
    setCountry(code);
    setSearch("");
    window.localStorage.setItem(COUNTRY_STORAGE_KEY, code);
  };

  const connectTo = (institutionId: string) => {
    setRedirecting(institutionId);
    window.location.href = `/api/integrations/gocardless/connect?institution=${encodeURIComponent(
      institutionId
    )}`;
  };

  const label =
    variant === "reconnect" ? "Reconnect" : variant === "renew" ? "Renew consent" : "Connect bank";

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant={variant === "renew" ? "outline" : "default"}>
          <PlugIcon className="size-4" />
          {label}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Choose your bank</DialogTitle>
          <DialogDescription>
            You&apos;ll be sent to your bank to approve read-only access, then brought back
            here.
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-2">
          <Select value={country} onValueChange={selectCountry}>
            <SelectTrigger className="w-36 shrink-0" aria-label="Country">
              <SelectValue placeholder="Country" />
            </SelectTrigger>
            <SelectContent>
              {COUNTRIES.map((entry) => (
                <SelectItem key={entry.code} value={entry.code}>
                  {entry.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="relative flex-1">
            <SearchIcon className="text-muted-foreground absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search banks…"
              className="pl-8"
              aria-label="Search banks"
            />
          </div>
        </div>

        <div className="h-64 overflow-y-auto rounded-md border" role="listbox" aria-label="Banks">
          {loading ? (
            <div className="text-muted-foreground flex h-full items-center justify-center gap-2 text-sm">
              <Loader2Icon className="size-4 animate-spin" />
              Loading banks…
            </div>
          ) : error ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-sm">
              <p className="text-destructive">{error}</p>
              <Button size="sm" variant="outline" onClick={() => loadInstitutions(country)}>
                Try again
              </Button>
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-muted-foreground flex h-full items-center justify-center px-6 text-center text-sm">
              {search
                ? `No banks match “${search}”. Try a different spelling or country.`
                : "No banks available for this country."}
            </div>
          ) : (
            <ul className="divide-y">
              {filtered.map((institution) => (
                <li key={institution.id}>
                  <button
                    type="button"
                    onClick={() => connectTo(institution.id)}
                    disabled={redirecting !== null}
                    className="hover:bg-muted/60 focus-visible:bg-muted/60 flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm outline-none disabled:opacity-60"
                  >
                    {institution.logo ? (
                      // Bank logos come from GoCardless's CDN; next/image
                      // can't allowlist arbitrary institution hosts.
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={institution.logo}
                        alt=""
                        className="size-8 shrink-0 rounded-md object-contain"
                        loading="lazy"
                      />
                    ) : (
                      <span className="bg-muted flex size-8 shrink-0 items-center justify-center rounded-md">
                        <BanknoteIcon className="text-muted-foreground size-4" />
                      </span>
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{institution.name}</span>
                      {institution.historyDays ? (
                        <span className="text-muted-foreground block text-xs">
                          Up to {institution.historyDays} days of history
                        </span>
                      ) : null}
                    </span>
                    {redirecting === institution.id ? (
                      <Loader2Icon className="size-4 shrink-0 animate-spin" />
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="text-muted-foreground space-y-1.5 text-xs">
          <p className="flex items-start gap-2">
            <LockIcon className="mt-0.5 size-3.5 shrink-0" />
            You log in at your bank — we never see your banking credentials.
          </p>
          <p className="flex items-start gap-2">
            <EyeIcon className="mt-0.5 size-3.5 shrink-0" />
            Access is read-only: we can see transactions and balances, never move money.
          </p>
          <p className="flex items-start gap-2">
            <CalendarClockIcon className="mt-0.5 size-3.5 shrink-0" />
            Consent lasts up to 180 days (bank-dependent) and you can disconnect any time.
            Access tokens are stored encrypted.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

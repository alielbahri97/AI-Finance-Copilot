"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  CopyIcon,
  GitCompareIcon,
  Loader2Icon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  BASE_SCENARIO_ID,
  MAX_COMPARED_SCENARIOS,
  scenarioColor,
  type ScenarioSummary,
} from "@/lib/finance/scenarios";

interface ScenarioSwitcherProps {
  scenarios: ScenarioSummary[];
  /** The scenario the page is currently forecasting. */
  activeId: string;
  /** Every scenario on the chart, primary first. */
  comparedIds: string[];
  /** False once the plan's scenario cap is reached. */
  canCreate: boolean;
  scenarioLimit: number | null;
}

/**
 * Picks the scenario the forecast is computed from, and which other scenarios
 * are drawn beside it.
 *
 * The selection lives in the URL (`?scenario=`, `?compare=`) rather than in
 * component state: the page is a server component that recomputes the forecast
 * per scenario, so a link is the whole mechanism — and a comparison worth
 * showing someone is a comparison worth being able to send them.
 */
export function ScenarioSwitcher({
  scenarios,
  activeId,
  comparedIds,
  canCreate,
  scenarioLimit,
}: ScenarioSwitcherProps) {
  const router = useRouter();
  const [isNavigating, startNavigation] = useTransition();
  const [dialog, setDialog] = useState<"create" | "rename" | null>(null);
  const [name, setName] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [duplicating, setDuplicating] = useState(false);

  const active = scenarios.find((scenario) => scenario.id === activeId);
  const others = scenarios.filter((scenario) => scenario.id !== activeId);
  const compared = comparedIds.filter((id) => id !== activeId);
  const namedCount = scenarios.filter((scenario) => scenario.id !== BASE_SCENARIO_ID).length;
  const isBase = activeId === BASE_SCENARIO_ID;
  const busy = isSaving || isDeleting || duplicating || isNavigating;

  function go(nextActive: string, nextCompared: string[]) {
    const params = new URLSearchParams();
    if (nextActive !== BASE_SCENARIO_ID) params.set("scenario", nextActive);
    const extras = nextCompared.filter((id) => id !== nextActive);
    if (extras.length > 0) params.set("compare", extras.join(","));
    const query = params.toString();
    startNavigation(() => router.push(query ? `/forecast?${query}` : "/forecast", { scroll: false }));
  }

  function selectActive(id: string) {
    go(
      id,
      compared.filter((other) => other !== id)
    );
  }

  function toggleCompared(id: string) {
    go(
      activeId,
      compared.includes(id) ? compared.filter((other) => other !== id) : [...compared, id]
    );
  }

  async function create() {
    const trimmed = name.trim();
    if (!trimmed || isSaving) return;
    setIsSaving(true);
    try {
      const response = await fetch("/api/scenarios", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        toast.error("Could not create the scenario", {
          description: body?.error ?? "Try again.",
        });
        return;
      }
      toast.success(`"${trimmed}" created`, {
        description: "Assumptions you add now belong to this scenario.",
      });
      setDialog(null);
      go(body.scenario.id, compared);
      router.refresh();
    } catch {
      toast.error("Network error", { description: "Please try again." });
    } finally {
      setIsSaving(false);
    }
  }

  async function rename() {
    const trimmed = name.trim();
    if (!trimmed || isBase || isSaving) return;
    setIsSaving(true);
    try {
      const response = await fetch(`/api/scenarios/${activeId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        toast.error("Could not rename the scenario", {
          description: body?.error ?? "Try again.",
        });
        return;
      }
      toast.success("Scenario renamed");
      setDialog(null);
      router.refresh();
    } catch {
      toast.error("Network error", { description: "Please try again." });
    } finally {
      setIsSaving(false);
    }
  }

  async function duplicate() {
    if (duplicating) return;
    setDuplicating(true);
    try {
      const response = await fetch(`/api/scenarios/${activeId}/duplicate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        toast.error("Could not duplicate the scenario", {
          description: body?.error ?? "Try again.",
        });
        return;
      }
      const copied = body?.copiedAssumptions ?? 0;
      toast.success(`"${body.scenario.name}" created`, {
        description:
          copied === 0
            ? "Nothing to copy — the source scenario has no assumptions."
            : `${copied} assumption${copied === 1 ? "" : "s"} copied. Change one and compare.`,
      });
      go(body.scenario.id, [activeId]);
      router.refresh();
    } catch {
      toast.error("Network error", { description: "Please try again." });
    } finally {
      setDuplicating(false);
    }
  }

  async function remove() {
    if (isBase) return;
    setIsDeleting(true);
    try {
      const response = await fetch(`/api/scenarios/${activeId}`, { method: "DELETE" });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        toast.error("Could not delete the scenario", { description: body?.error });
        return;
      }
      toast.success("Scenario deleted", {
        description: "Its assumptions went with it. Back to the base case.",
      });
      go(BASE_SCENARIO_ID, []);
      router.refresh();
    } catch {
      toast.error("Network error", { description: "Please try again." });
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-2">
        <div className="grid min-w-52 flex-1 gap-1.5">
          <Label htmlFor="scenario-select">Forecasting</Label>
          <Select value={activeId} onValueChange={selectActive} disabled={busy}>
            <SelectTrigger id="scenario-select" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {scenarios.map((scenario) => (
                <SelectItem key={scenario.id} value={scenario.id}>
                  {scenario.name}
                  {scenario.assumptionCount > 0
                    ? ` · ${scenario.assumptionCount} assumption${scenario.assumptionCount === 1 ? "" : "s"}`
                    : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={busy || !canCreate}
            onClick={duplicate}
            title={
              canCreate
                ? `Copy "${active?.name}" and its assumptions into a new scenario`
                : "Scenario limit reached"
            }
          >
            {duplicating ? <Loader2Icon className="animate-spin" /> : <CopyIcon />}
            Duplicate
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy || isBase}
            onClick={() => {
              setName(active?.name ?? "");
              setDialog("rename");
            }}
          >
            <PencilIcon />
            Rename
          </Button>
          <ConfirmDialog
            title={`Delete "${active?.name}"?`}
            description={
              active && active.assumptionCount > 0
                ? `Its ${active.assumptionCount} assumption${active.assumptionCount === 1 ? "" : "s"} will be deleted with it. The base case and every other scenario are untouched.`
                : "The base case and every other scenario are untouched."
            }
            confirmLabel="Delete scenario"
            onConfirm={remove}
            trigger={
              <Button size="sm" variant="outline" disabled={busy || isBase}>
                <Trash2Icon />
                Delete
              </Button>
            }
          />
          <Button
            size="sm"
            disabled={busy || !canCreate}
            onClick={() => {
              setName("");
              setDialog("create");
            }}
            title={canCreate ? undefined : "Scenario limit reached"}
          >
            <PlusIcon />
            New scenario
          </Button>
        </div>
      </div>

      {others.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          Duplicate this scenario to change one assumption and see both projections on the same
          chart.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <GitCompareIcon aria-hidden className="text-muted-foreground size-4" />
            <span className="text-sm font-medium">Compare with</span>
            {compared.length > 0 ? (
              <Button
                size="sm"
                variant="ghost"
                className="h-6 px-2 text-xs"
                disabled={busy}
                onClick={() => go(activeId, [])}
              >
                Clear
              </Button>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            {others.map((scenario) => {
              const index = comparedIds.indexOf(scenario.id);
              const selected = index > 0;
              const full = compared.length >= MAX_COMPARED_SCENARIOS - 1;
              return (
                <Button
                  key={scenario.id}
                  size="sm"
                  variant={selected ? "secondary" : "outline"}
                  aria-pressed={selected}
                  disabled={busy || (!selected && full)}
                  onClick={() => toggleCompared(scenario.id)}
                >
                  <span
                    aria-hidden
                    className="size-2 rounded-full"
                    style={{
                      backgroundColor: selected ? scenarioColor(index) : "var(--muted-foreground)",
                    }}
                  />
                  {scenario.name}
                </Button>
              );
            })}
          </div>
          {compared.length >= MAX_COMPARED_SCENARIOS - 1 ? (
            <p className="text-muted-foreground text-xs">
              Up to {MAX_COMPARED_SCENARIOS} scenarios on one chart — beyond that the lines stop
              being readable.
            </p>
          ) : null}
        </div>
      )}

      {scenarioLimit !== null ? (
        <p className="text-muted-foreground text-xs">
          <Badge variant="secondary" className="mr-1.5">
            {namedCount} of {scenarioLimit}
          </Badge>
          named scenarios used on your plan. The base case never counts.
        </p>
      ) : null}

      <Dialog open={dialog !== null} onOpenChange={(open) => !open && setDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{dialog === "rename" ? "Rename scenario" : "New scenario"}</DialogTitle>
            <DialogDescription>
              {dialog === "rename"
                ? "The assumptions in it are unaffected."
                : "It starts empty. Add the assumptions that describe it, or duplicate an existing scenario instead."}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor="scenario-name">Name</Label>
            <Input
              id="scenario-name"
              value={name}
              maxLength={60}
              autoComplete="off"
              placeholder="e.g. Hire in Q4"
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void (dialog === "rename" ? rename() : create());
                }
              }}
            />
          </div>
          <DialogFooter>
            <Button
              onClick={() => void (dialog === "rename" ? rename() : create())}
              disabled={name.trim().length === 0 || isSaving}
            >
              {isSaving && <Loader2Icon className="animate-spin" />}
              {dialog === "rename" ? "Save name" : "Create scenario"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

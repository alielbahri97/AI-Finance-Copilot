"use client";

import { useState } from "react";
import { CheckIcon, CopyIcon } from "lucide-react";
import { toast } from "@/lib/toast";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface ReferralCardProps {
  code: string;
  link: string;
  total: number;
  converted: number;
  rewardDays: number;
  /** The tier the reward is worth in this workspace's edition. */
  rewardPlanName: string;
}

export function ReferralCard({
  code,
  link,
  total,
  converted,
  rewardDays,
  rewardPlanName,
}: ReferralCardProps) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      toast.success("Referral link copied");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Could not copy the link");
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-muted-foreground text-sm">
        Share your link — every referral that upgrades to a paid plan earns you{" "}
        <span className="text-foreground font-medium">
          {rewardDays} days of {rewardPlanName}
        </span>
        , applied automatically.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Input readOnly value={link} className="max-w-md font-mono text-xs" />
        <Button variant="outline" size="sm" onClick={() => void copy()}>
          {copied ? <CheckIcon className="size-4" /> : <CopyIcon className="size-4" />}
          Copy link
        </Button>
      </div>
      <div className="flex flex-wrap gap-8">
        <div>
          <p className="text-muted-foreground text-xs">Your code</p>
          <p className="font-mono text-sm font-semibold">{code}</p>
        </div>
        <div>
          <p className="text-muted-foreground text-xs">Signups</p>
          <p className="text-sm font-semibold tabular-nums">{total}</p>
        </div>
        <div>
          <p className="text-muted-foreground text-xs">Converted</p>
          <p className="text-sm font-semibold tabular-nums">{converted}</p>
        </div>
        <div>
          <p className="text-muted-foreground text-xs">{rewardPlanName} credit earned</p>
          <p className="text-sm font-semibold tabular-nums">{converted * rewardDays} days</p>
        </div>
      </div>
    </div>
  );
}

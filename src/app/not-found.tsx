import Link from "next/link";
import { CompassIcon } from "lucide-react";

import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-4 px-4 text-center">
      <div className="bg-accent text-accent-foreground flex size-14 items-center justify-center rounded-full">
        <CompassIcon className="size-7" />
      </div>
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <p className="text-muted-foreground max-w-md text-sm">
        The page you are looking for does not exist or has been moved.
      </p>
      <Button asChild>
        <Link href="/">Back to home</Link>
      </Button>
    </div>
  );
}

"use client";

import { CTA_COLOR, CTA_COPY } from "@/lib/experiment";
import { cn } from "@/lib/utils";
import { ArrowRight } from "lucide-react";

export function CtaButton() {
  return (
    <button
      id="cta-button"
      type="button"
      style={{ backgroundColor: CTA_COLOR }}
      className={cn(
        "inline-flex items-center justify-center gap-2 px-4.5 py-3",
        "font-display text-[15px] font-bold tracking-wide text-ticket",
        "cursor-pointer border-0 shadow-cta",
        "transition-transform hover:-translate-x-px hover:-translate-y-px hover:shadow-cta-hover",
        "active:translate-x-0.5 active:translate-y-0.5 active:shadow-cta-active",
      )}
      onClick={() => {
        // PostHog capture lands here after the wizard
      }}
    >
      {CTA_COPY}
      <ArrowRight className="size-4" strokeWidth={2.25} />
    </button>
  );
}

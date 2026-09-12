"use client";

import { CTA_COLOR, CTA_COPY, CTA_PLACEMENT } from "@/lib/experiment";
import { cn } from "@/lib/utils";
import { ArrowRight } from "lucide-react";
import posthog from "posthog-js";

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
        if (
          process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN &&
          process.env.NEXT_PUBLIC_POSTHOG_HOST
        ) {
          posthog.capture("waitlist_cta_clicked", {
            cta_placement: CTA_PLACEMENT,
          });
        }
      }}
    >
      {CTA_COPY}
      <ArrowRight className="size-4" strokeWidth={2.25} />
    </button>
  );
}

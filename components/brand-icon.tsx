import { cn } from "@/lib/utils";

const BRAND_ICONS = {
  github: "/brand/github.svg",
  posthog: "/brand/posthog.svg",
} as const;

export function BrandIcon({
  name,
  className,
}: {
  name: keyof typeof BRAND_ICONS;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn("inline-block shrink-0 bg-current", className)}
      style={{
        maskImage: `url(${BRAND_ICONS[name]})`,
        WebkitMaskImage: `url(${BRAND_ICONS[name]})`,
        maskRepeat: "no-repeat",
        WebkitMaskRepeat: "no-repeat",
        maskPosition: "center",
        maskSize: "contain",
        WebkitMaskPosition: "center",
        WebkitMaskSize: "contain",
      }}
    />
  );
}

export function GithubMark({ className }: { className?: string }) {
  return <BrandIcon name="github" className={className} />;
}

export function PosthogMark({ className }: { className?: string }) {
  return <BrandIcon name="posthog" className={className} />;
}

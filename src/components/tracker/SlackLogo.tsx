import { cn } from "@/lib/utils";

interface SlackLogoProps {
  className?: string;
  /** Use a short label for column headers; omit for decorative inline marks. */
  alt?: string;
}

export function SlackLogo({ className, alt = "" }: SlackLogoProps) {
  return (
    <img
      src="/uploads/resources/Slack.png"
      alt={alt}
      width={16}
      height={16}
      className={cn("h-4 w-4 shrink-0 object-contain", className)}
      aria-hidden={alt ? undefined : true}
    />
  );
}

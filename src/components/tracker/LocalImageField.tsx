"use client";

import { useRef, useState, useTransition } from "react";
import {
  uploadCompanyLogoForm,
  uploadPersonProfileForm,
} from "@/server/actions/uploads";
import { Building2, User } from "lucide-react";
import { cn } from "@/lib/utils";

type Variant = "company" | "person";

interface LocalImageFieldProps {
  variant: Variant;
  entityId: string;
  /** Local path `/uploads/...` or production Blob `https://…` URL */
  path: string;
}

export function LocalImageField({ variant, entityId, path }: LocalImageFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function runUpload(file: File) {
    const fd = new FormData();
    if (variant === "company") {
      fd.set("companyId", entityId);
    } else {
      fd.set("personId", entityId);
    }
    fd.set("file", file);

    startTransition(async () => {
      setError(null);
      const run =
        variant === "company"
          ? uploadCompanyLogoForm
          : uploadPersonProfileForm;
      const r = await run(fd);
      if (!r.ok) setError(r.error);
    });
  }

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    runUpload(file);
  }

  function onPickClick() {
    inputRef.current?.click();
  }

  const sizeClass =
    variant === "person"
      ? "h-12 w-12 rounded-full"
      : "h-12 w-12 rounded-md";

  return (
    <div className="inline-flex flex-col gap-1">
      {error && <p className="text-xs text-red-400 max-w-[12rem]">{error}</p>}
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif,image/svg+xml"
        className="sr-only"
        onChange={onFileChange}
        aria-hidden
        tabIndex={-1}
      />
      <button
        type="button"
        disabled={pending}
        onClick={onPickClick}
        aria-label={
          variant === "company"
            ? path
              ? "Change company logo"
              : "Upload company logo"
            : path
              ? "Change profile photo"
              : "Upload profile photo"
        }
        title={path ? "Click to replace image" : "Click to upload image"}
        className={cn(
          "relative shrink-0 cursor-pointer overflow-hidden border border-zinc-700 bg-zinc-900/80 p-0 transition-colors",
          sizeClass,
          "hover:border-zinc-500 hover:bg-zinc-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600",
          "disabled:cursor-not-allowed",
          pending && "pointer-events-none opacity-60"
        )}
      >
        {path ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={path}
            alt=""
            className={cn(
              "h-full w-full cursor-inherit object-cover pointer-events-none",
              variant === "person" ? "rounded-full" : "rounded-[inherit]"
            )}
          />
        ) : variant === "company" ? (
          <span className="flex h-full w-full cursor-inherit items-center justify-center pointer-events-none">
            <Building2 className="h-7 w-7 text-zinc-600" />
          </span>
        ) : (
          <span className="flex h-full w-full cursor-inherit items-center justify-center rounded-full bg-zinc-800 pointer-events-none">
            <User className="h-6 w-6 text-zinc-600" />
          </span>
        )}
        {pending && (
          <span className="absolute inset-0 flex items-center justify-center bg-zinc-950/70 text-[10px] font-medium text-zinc-300">
            …
          </span>
        )}
      </button>
    </div>
  );
}

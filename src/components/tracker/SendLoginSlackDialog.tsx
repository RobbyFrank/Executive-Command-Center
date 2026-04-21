"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { displayInitials } from "@/lib/displayInitials";
import {
  buildLoginSlackMessage,
  LOGIN_SLACK_MESSAGE_PREVIEW_PASSWORD,
} from "@/lib/loginSlackMessage";
import type { Person } from "@/lib/types/tracker";
import {
  createPersonLoginAndSendViaSlack,
  resendPersonLoginViaSlack,
} from "@/server/actions/auth-admin";
import { getSlackThreadPosterPreviewIdentity } from "@/server/actions/slack";
import { SlackDraftMessagePreview } from "./SlackDraftMessagePreview";

type Mode = "create" | "resend";

/**
 * Confirmation dialog for sending a generated login password to a person over Slack.
 * On confirm: server action generates a strong password, saves the bcrypt hash, opens a
 * group DM with Robby + Nadav + the person, and posts the credentials (password wrapped
 * in a code span). Cancel closes without changes.
 */
export function SendLoginSlackDialog({
  open,
  onClose,
  person,
  people,
  mode,
}: {
  open: boolean;
  onClose: () => void;
  person: Person;
  /** Full roster — resolves `@mention` chips in the Slack preview (photos, names). */
  people?: Person[];
  mode: Mode;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [poster, setPoster] = useState<{
    displayName: string;
    avatarSrc: string | null;
  } | null>(null);
  const [previewAt, setPreviewAt] = useState(() => new Date());

  const roster = people ?? [person];

  useEffect(() => {
    if (!open) {
      setPoster(null);
      return;
    }
    setPreviewAt(new Date());
    let cancelled = false;
    void (async () => {
      const id = await getSlackThreadPosterPreviewIdentity();
      if (!cancelled) setPoster(id);
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  const previewText = useMemo(() => {
    const slack = person.slackHandle?.trim();
    if (!slack) return "";
    const email = person.email?.trim() || "(no email set)";
    return buildLoginSlackMessage({
      targetSlackUserId: slack,
      email,
      password: LOGIN_SLACK_MESSAGE_PREVIEW_PASSWORD,
      isResend: mode === "resend",
    });
  }, [person.email, person.slackHandle, mode]);

  if (!open) return null;

  const title =
    mode === "create"
      ? `Create login for ${person.name}?`
      : `Send a new password to ${person.name}?`;

  const description =
    mode === "create" ? (
      <>
        A strong password will be generated and sent to{" "}
        <span className="font-medium text-zinc-300">{person.name}</span> in a
        Slack group DM with you and Nadav. The message will ask them to sign
        in at{" "}
        <span className="font-medium text-zinc-300">admin.mlabs.vc</span>.
      </>
    ) : (
      <>
        A new strong password will be generated and sent to{" "}
        <span className="font-medium text-zinc-300">{person.name}</span> in a
        Slack group DM with you and Nadav. Their previous password will stop
        working immediately.
      </>
    );

  const confirmLabel =
    mode === "create" ? "Create & Send" : "Send new password";

  const photo = person.profilePicturePath?.trim();

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="send-login-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-lg rounded-lg border border-zinc-700 bg-zinc-900 p-5 shadow-xl">
        <div className="flex gap-4">
          <div className="shrink-0 pt-0.5">
            {photo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={photo}
                alt=""
                className="h-14 w-14 rounded-full object-cover ring-2 ring-zinc-800"
              />
            ) : (
              <span
                className="flex h-14 w-14 items-center justify-center rounded-full bg-zinc-800 text-sm font-semibold text-zinc-300 ring-2 ring-zinc-800"
                aria-hidden
              >
                {displayInitials(person.name)}
              </span>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <h2
              id="send-login-title"
              className="text-lg font-semibold text-zinc-100"
            >
              {title}
            </h2>
            <p className="mt-2 text-sm text-zinc-400">{description}</p>
          </div>
        </div>
        <div className="mt-4 rounded-md border border-zinc-800 bg-zinc-950/60 px-3 py-2 text-xs text-zinc-500">
          Email:{" "}
          <span className="font-medium text-zinc-300">
            {person.email?.trim() || "(no email set)"}
          </span>
        </div>
        <div className="mt-4">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">
            Slack message preview
          </p>
          <SlackDraftMessagePreview
            text={previewText}
            people={roster}
            posterDisplayName={poster?.displayName ?? "You"}
            posterAvatarSrc={poster?.avatarSrc ?? null}
            postedAt={previewAt}
            className="text-[15px] leading-relaxed"
          />
          <p className="mt-2 text-[11px] leading-snug text-zinc-600">
            Password shown as dots — a real password is generated when you
            confirm.
          </p>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            className="rounded-md px-3 py-1.5 text-sm text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={pending}
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="button"
            className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={pending}
            onClick={async () => {
              setPending(true);
              try {
                const r =
                  mode === "create"
                    ? await createPersonLoginAndSendViaSlack(person.id)
                    : await resendPersonLoginViaSlack(person.id);
                if (!r.ok) {
                  toast.error(r.error);
                  return;
                }
                toast.success(
                  mode === "create"
                    ? `Login sent to ${person.name} on Slack.`
                    : `New password sent to ${person.name} on Slack.`
                );
                onClose();
                router.refresh();
              } finally {
                setPending(false);
              }
            }}
          >
            {pending ? "Sending…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

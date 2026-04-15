"use client";

import { useMemo, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";
import { AssistantPersonInline } from "./AssistantPersonInline";
import type { AssistantPersonRef } from "@/lib/types/assistant-entities";
import {
  ECC_PERSON_SCHEME,
  findPersonByDisplayName,
  linkifyAssistantPeople,
} from "@/lib/assistantPersonLinkify";
import { cn } from "@/lib/utils";

function flattenNodeText(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(flattenNodeText).join("");
  if (typeof node === "object" && node !== null && "props" in node) {
    const props = (node as { props?: { children?: ReactNode } }).props;
    if (props?.children != null) return flattenNodeText(props.children);
  }
  return "";
}

function isExternalishHref(href: string | undefined): boolean {
  if (href == null || href === "") return true;
  const h = href.trim();
  if (h === "#" || h.startsWith("#")) return true;
  return /^https?:\/\//i.test(h);
}

function createMarkdownComponents(
  people: AssistantPersonRef[],
  peopleById: Map<string, AssistantPersonRef>,
): Components {
  return {
    h1: ({ children }) => (
      <h3 className="mt-3 mb-2 border-b border-zinc-700 pb-1 text-[1.2em] font-semibold text-zinc-100 first:mt-0">
        {children}
      </h3>
    ),
    h2: ({ children }) => (
      <h4 className="mt-3 mb-1.5 text-[1.12em] font-semibold text-zinc-100 first:mt-0">{children}</h4>
    ),
    h3: ({ children }) => (
      <h5 className="mt-2 mb-1 text-[1.06em] font-semibold text-zinc-200 first:mt-0">{children}</h5>
    ),
    p: ({ children }) => <p className="mb-2 last:mb-0 leading-relaxed">{children}</p>,
    ul: ({ children }) => (
      <ul className="mb-2 list-disc space-y-1 pl-5 last:mb-0 marker:text-zinc-500">{children}</ul>
    ),
    ol: ({ children }) => (
      <ol className="mb-2 list-decimal space-y-1 pl-5 last:mb-0 marker:text-zinc-500">{children}</ol>
    ),
    li: ({ children }) => <li className="leading-relaxed [&>p]:mb-1 [&>p]:last:mb-0">{children}</li>,
    strong: ({ children }) => {
      const text = flattenNodeText(children).trim();
      const person =
        text.length >= 2 ? findPersonByDisplayName(people, text) : undefined;
      if (person) {
        return (
          <AssistantPersonInline
            name={person.name}
            profilePicturePath={person.profilePicturePath}
          />
        );
      }
      return <strong className="font-semibold text-zinc-50">{children}</strong>;
    },
    em: ({ children }) => <em className="italic text-zinc-300">{children}</em>,
    a: ({ href, children }) => {
      if (href?.startsWith(ECC_PERSON_SCHEME)) {
        const id = href.slice(ECC_PERSON_SCHEME.length);
        const person = peopleById.get(id);
        const label =
          typeof children === "string"
            ? children
            : Array.isArray(children) &&
                children.length === 1 &&
                typeof children[0] === "string"
              ? String(children[0])
              : person?.name ?? "";
        const name = person?.name ?? label;
        if (!name) {
          return <span className="text-zinc-500">{children}</span>;
        }
        return (
          <AssistantPersonInline
            name={name}
            profilePicturePath={person?.profilePicturePath}
          />
        );
      }

      const linkText = flattenNodeText(children).trim();
      if (linkText.length >= 2 && isExternalishHref(href)) {
        const byLabel = findPersonByDisplayName(people, linkText);
        if (byLabel) {
          return (
            <AssistantPersonInline
              name={byLabel.name}
              profilePicturePath={byLabel.profilePicturePath}
            />
          );
        }
      }

      return (
        <a
          href={href}
          className="font-medium text-emerald-400 underline decoration-emerald-500/50 underline-offset-2 hover:text-emerald-300"
          target="_blank"
          rel="noopener noreferrer"
        >
          {children}
        </a>
      );
    },
    code: ({ className, children, ...props }) => {
      const inline = !className;
      if (inline) {
        return (
          <code
            className="rounded bg-zinc-800 px-1 py-0.5 font-mono text-[0.9em] text-emerald-200/90"
            {...props}
          >
            {children}
          </code>
        );
      }
      return (
        <code className={className} {...props}>
          {children}
        </code>
      );
    },
    pre: ({ children }) => (
      <pre className="mb-2 overflow-x-auto rounded-md border border-zinc-700 bg-zinc-950 p-2 text-[0.85em] last:mb-0">
        {children}
      </pre>
    ),
    blockquote: ({ children }) => (
      <blockquote className="mb-2 border-l-2 border-zinc-600 pl-3 text-zinc-400 italic last:mb-0">
        {children}
      </blockquote>
    ),
    hr: () => <hr className="my-3 border-zinc-700" />,
    table: ({ children }) => (
      <div className="mb-2 overflow-x-auto last:mb-0">
        <table className="w-full min-w-[12rem] border-collapse text-left text-[0.95em]">{children}</table>
      </div>
    ),
    thead: ({ children }) => <thead className="border-b border-zinc-600">{children}</thead>,
    tbody: ({ children }) => <tbody className="divide-y divide-zinc-800">{children}</tbody>,
    tr: ({ children }) => <tr>{children}</tr>,
    th: ({ children }) => (
      <th className="px-2 py-1.5 font-semibold text-zinc-200">{children}</th>
    ),
    td: ({ children }) => (
      <td className="px-2 py-1.5 align-middle text-zinc-300">{children}</td>
    ),
  };
}

export function AssistantMarkdown({
  content,
  className,
  people = [],
}: {
  content: string;
  /** Base text size for the thread (e.g. text-sm … text-xl). Headings scale in `em` from this. */
  className?: string;
  /** Workspace roster — matching names in the markdown are shown with photo + name. */
  people?: AssistantPersonRef[];
}) {
  const peopleById = useMemo(() => {
    const m = new Map<string, AssistantPersonRef>();
    for (const p of people) m.set(p.id, p);
    return m;
  }, [people]);

  const components = useMemo(
    () => createMarkdownComponents(people, peopleById),
    [people, peopleById],
  );

  const processed = useMemo(
    () => (people.length ? linkifyAssistantPeople(content, people) : content),
    [content, people],
  );

  return (
    <div
      className={cn(
        "assistant-markdown leading-relaxed text-zinc-200 [&>*:first-child]:mt-0",
        className ?? "text-sm",
      )}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {processed}
      </ReactMarkdown>
    </div>
  );
}

"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";
import { cn } from "@/lib/utils";

const components: Components = {
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
  strong: ({ children }) => <strong className="font-semibold text-zinc-50">{children}</strong>,
  em: ({ children }) => <em className="italic text-zinc-300">{children}</em>,
  a: ({ href, children }) => (
    <a
      href={href}
      className="font-medium text-emerald-400 underline decoration-emerald-500/50 underline-offset-2 hover:text-emerald-300"
      target="_blank"
      rel="noopener noreferrer"
    >
      {children}
    </a>
  ),
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
  td: ({ children }) => <td className="px-2 py-1.5 align-top text-zinc-300">{children}</td>,
};

export function AssistantMarkdown({
  content,
  className,
}: {
  content: string;
  /** Base text size for the thread (e.g. text-sm … text-xl). Headings scale in `em` from this. */
  className?: string;
}) {
  return (
    <div
      className={cn(
        "assistant-markdown leading-relaxed text-zinc-200 [&>*:first-child]:mt-0",
        className ?? "text-sm"
      )}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  );
}

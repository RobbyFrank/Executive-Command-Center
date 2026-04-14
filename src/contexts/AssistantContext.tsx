"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type AssistantEntityTag = {
  type: "company" | "goal" | "project" | "milestone";
  id: string;
  label: string;
};

type AssistantContextValue = {
  open: boolean;
  entityTag: AssistantEntityTag | null;
  openAssistant: (entity?: AssistantEntityTag) => void;
  closeAssistant: () => void;
  /** Open the panel without a tagged entity (e.g. FAB). Clears any previous tag. */
  toggleFab: () => void;
};

const AssistantContext = createContext<AssistantContextValue | null>(null);

export function AssistantProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [entityTag, setEntityTag] = useState<AssistantEntityTag | null>(null);

  const openAssistant = useCallback((entity?: AssistantEntityTag) => {
    setEntityTag(entity ?? null);
    setOpen(true);
  }, []);

  const closeAssistant = useCallback(() => {
    setEntityTag(null);
    setOpen(false);
  }, []);

  const toggleFab = useCallback(() => {
    setEntityTag(null);
    setOpen((o) => !o);
  }, []);

  const value = useMemo(
    () => ({
      open,
      entityTag,
      openAssistant,
      closeAssistant,
      toggleFab,
    }),
    [open, entityTag, openAssistant, closeAssistant, toggleFab],
  );

  return (
    <AssistantContext.Provider value={value}>
      {children}
    </AssistantContext.Provider>
  );
}

export function useAssistant(): AssistantContextValue {
  const ctx = useContext(AssistantContext);
  if (!ctx) {
    throw new Error("useAssistant must be used within AssistantProvider");
  }
  return ctx;
}

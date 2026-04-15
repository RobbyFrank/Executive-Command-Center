# Autonomy on Roadmap — staged prompts

**Status:** Items below are **implemented** (see `src/lib/closeWatch.ts`, `OwnerSelectDisplay`, `ProjectRow`, `StatusTagFilterMultiSelect`, `tracker-search-filter.ts`).

Earlier work: **Owner filter** autonomy tokens (`autonomy:1` … `autonomy:5`) in `owner-filter.ts` and `OwnerFilterMultiSelect`.

---

## Implemented features (reference)

1. **Owner column signal** — `OwnerSelectDisplay`: amber **ring** on profile photo or **dot** before name when autonomy 1–2; founders excluded.
2. **Close watch** — Computed pill on `ProjectRow` + **status** filter `close_watch` + search tokens; logic in `closeWatch.ts`.
3. **Expanded project** — Hint line above milestones when owner autonomy ≤ 2 (non-founders), using `AUTONOMY_GROUP_LABEL`.

---

## Testing checklist

- `npx tsc --noEmit`
- Roadmap: owner filter, status filters (including Close watch), search for “close watch”.

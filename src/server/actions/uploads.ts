"use server";

import { updateTag } from "next/cache";
import { getRepository } from "@/server/repository";
import { ECC_TRACKER_DATA_TAG } from "@/lib/cache-tags";
import {
  deleteFileIfInUploads,
  saveImageFromRemoteUrl,
  saveUploadedImage,
} from "@/server/imageFiles";
import { discoverCompanyLogoUrl } from "@/server/companyLogoFromWebsite";

const repo = getRepository();

function revalidateTrackerPages() {
  updateTag(ECC_TRACKER_DATA_TAG);
}

export type UploadResult = { ok: true } | { ok: false; error: string };

export async function uploadCompanyLogoForm(formData: FormData): Promise<UploadResult> {
  const companyId = formData.get("companyId");
  const file = formData.get("file");
  if (typeof companyId !== "string" || !companyId) {
    return { ok: false, error: "Missing company" };
  }
  if (!(file instanceof File)) {
    return { ok: false, error: "Missing file" };
  }

  const company = await repo.getCompany(companyId);
  if (!company) {
    return { ok: false, error: "Company not found" };
  }

  const saved = await saveUploadedImage({
    kind: "company",
    entityId: companyId,
    file,
  });
  if (!saved.ok) return saved;

  const prev = company.logoPath;
  if (prev && prev !== saved.webPath) {
    await deleteFileIfInUploads(prev);
  }

  await repo.updateCompany(companyId, { logoPath: saved.webPath });
  revalidateTrackerPages();
  return { ok: true };
}

export async function uploadPersonProfileForm(formData: FormData): Promise<UploadResult> {
  const personId = formData.get("personId");
  const file = formData.get("file");
  if (typeof personId !== "string" || !personId) {
    return { ok: false, error: "Missing person" };
  }
  if (!(file instanceof File)) {
    return { ok: false, error: "Missing file" };
  }

  const person = await repo.getPerson(personId);
  if (!person) {
    return { ok: false, error: "Person not found" };
  }

  const saved = await saveUploadedImage({
    kind: "person",
    entityId: personId,
    file,
  });
  if (!saved.ok) return saved;

  const prev = person.profilePicturePath;
  if (prev && prev !== saved.webPath) {
    await deleteFileIfInUploads(prev);
  }

  await repo.updatePerson(personId, { profilePicturePath: saved.webPath });
  revalidateTrackerPages();
  return { ok: true };
}

/**
 * Best-effort: read the company's saved website, find its homepage logo (apple-touch-icon /
 * og:image / favicon), download it, and store it as the company's `logoPath`.
 *
 * Skips when the company already has a `logoPath` so this never silently overwrites a
 * manually uploaded logo. Failures are returned (not thrown) so callers can show a hint
 * without blocking the website save.
 */
export async function fetchCompanyLogoFromWebsite(
  companyId: string
): Promise<UploadResult> {
  if (typeof companyId !== "string" || !companyId) {
    return { ok: false, error: "Missing company" };
  }

  const company = await repo.getCompany(companyId);
  if (!company) {
    return { ok: false, error: "Company not found" };
  }
  if ((company.logoPath ?? "").trim()) {
    return { ok: false, error: "Company already has a logo" };
  }
  const website = (company.website ?? "").trim();
  if (!website) {
    return { ok: false, error: "Company has no website" };
  }

  const found = await discoverCompanyLogoUrl(website);
  if (!found) {
    return { ok: false, error: "No logo image found on the homepage" };
  }

  const saved = await saveImageFromRemoteUrl({
    kind: "company",
    entityId: companyId,
    imageUrl: found.imageUrl,
  });
  if (!saved.ok) return saved;

  // Re-read the company in case the user uploaded a logo while we were downloading.
  const fresh = await repo.getCompany(companyId);
  if (fresh && (fresh.logoPath ?? "").trim()) {
    await deleteFileIfInUploads(saved.webPath);
    return { ok: false, error: "Logo was set manually before download finished" };
  }

  await repo.updateCompany(companyId, { logoPath: saved.webPath });
  revalidateTrackerPages();
  return { ok: true };
}

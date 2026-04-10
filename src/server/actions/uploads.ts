"use server";

import { revalidatePath } from "next/cache";
import { getRepository } from "@/server/repository";
import {
  deleteFileIfInUploads,
  saveUploadedImage,
} from "@/server/imageFiles";

const repo = getRepository();

function revalidate() {
  revalidatePath("/");
  revalidatePath("/companies");
  revalidatePath("/team");
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
  revalidate();
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
  revalidate();
  return { ok: true };
}

"use server";

import { authenticate, logout } from "@/server/auth";
import { redirect } from "next/navigation";

export type LoginState = { error?: string };

export async function loginAction(
  _prevState: LoginState | null,
  formData: FormData
): Promise<LoginState> {
  const email = formData.get("email") as string;
  const password = formData.get("password") as string;

  if (!email?.trim() || !password) {
    return { error: "Email and password are required" };
  }

  const result = await authenticate(email, password);
  if (!result.success) {
    return { error: "Invalid email or password" };
  }

  redirect("/");
}

export async function logoutAction() {
  await logout();
  redirect("/login");
}

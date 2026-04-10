"use server";

import { authenticate, logout } from "@/server/auth";
import { redirect } from "next/navigation";

export type LoginState = { error?: string };

export async function loginAction(
  _prevState: LoginState | null,
  formData: FormData
): Promise<LoginState> {
  const username = formData.get("username") as string;
  const password = formData.get("password") as string;

  if (!username || !password) {
    return { error: "Username and password are required" };
  }

  const result = await authenticate(username, password);
  if (!result.success) {
    return { error: "Invalid credentials" };
  }

  redirect("/");
}

export async function logoutAction() {
  await logout();
  redirect("/login");
}

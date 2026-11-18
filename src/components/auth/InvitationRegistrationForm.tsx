"use client";

import { useState } from "react";
import Link from "next/link";
import { authClient } from "@/lib/auth-client";

type Props = {
  email: string;
  invitationId: string;
};

export default function InvitationRegistrationForm({
  email,
  invitationId,
}: Props) {
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [success, setSuccess] = useState(false);

  async function handleRegister(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setSuccess(false);

    if (password.length < 8) {
      setMessage("Password must be at least 8 characters.");
      return;
    }

    if (password !== confirmPassword) {
      setMessage("Passwords do not match.");
      return;
    }

    setLoading(true);

    try {
      const result = await authClient.signUp.email({
        name: name.trim(),
        email,
        password,
        callbackURL: `/accept-invitation/${invitationId}`,
      });

      if (result.error) {
        setMessage(result.error.message || "Unable to create your account.");
        return;
      }

      setSuccess(true);
      setMessage(
        "Account created successfully. Please check your email and verify your email address. After verification, return to this invitation link to join the organization.",
      );

      setPassword("");
      setConfirmPassword("");
    } catch (error) {
      console.error("Invitation registration failed:", error);
      setMessage("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h2 className="text-xl font-semibold">Create your account</h2>
        <p className="text-sm text-neutral-500">
          Create an account to accept your organization invitation.
        </p>
      </div>

      <form onSubmit={handleRegister} className="space-y-4">
        <div className="space-y-2">
          <label htmlFor="name" className="text-sm font-medium">
            Full name
          </label>
          <input
            id="name"
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Your full name"
            required
            maxLength={100}
            autoComplete="name"
            className="w-full rounded-lg border px-4 py-3 outline-none focus:ring-2 focus:ring-black"
          />
        </div>

        <div className="space-y-2">
          <label htmlFor="email" className="text-sm font-medium">
            Email address
          </label>
          <input
            id="email"
            type="email"
            value={email}
            readOnly
            className="w-full rounded-lg border bg-neutral-100 px-4 py-3 text-neutral-600"
          />
          <p className="text-xs text-neutral-500">
            This is the email address that received the invitation.
          </p>
        </div>

        <div className="space-y-2">
          <label htmlFor="password" className="text-sm font-medium">
            Create password
          </label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="At least 8 characters"
            required
            minLength={8}
            autoComplete="new-password"
            className="w-full rounded-lg border px-4 py-3 outline-none focus:ring-2 focus:ring-black"
          />
        </div>

        <div className="space-y-2">
          <label htmlFor="confirmPassword" className="text-sm font-medium">
            Confirm password
          </label>
          <input
            id="confirmPassword"
            type="password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            placeholder="Re-enter your password"
            required
            minLength={8}
            autoComplete="new-password"
            className="w-full rounded-lg border px-4 py-3 outline-none focus:ring-2 focus:ring-black"
          />
        </div>

        <button
          type="submit"
          disabled={loading || success}
          className="w-full rounded-lg bg-black px-5 py-3 text-white transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading
            ? "Creating account..."
            : success
              ? "Account created"
              : "Create account"}
        </button>
      </form>

      {message && (
        <p
          role="status"
          className={`rounded-lg p-3 text-sm ${
            success ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"
          }`}
        >
          {message}
        </p>
      )}

      <div className="border-t pt-4 text-center text-sm text-neutral-500">
        Already have an account?{" "}
        <Link href="/sign-in" className="font-medium text-black underline">
          Sign in
        </Link>
      </div>
    </div>
  );
}

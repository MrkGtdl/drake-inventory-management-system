import Link from "next/link";
import { headers } from "next/headers";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import AcceptInvitationButton from "@/components/auth/AcceptInvitationButton";
import InvitationRegistrationForm from "@/components/auth/InvitationRegistrationForm";

type Props = {
  params: Promise<{
    id: string;
  }>;
};

export default async function AcceptInvitationPage({ params }: Props) {
  const { id } = await params;

  const invitation = await prisma.invitation.findUnique({
    where: { id },
    select: {
      email: true,
      role: true,
      status: true,
      expiresAt: true,
      organization: {
        select: {
          name: true,
        },
      },
    },
  });

  if (
    !invitation ||
    invitation.status !== "pending" ||
    invitation.expiresAt <= new Date()
  ) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <div className="w-full max-w-md space-y-4 text-center">
          <h1 className="text-2xl font-semibold">Invitation unavailable</h1>
          <p className="text-neutral-500">
            This invitation is invalid, expired, or has already been used.
          </p>
        </div>
      </main>
    );
  }

  const session = await auth.api.getSession({
    headers: await headers(),
  });

  // No account session: allow the invited user to register.
  if (!session) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <div className="w-full max-w-md space-y-6 rounded-xl border p-8">
          <div className="space-y-2">
            <p className="text-sm text-neutral-500">Organization invitation</p>

            <h1 className="text-2xl font-semibold">
              Join {invitation.organization.name}
            </h1>

            <p className="text-neutral-500">
              You have been invited as a <strong>{invitation.role}</strong>.
            </p>
          </div>

          <InvitationRegistrationForm
            email={invitation.email}
            invitationId={id}
          />
        </div>
      </main>
    );
  }

  // Ensure the signed-in account matches the invited email.
  if (session.user.email.toLowerCase() !== invitation.email.toLowerCase()) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <div className="w-full max-w-md space-y-4 text-center">
          <h1 className="text-2xl font-semibold">Account mismatch</h1>

          <p className="text-neutral-500">
            This invitation was sent to {invitation.email}. You are currently
            signed in as {session.user.email}. Please sign in with the invited
            account.
          </p>

          <Link
            href="/sign-in"
            className="inline-block rounded-lg bg-black px-5 py-3 text-white"
          >
            Sign in with another account
          </Link>
        </div>
      </main>
    );
  }

  // Require email verification before accepting.
  if (!session.user.emailVerified) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <div className="w-full max-w-md space-y-4 text-center">
          <h1 className="text-2xl font-semibold">Verify your email</h1>

          <p className="text-neutral-500">
            Please verify {invitation.email} before accepting this organization
            invitation. Check your email for the verification link.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-md space-y-6 rounded-xl border p-8">
        <div className="space-y-2">
          <p className="text-sm text-neutral-500">Organization invitation</p>

          <h1 className="text-2xl font-semibold">
            Join {invitation.organization.name}
          </h1>

          <p className="text-neutral-500">
            You have been invited as a <strong>{invitation.role}</strong>.
          </p>
        </div>

        <AcceptInvitationButton invitationId={id} />
      </div>
    </main>
  );
}

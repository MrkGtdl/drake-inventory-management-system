import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { organization } from "better-auth/plugins";
import nodemailer from "nodemailer";

import { prisma } from "@/lib/prisma";
import { ac, owner, admin, member } from "@/lib/permissions";

// Mailtrap email configuration
async function sendAppEmail({
  to,
  subject,
  text,
}: {
  to: string;
  subject: string;
  text: string;
}) {
  const host = process.env.MAILTRAP_HOST;
  const port = Number(process.env.MAILTRAP_PORT || 2525);
  const user = process.env.MAILTRAP_USER;
  const pass = process.env.MAILTRAP_PASS;
  const from = process.env.MAIL_FROM || "Inventory System <hello@example.com>";

  if (!host || !user || !pass) {
    throw new Error("Mailtrap SMTP environment variables are missing.");
  }

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: {
      user,
      pass,
    },
  });

  const result = await transporter.sendMail({
    from,
    to,
    subject,
    text,
  });

  console.info("Email sent successfully:", {
    to,
    subject,
    messageId: result.messageId,
  });
}

export const auth = betterAuth({
  database: prismaAdapter(prisma, {
    provider: "postgresql",
  }),

  // Restore the user's last selected organization
  // whenever a new session is created.
  databaseHooks: {
    session: {
      create: {
        before: async (session) => {
          const user = await prisma.user.findUnique({
            where: {
              id: session.userId,
            },
            select: {
              lastActiveOrganizationId: true,
            },
          });

          const organizationId = user?.lastActiveOrganizationId;

          if (!organizationId) {
            return {
              data: session,
            };
          }

          // Verify that the user is still a member.
          const membership = await prisma.member.findFirst({
            where: {
              userId: session.userId,
              organizationId,
            },
            select: {
              organizationId: true,
            },
          });

          return {
            data: {
              ...session,
              activeOrganizationId: membership?.organizationId ?? null,
            },
          };
        },
      },
    },
  },

  user: {
    additionalFields: {
      platformRole: {
        type: ["user", "superadmin"],
        required: false,
        defaultValue: "user",
        input: false,
      },
    },
  },

  emailAndPassword: {
    enabled: true,
    revokeSessionsOnPasswordReset: true,

    async sendResetPassword({ user, url }) {
      await sendAppEmail({
        to: user.email,
        subject: "Reset your Inventory System password",
        text: [
          `Hello ${user.name || "User"},`,
          "",
          "We received a request to reset your password.",
          "",
          "Use the link below to reset your password:",
          url,
          "",
          "If you did not request this, you can ignore this email.",
        ].join("\n"),
      });
    },
  },

  emailVerification: {
    sendOnSignUp: true,

    async sendVerificationEmail({ user, url }) {
      await sendAppEmail({
        to: user.email,
        subject: "Verify your Inventory System email",
        text: [
          `Hello ${user.name || "User"},`,
          "",
          "Thank you for registering with Inventory System.",
          "",
          "Please verify your email address using this link:",
          url,
          "",
          "If you did not create this account, you can ignore this email.",
        ].join("\n"),
      });
    },
  },

  plugins: [
    organization({
      ac,
      roles: {
        owner,
        admin,
        member,
      },

      requireEmailVerificationOnInvitation: true,

      dynamicAccessControl: {
        enabled: true,
        maximumRolesPerOrganization: 25,
      },

      // Initialize inventory resources when an organization is created.
      organizationHooks: {
        afterCreateOrganization: async ({ organization }) => {
          await prisma.$transaction(async (tx) => {
            // Create the default warehouse.
            await tx.warehouse.upsert({
              where: {
                organizationId_code: {
                  organizationId: organization.id,
                  code: "MAIN",
                },
              },
              create: {
                organizationId: organization.id,
                name: "Main Warehouse",
                code: "MAIN",
                description: "Default inventory storage location",
                isDefault: true,
                isActive: true,
              },
              update: {},
            });

            // Initialize the organization's SKU counter.
            await tx.skuCounter.upsert({
              where: {
                organizationId: organization.id,
              },
              create: {
                organizationId: organization.id,
                lastValue: 0,
              },
              update: {},
            });
          });
        },
      },

      // Send organization invitation through Mailtrap.
      async sendInvitationEmail(data) {
        const baseURL = process.env.BETTER_AUTH_URL;

        if (!baseURL) {
          throw new Error("BETTER_AUTH_URL is not configured.");
        }

        const inviteLink = new URL(
          `/accept-invitation/${data.id}`,
          baseURL,
        ).toString();

        await sendAppEmail({
          to: data.email,
          subject: `Invitation to join ${data.organization.name}`,
          text: [
            `Hello,`,
            "",
            `You have been invited to join ${data.organization.name}.`,
            `Your assigned role is: ${data.role}.`,
            "",
            "Open the link below to create your account or sign in and accept the invitation:",
            inviteLink,
            "",
            "If you were not expecting this invitation, you can ignore this email.",
          ].join("\n"),
        });
      },
    }),
  ],
});

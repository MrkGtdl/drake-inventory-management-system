import { createAccessControl } from "better-auth/plugins/access";
import {
  defaultStatements,
  ownerAc,
  adminAc,
  memberAc,
} from "better-auth/plugins/organization/access";

export const statement = {
  ...defaultStatements,

  dashboard: ["read"],
  user: ["read", "create", "update", "delete"],
  role: ["read", "create", "update", "delete"],
  auditLog: ["read"],
  setting: ["read", "update"],
  notification: ["read", "update", "delete"],
  invitation: ["read", "create", "cancel"],

  product: ["read", "create", "update", "delete"],
  category: ["read", "create", "update", "delete"],
  warehouse: ["read", "create", "update", "delete"],
  inventory: ["read", "update"],
  stockMovement: ["read", "create"],
  supplier: ["read", "create", "update", "delete"],
} as const;

export const ac = createAccessControl(statement);

export const owner = ac.newRole({
  ...ownerAc.statements,
  dashboard: ["read"],
  user: ["read", "create", "update", "delete"],
  role: ["read", "create", "update", "delete"],
  auditLog: ["read"],
  setting: ["read", "update"],
  notification: ["read", "update", "delete"],
  invitation: ["read", "create", "cancel"],

  product: ["read", "create", "update", "delete"],
  category: ["read", "create", "update", "delete"],
  warehouse: ["read", "create", "update", "delete"],
  inventory: ["read", "update"],
  stockMovement: ["read", "create"],
  supplier: ["read", "create", "update", "delete"],
});

export const admin = ac.newRole({
  ...adminAc.statements,
  dashboard: ["read"],
  user: ["read", "create", "update", "delete"],
  role: ["read", "create", "update", "delete"],
  auditLog: ["read"],
  setting: ["read", "update"],
  notification: ["read", "update", "delete"],
  invitation: ["read", "create", "cancel"],

  product: ["read", "create", "update", "delete"],
  category: ["read", "create", "update", "delete"],
  warehouse: ["read", "create", "update", "delete"],
  inventory: ["read", "update"],
  stockMovement: ["read", "create"],
  supplier: ["read", "create", "update", "delete"],
});

export const member = ac.newRole({
  ...memberAc.statements,
  dashboard: ["read"],
  user: ["read"],
  role: ["read"],
  auditLog: [],
  setting: [],
  notification: ["read", "update"],
  invitation: [],

  product: ["read"],
  category: ["read"],
  warehouse: ["read"],
  inventory: ["read"],
  stockMovement: ["read"],
  supplier: ["read"],
});

export type AppPermissions = {
  [Resource in keyof typeof statement]?: Array<
    (typeof statement)[Resource][number]
  >;
};

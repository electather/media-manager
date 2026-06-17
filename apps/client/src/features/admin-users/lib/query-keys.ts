export const adminUsersKeys = {
  all: ["admin-users"] as const,
  list: () => [...adminUsersKeys.all, "list"] as const,
  detail: (id: string) => [...adminUsersKeys.all, "detail", id] as const,
} as const;

export const adminInvitesKeys = {
  all: ["admin-invites"] as const,
  list: () => [...adminInvitesKeys.all, "list"] as const,
} as const;

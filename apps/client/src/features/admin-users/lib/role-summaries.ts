import { m } from "@/paraglide/messages";

export interface RoleSummary {
  id: string;
  name: string;
  description: string;
}

// Mirrors the seed roles in features/admin-roles. Backend exposes neither a
// list-roles endpoint nor a create-role endpoint yet, so the role select in
// the invite drawer and the user-detail role picker fall back to this static
// list. Once `GET /api/admin/roles` lands, replace this with a fetched list.
export function roleSummaries(): RoleSummary[] {
  return [
    {
      id: "role_admin",
      name: m.admin_roles_seed_admin_name(),
      description: m.admin_roles_seed_admin_description(),
    },
    {
      id: "role_member",
      name: m.admin_roles_seed_member_name(),
      description: m.admin_roles_seed_member_description(),
    },
    {
      id: "role_viewer",
      name: m.admin_roles_seed_viewer_name(),
      description: m.admin_roles_seed_viewer_description(),
    },
  ];
}

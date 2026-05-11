export interface RoleRecord {
  id: string;
  name: string;
  description: string;
  isSystem: boolean;
  /** Either `"*"` (admin: bypass) or a concrete permission key list. */
  permissions: "*" | string[];
}

/** Compact user reference used by the role detail's members list. */
export interface RoleMember {
  id: string;
  name: string;
  email: string;
}

---
"@nama/server": patch
---

Closed a privilege-escalation gap: the admin user-creation and role-assignment endpoints now reject any role granting admin-tier permissions, not just the built-in admin role.

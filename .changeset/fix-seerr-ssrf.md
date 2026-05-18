---
"@ent-mcp/plugin-seerr": patch
---

Fixed SSRF vulnerability where the admin-configured Seerr base URL bypassed blocked-hostname checks due to a wildcard allowedHosts declaration.

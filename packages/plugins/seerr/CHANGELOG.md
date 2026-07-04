# @nama/plugin-seerr

## 0.3.3

### Patch Changes

- d97366e: Fixed an unbounded pagination loop in the Seerr plugin that could run indefinitely if the remote API never returned a short page.
- Updated dependencies [3dae961]
  - @nama/plugin-sdk@0.6.0

## 0.3.2

### Patch Changes

- 0362593: Fixed Seerr password being persisted in plaintext after authentication.
- e38746e: Fixed Seerr request listings being rejected when upstream rows omitted seasons, target, or profile metadata.
- 68c85b3: Fixed `requestStatusSync` timing out against slow Seerr instances by widening its per-row budget to 120s.
- 6207756: Truncated upstream Seerr error body in plugin error messages to prevent potential information leakage from verbose server responses.
- b45d0c6: Fixed path-traversal vulnerability where user-supplied IDs were not validated before interpolation into Seerr API paths.
- 95bfbbe: Fixed SSRF vulnerability where the admin-configured Seerr base URL bypassed blocked-hostname checks due to a wildcard allowedHosts declaration.
- 0c472a1: Enforced HTTPS for the Seerr authentication endpoint URL to prevent credentials being sent in cleartext.
- Updated dependencies [1b1c614]
- Updated dependencies [e38746e]
- Updated dependencies [68c85b3]
- Updated dependencies [adaf118]
  - @nama/plugin-sdk@0.5.0

## 0.3.1

### Patch Changes

- @nama/plugin-sdk@0.4.1

## 0.3.0

### Minor Changes

- 6831fb5: Extended request listings with season numbers and request destination labels.
- 6831fb5: Surfaced configured Radarr and Sonarr servers and their quality profiles when submitting requests.

### Patch Changes

- Updated dependencies [6831fb5]
- Updated dependencies [6831fb5]
  - @nama/plugin-sdk@0.4.0

## 0.2.1

### Patch Changes

- Updated dependencies [a31896c]
- Updated dependencies [2b70a07]
  - @nama/plugin-sdk@0.3.0

## 0.2.0

### Minor Changes

- e9b915f: Each built-in integration (Trakt, TMDB, TVDB, Seerr, Plex, Jellyfin) is now its own package, so each one can be released and tracked on its own.

### Patch Changes

- Updated dependencies [986fb74]
- Updated dependencies [fc371c1]
- Updated dependencies [e9b915f]
- Updated dependencies [b55a04b]
- Updated dependencies [e9b915f]
- Updated dependencies [e340f9d]
  - @nama/plugin-sdk@0.2.0

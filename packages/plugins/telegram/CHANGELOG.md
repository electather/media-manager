# @nama/plugin-telegram

## 0.2.5

### Patch Changes

- Updated dependencies [3dae961]
  - @nama/plugin-sdk@0.6.0

## 0.2.4

### Patch Changes

- Updated dependencies [1b1c614]
- Updated dependencies [e38746e]
- Updated dependencies [68c85b3]
- Updated dependencies [adaf118]
  - @nama/plugin-sdk@0.5.0

## 0.2.3

### Patch Changes

- a3e4fc3: Made the Telegram "Test" actually send a short labelled message to the target chat after the getMe/getChat probes pass — a passing probe alone cannot prove the bot has write permission, so a real send is the only end-to-end signal. Added structured logs on `deliver` and `testDelivery` (start, success, failure with telegram's description) so misconfigurations are easy to pinpoint in the server output. Chat ids are redacted to the last 4 chars in logs.
- a3e4fc3: Fixed the Telegram channel test, which previously reported success whenever the bot token was valid even if the chat id was wrong or the bot was not a member of the chat. The test now also probes `getChat` and surfaces Telegram's own description (e.g. "chat not found", "bot was kicked") when the chat is unreachable.
- Updated dependencies [ce2b0c5]
  - @nama/shared@0.1.2
  - @nama/plugin-sdk@0.4.1

## 0.2.2

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

- 6cc984c: Added the Telegram notification provider so you can receive alerts on Telegram.

### Patch Changes

- Updated dependencies [db2b076]
- Updated dependencies [986fb74]
- Updated dependencies [fc371c1]
- Updated dependencies [e9b915f]
- Updated dependencies [b55a04b]
- Updated dependencies [e9b915f]
- Updated dependencies [e340f9d]
  - @nama/shared@0.1.1
  - @nama/plugin-sdk@0.2.0

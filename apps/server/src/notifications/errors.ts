/** Base error class for notification-related failures. */
export class NotificationError extends Error {
  readonly code: string;
  constructor(message: string, code: string) {
    super(message);
    this.code = code;
    this.name = "NotificationError";
  }
}

/**
 * Thrown when a delivery's `service_connections.user_config` column fails JSON
 * parse. Surfaces a precise `config_parse_failed` error code so admins see why
 * the row was marked failed instead of a cryptic upstream 4xx.
 */
export class UserConfigParseError extends NotificationError {
  constructor(message: string) {
    super(message, "config_parse_failed");
    this.name = "UserConfigParseError";
  }
}

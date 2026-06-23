import { z } from "zod";
import { defineCapability, method } from "../define";
import { mediaType, MIN } from "./shared-schemas";

const statusEnum = z.enum(["available", "requested", "processing", "unavailable", "unknown"]);

export const MediaRequestV1 = defineCapability({
  id: "mediaRequest",
  version: "v1",
  strategy: { kind: "single" },
  scope: "user",
  defaultCacheTtlSec: 1 * MIN,
  negativeCacheTtlSec: 30,
  defaultTimeoutMs: 15_000,
  methods: {
    checkAvailability: method(
      z.object({ tmdbId: z.string(), type: mediaType }),
      z.object({ status: statusEnum }),
    ),
    createRequest: method(
      z.object({
        tmdbId: z.string(),
        type: mediaType,
        seasons: z.string().optional(),
        targetId: z.string().optional(),
        profileId: z.string().optional(),
      }),
      z.object({
        success: z.boolean(),
        requestId: z.string().optional(),
        message: z.string().optional(),
      }),
      { invalidates: ["mediaRequest@v1"] },
    ),
    listTargets: method(
      z.object({ type: mediaType }),
      z.object({
        targets: z.array(
          z.object({
            targetId: z.string().regex(/^[A-Za-z0-9_-]+$/),
            label: z.string(),
            exposesProfiles: z.boolean(),
            defaultProfileId: z.string().nullable(),
            profiles: z.array(
              z.object({
                id: z.string(),
                label: z.string(),
                detail: z.string().optional(),
              }),
            ),
          }),
        ),
      }),
      { optional: true },
    ),
    listRequests: method(
      z.object({}),
      z.array(
        z.object({
          id: z.string(),
          tmdbId: z.string(),
          type: mediaType,
          title: z.string(),
          status: z.enum(["pending", "approved", "processing", "available", "failed"]),
          createdAt: z.string(),
          // Upstream omits these on movie rows and unrouted requests; default to uniform shape.
          seasons: z.array(z.number().int().nonnegative()).default([]),
          targetLabel: z.string().nullable().default(null),
          profileLabel: z.string().nullable().default(null),
        }),
      ),
    ),
    cancelRequest: method(
      z.object({ requestId: z.string() }),
      z.object({ ok: z.boolean(), message: z.string().optional() }),
      { invalidates: ["mediaRequest@v1"] },
    ),
    // Bulk variant for home feed dataloader: pass composite ids ("movie:550"/"tv:1396"),
    // get same strings back as keys in statuses map. Plugins skipping this fallback to "unknown".
    getStatusBatch: method(
      z.object({ ids: z.array(z.string()) }),
      z.object({ statuses: z.record(z.string(), statusEnum) }),
      { optional: true },
    ),
  },
  mcpTools: [
    {
      name: "ent_request",
      description: "Request a movie or TV show download, or check status of existing requests.",
      inputSchema: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: ["create", "status"],
            default: "status",
          },
          id: {
            type: "string",
            description:
              "TMDB ID prefixed with type, e.g. 'movie:550'. Required when action=create.",
          },
          seasons: {
            type: "string",
            description: "For TV: 'all', 'latest', or comma-separated like '1,2,3'",
          },
          target: {
            type: "string",
            description:
              "Connection ID when you have multiple request providers. Omit to use default.",
          },
        },
        additionalProperties: false,
      },
      outputSchema: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["create", "status"] },
          target: {
            type: "object",
            properties: {
              connection_id: { type: "string" },
              display_name: { type: ["string", "null"] },
            },
            required: ["connection_id", "display_name"],
            additionalProperties: false,
          },
          success: { type: "boolean" },
          request_id: { type: "string" },
          message: { type: "string" },
          requests: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                tmdb_id: { type: "string" },
                type: { type: "string", enum: ["movie", "tv"] },
                title: { type: "string" },
                status: {
                  type: "string",
                  enum: ["pending", "approved", "processing", "available", "failed"],
                },
                created_at: { type: "string" },
                connection_id: { type: "string" },
              },
              required: ["id", "tmdb_id", "type", "title", "status", "created_at", "connection_id"],
              additionalProperties: false,
            },
          },
        },
        required: ["action"],
        additionalProperties: false,
      },
      requiredScopes: ["mcp.write.request"],
      annotations: { destructiveHint: false, idempotentHint: false },
      handlerKey: "ent_request",
    },
  ],
});

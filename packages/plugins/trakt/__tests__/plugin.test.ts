import { it, expect } from "vite-plus/test";
import { validatePluginModule } from "@ent-mcp/plugin-sdk";
import traktPlugin from "../src/plugin";

it("validates against the manifest + capability catalog", async () => {
  expect(validatePluginModule(traktPlugin)).toBeDefined();
});

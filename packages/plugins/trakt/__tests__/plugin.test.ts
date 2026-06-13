import { it, expect } from "vite-plus/test";
import { validatePluginModule } from "@nama/plugin-sdk";
import traktPlugin from "../src/plugin";

it("validates against the manifest + capability catalog", async () => {
  expect(validatePluginModule(traktPlugin)).toBeDefined();
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { projectSchema, productSchema } from "../src/lib/validation/projects";
const project = { name: "Synthetic brand", website: "https://example.invalid", summary: "", usp: "", brandStyle: "", referenceUrls: [] };
test("project URLs reject javascript/data protocols and blank names", () => {
  assert.equal(projectSchema.safeParse(project).success, true);
  assert.equal(projectSchema.safeParse({ ...project, name: "  " }).success, false);
  assert.equal(projectSchema.safeParse({ ...project, website: "javascript:alert(1)" }).success, false);
  assert.equal(projectSchema.safeParse({ ...project, referenceUrls: ["data:text/html,test"] }).success, false);
  assert.equal(productSchema.safeParse({ name: "test", features: "", url: "ftp://example.invalid" }).success, false);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { uploadIntentSchema } from "../src/lib/validation/assets";
const valid = { assetId: null, productId: null, name: "Synthetic image", category: "product_image", originalName: "product.png", declaredMime: "image/png", expectedSize: 100 };
test("upload metadata rejects unsupported types, unsafe paths and format-specific size excess", () => {
  assert.equal(uploadIntentSchema.safeParse(valid).success, true);
  for (const invalid of [{ originalName: "../product.png" }, { originalName: "x.pdf" }, { expectedSize: 0 }, { expectedSize: 10 * 1024 * 1024 + 1 }, { declaredMime: "text/html" }, { declaredMime: "video/mp4", originalName: "video.mp4", expectedSize: 50 * 1024 * 1024 + 1 }]) assert.equal(uploadIntentSchema.safeParse({ ...valid, ...invalid }).success, false);
});

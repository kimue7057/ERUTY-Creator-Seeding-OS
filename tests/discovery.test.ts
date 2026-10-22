import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { observationInput, appendLogInput, discoveryHash } from "../src/lib/discovery/contracts";
import { contentUrl, profileIdentity, searchSourceUrl } from "../src/lib/discovery/urls";
import { observationSample, logSample } from "./discovery-samples";
test("discovery URLs keep SNS origin/identity, normalize Unicode handles and strip credentials/tracking", () => {
  assert.equal(profileIdentity("instagram", "https://instagram.com/ERUTY_SYNTHETIC/?utm_source=test#section").url, "https://www.instagram.com/eruty_synthetic/");
  assert.equal(profileIdentity("youtube", "https://www.youtube.com/@合成テスト").url, "https://www.youtube.com/@%E5%90%88%E6%88%90%E3%83%86%E3%82%B9%E3%83%88");
  assert.equal(contentUrl("youtube", "https://youtu.be/Synthet1c_1?si=track"), "https://www.youtube.com/watch?v=Synthet1c_1");
  for (const url of ["http://www.instagram.com/example/", "https://www.instagram.com.evil.invalid/example/", "https://user:pass@www.instagram.com/example/", "https://www.instagram.com/explore/", "https://www.instagram.com/%2fadmin/", "https://www.instagram.com:444/example/"]) assert.throws(() => profileIdentity("instagram", url));
  assert.throws(() => contentUrl("youtube", "https://www.youtube.com/redirect?q=https://evil.invalid"));
  assert.throws(() => searchSourceUrl("tiktok", "https://www.google.com/search?q=test"));
  assert.equal(searchSourceUrl("youtube", "https://www.youtube.com/results?search_query=synthetic&access_token=secret"), "https://www.youtube.com/results?search_query=synthetic");
});
test("discovery observations preserve hidden/rounded metrics and reject fabricated scope/status/source/time", () => {
  const sample = observationSample(randomUUID(), "a".repeat(64), randomUUID());
  assert.equal(observationInput.parse(sample).profile.country.code, "JP");
  assert.throws(() => observationInput.parse({ ...sample, verification_state: "direct_sns_verified" }));
  assert.throws(() => observationInput.parse({ ...sample, organization_id: randomUUID() }));
  assert.throws(() => observationInput.parse({ ...sample, profile: { ...sample.profile, observed_at: new Date(Date.now() + 600000).toISOString() } }));
  assert.throws(() => observationInput.parse({ ...sample, profile: { ...sample.profile, metrics: [{ ...sample.profile.metrics[0], precision: "hidden" }] } }));
  assert.equal(observationInput.parse({ ...sample, profile: { ...sample.profile, metrics: [{ ...sample.profile.metrics[0], precision: "hidden", value: null }] } }).profile.metrics[0].value, null);
  assert.throws(() => appendLogInput.parse({ ...logSample(randomUUID()), event_type: "captcha", outcome: "success" }));
  assert.equal(discoveryHash({ b: null, a: 1 }), discoveryHash({ a: 1, b: null }));
});

import { describe, it, expect } from "vitest";
import { canonicalizeUrl, resultIdFor } from "../src/repo.js";

describe("repo URL canonicalization (dedup keying)", () => {
  const clean = "https://www.trossenrobotics.com/post/robotics-arms-components";

  it("strips tracking query params so UTM variants map to one key", () => {
    const utm = clean + "?utm_source=google&utm_medium=cpc&gclid=abc123";
    expect(canonicalizeUrl(utm)).toBe("https://trossenrobotics.com/post/robotics-arms-components");
    expect(resultIdFor(utm)).toBe(resultIdFor(clean));
  });

  it("ignores a trailing slash, a leading www., and the hash fragment", () => {
    expect(resultIdFor(clean + "/")).toBe(resultIdFor(clean));
    expect(resultIdFor(clean + "#section")).toBe(resultIdFor(clean));
    expect(resultIdFor("https://trossenrobotics.com/post/robotics-arms-components")).toBe(resultIdFor(clean));
  });

  it("keeps genuinely different articles under different keys", () => {
    const other = "https://www.trossenrobotics.com/post/ai-robotics-deployment";
    expect(resultIdFor(other)).not.toBe(resultIdFor(clean));
  });
});

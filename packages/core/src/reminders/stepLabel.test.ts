import { describe, expect, it } from "vitest";
import { describeStep } from "./stepLabel";

describe("describeStep", () => {
  it.each([
    ["J-30", { kind: "before", days: 30 }],
    ["J-7", { kind: "before", days: 7 }],
    ["J0", { kind: "on" }],
    ["J+0", { kind: "on" }],
    ["J+3", { kind: "after", days: 3 }],
    ["J45", { kind: "after", days: 45 }],
    ["MANUAL", { kind: "manual" }],
    ["PROMISE_BROKEN", { kind: "promise" }],
    ["RAPPEL_RDV", { kind: "other", key: "RAPPEL_RDV" }],
  ] as const)("%s", (key, expected) => {
    expect(describeStep(key)).toEqual(expected);
  });
});

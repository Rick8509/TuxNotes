import { describe, expect, it } from "vitest";
import { languageName } from "./spelling.svelte";

describe("spelling language names", () => {
  it("names dictionaries in the interface language", () => {
    expect(languageName("en_US", "en")).toBe("English (United States)");
    expect(languageName("de_DE", "en")).toBe("German (Germany)");
    expect(languageName("pt_BR", "en")).toBe("Portuguese (Brazil)");
    expect(languageName("fr", "en")).toBe("French");
    expect(languageName("de_DE", "de")).toBe("Deutsch (Deutschland)");
  });

  it("shows the code for names it doesn't know", () => {
    expect(languageName("de_DE_frami", "en")).toBe("German (Germany), frami");
    expect(languageName("sr_Latn_RS", "en")).toBe("Serbian (Latin, Serbia)");
    expect(languageName("xx_YY_weird_thing", "en")).toBe("xx_YY_weird_thing");
    expect(languageName("", "en")).toBe("");
  });
});

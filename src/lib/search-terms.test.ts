import { describe, it, expect } from "vitest";
import { parseSearchTerms, escapeOrTerm } from "./search-terms";

describe("parseSearchTerms", () => {
  it("splits a plain multi-keyword search on whitespace", () => {
    expect(parseSearchTerms("0603 100n")).toEqual(["0603", "100n"]);
  });

  it("is order independent — the caller ANDs the terms", () => {
    expect(parseSearchTerms("100n 0603").sort()).toEqual(
      parseSearchTerms("0603 100n").sort()
    );
  });

  it("collapses runs of whitespace and trims", () => {
    expect(parseSearchTerms("  0603\t\t100n  \n")).toEqual(["0603", "100n"]);
  });

  it("keeps a quoted phrase together", () => {
    expect(parseSearchTerms('"22uF X6S" 0603')).toEqual(["22uF X6S", "0603"]);
  });

  it("handles a quoted phrase on its own", () => {
    expect(parseSearchTerms('"Thick Film"')).toEqual(["Thick Film"]);
  });

  it("returns no terms for an empty or whitespace-only search", () => {
    expect(parseSearchTerms("")).toEqual([]);
    expect(parseSearchTerms("   ")).toEqual([]);
  });

  it("drops empty quotes rather than emitting a blank term", () => {
    // A blank term would become ilike."%%" and match every row, quietly
    // turning a narrowing search into a no-op.
    expect(parseSearchTerms('0603 ""')).toEqual(["0603"]);
  });

  it("keeps punctuation inside a term for the caller to escape", () => {
    // These characters are meaningful in PostgREST's or=(...) syntax, so the
    // parser must pass them through intact and let escaping handle them.
    expect(parseSearchTerms("22uf, 0805")).toEqual(["22uf,", "0805"]);
    expect(parseSearchTerms("tl431 (sot)")).toEqual(["tl431", "(sot)"]);
  });

  it("treats a single keyword the same as before", () => {
    expect(parseSearchTerms("tl431")).toEqual(["tl431"]);
  });
});

describe("escapeOrTerm", () => {
  it("leaves an ordinary term untouched", () => {
    expect(escapeOrTerm("0603")).toBe("0603");
  });

  it("escapes a double quote so the wrapping quotes cannot be broken out of", () => {
    expect(escapeOrTerm('say"hi')).toBe('say\\"hi');
  });

  it("escapes backslashes before quotes, so an escaped quote cannot be faked", () => {
    // A lone trailing backslash would otherwise escape the closing wrapper
    // quote and let the rest of the term be read as filter syntax.
    expect(escapeOrTerm("back\\slash")).toBe("back\\\\slash");
    expect(escapeOrTerm('a\\"b')).toBe('a\\\\\\"b');
  });

  it("passes through the PostgREST separators that made queries malformed", () => {
    // These stay literal in the output; they are neutralised by the double
    // quotes the caller wraps the pattern in, not by rewriting them here.
    expect(escapeOrTerm("22uf,")).toBe("22uf,");
    expect(escapeOrTerm("(sot)")).toBe("(sot)");
  });

  it("preserves ilike wildcards, which are a deliberate feature", () => {
    expect(escapeOrTerm("10%")).toBe("10%");
    expect(escapeOrTerm("a_b")).toBe("a_b");
  });
});

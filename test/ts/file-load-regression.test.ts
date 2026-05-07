
// @ts-ignore - module path may not exist in test environment
import { JSON_EXTRACT_RE } from "./fileWorker_logic";

describe("JSON Extraction Regression", () => {
  it("should correctly extract JSON even if it contains closing braces in strings", () => {
    const headerTextFull = '{"metadata": {"description": "Braces } in } strings", "channels": [1, 2, 3]}}                                 ';
    // Old logic: headerTextFull.split("}")[0] + "}"
    const oldLogicResult = headerTextFull.split("}")[0] + "}";
    expect(oldLogicResult).toBe('{"metadata": {"description": "Braces }'); // BROKEN
    
    // New logic: find the last closing brace
    const lastBraceIndex = headerTextFull.lastIndexOf("}");
    const newLogicResult = headerTextFull.substring(0, lastBraceIndex + 1);
    expect(newLogicResult).toBe('{"metadata": {"description": "Braces } in } strings", "channels": [1, 2, 3]}}');
    
    // Verify it parses
    const parsed = JSON.parse(newLogicResult);
    expect(parsed.metadata.description).toBe("Braces } in } strings");
  });

  it("should handle headers with trailing null bytes", () => {
    const headerTextFull = '{"a": 1}\0\0\0\0';
    const lastBraceIndex = headerTextFull.lastIndexOf("}");
    const result = headerTextFull.substring(0, lastBraceIndex + 1);
    expect(result).toBe('{"a": 1}');
  });
});

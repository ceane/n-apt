import { getBaseUrl, assetUrl, assetImageUrl, assetPageUrl, _setBaseUrl } from "../../src/md-preview/utils/asset-helpers";

describe("Asset Helpers", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe("getBaseUrl", () => {
    test("should return default / if import.meta.env is undefined", () => {
      // In Jest environment, import.meta.env might be undefined depending on config
      const base = getBaseUrl();
      expect(base).toBe("/");
    });
  });

  describe("assetUrl", () => {
    test("should return absolute URLs as-is", () => {
      expect(assetUrl("https://example.com/img.png")).toBe("https://example.com/img.png");
      expect(assetUrl("http://example.com/img.png")).toBe("http://example.com/img.png");
    });

    test("should return data URLs as-is", () => {
      expect(assetUrl("data:image/png;base64,123")).toBe("data:image/png;base64,123");
    });

    test("should resolve relative paths to base URL", () => {
      expect(assetUrl("test.png")).toBe("/test.png");
      expect(assetUrl("/test.png")).toBe("/test.png");
    });
  });

  describe("assetImageUrl", () => {
    test("should resolve image names to images/ folder", () => {
      expect(assetImageUrl("test.png")).toBe("/images/test.png");
      expect(assetImageUrl("/test.png")).toBe("/images/test.png"); // Should clean leading slashes
      expect(assetImageUrl("images/test.png")).toBe("/images/test.png"); // Should handle existing images/ prefix
    });
  });

  describe("assetPageUrl", () => {
    test("should resolve page names to pages/ folder", () => {
      expect(assetPageUrl("test.md")).toBe("/pages/test.md");
      expect(assetPageUrl("/test.md")).toBe("/pages/test.md");
      expect(assetPageUrl("pages/test.md")).toBe("/pages/test.md");
    });
  });

  describe("Dev vs Prod behavior", () => {
    test("should handle development base (/md-preview/)", () => {
      _setBaseUrl("/md-preview/");
      
      expect(getBaseUrl()).toBe("/md-preview/");
      expect(assetImageUrl("hero.png")).toBe("/md-preview/images/hero.png");
      expect(assetUrl("/test.png")).toBe("/md-preview/test.png");
      
      // Should handle paths that already have the dev base
      expect(assetUrl("/md-preview/test.png")).toBe("/md-preview/test.png");
    });

    test("should handle production base (/n-apt/)", () => {
      _setBaseUrl("/n-apt/");
      
      expect(getBaseUrl()).toBe("/n-apt/");
      expect(assetImageUrl("hero.png")).toBe("/n-apt/images/hero.png");
      expect(assetUrl("/test.png")).toBe("/n-apt/test.png");
      
      // Should clean dev base and replace with prod base
      expect(assetUrl("/md-preview/test.png")).toBe("/n-apt/test.png");
      
      // Should handle paths that already have the prod base
      expect(assetUrl("/n-apt/test.png")).toBe("/n-apt/test.png");
    });

    test("should handle root production base (/)", () => {
      _setBaseUrl("/");
      
      expect(getBaseUrl()).toBe("/");
      expect(assetImageUrl("hero.png")).toBe("/images/hero.png");
      expect(assetUrl("/md-preview/test.png")).toBe("/test.png");
    });
  });
});


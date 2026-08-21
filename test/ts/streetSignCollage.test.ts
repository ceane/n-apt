import fs from "node:fs";
import path from "node:path";

describe("street sign collage", () => {
  it("keeps the four street-sign photos above the table of contents", () => {
    const markdown = fs.readFileSync(
      path.resolve(__dirname, "../../pages/how-do-they-do-it.md"),
      "utf8",
    );
    const collageStart = markdown.indexOf('<div class="street-sign-collage"');
    const tableOfContentsStart = markdown.indexOf(
      "### ⠿ Table of Contents",
    );

    expect(collageStart).toBeGreaterThan(-1);
    expect(collageStart).toBeLessThan(tableOfContentsStart);
    const collageImageOrder = Array.from(
      markdown
        .slice(collageStart, tableOfContentsStart)
        .matchAll(/src="\/images\/([^"]+)"/g),
      (match) => match[1],
    );

    expect(collageImageOrder).toEqual([
      "meade-st.jpeg",
      "maryland-st.jpeg",
      "signal-rd.jpeg",
      "communications-hill-blvd.jpeg",
    ]);
  });

  it("uses 10px white spacing around and between square tiles", () => {
    const appSource = fs.readFileSync(
      path.resolve(__dirname, "../../src/app-article/App.tsx"),
      "utf8",
    );
    const collageStyles = appSource.slice(
      appSource.indexOf(".street-sign-collage"),
      appSource.indexOf("  hr {", appSource.indexOf(".street-sign-collage")),
    );

    expect(collageStyles).toContain("gap: 0;");
    expect(collageStyles).toContain("border: 10px solid #ffffff;");
    expect(collageStyles).toContain("border: 5px solid #ffffff;");
    expect(collageStyles).toContain("border-radius: 0;");
  });
});

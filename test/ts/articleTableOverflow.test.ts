import fs from "node:fs";
import path from "node:path";

const appSource = fs.readFileSync(
  path.resolve(process.cwd(), "src/app-article/App.tsx"),
  "utf8",
);

describe("article table overflow contract", () => {
  it("keeps the scroll viewport constrained while allowing wide tables to scroll", () => {
    const start = appSource.indexOf("  .table-scroll-wrapper {");
    const end = appSource.indexOf("  .table-dense", start);
    const contract = appSource.slice(start, end);
    const articleStart = appSource.indexOf("const ArticleContent = styled.article`");
    const articleEnd = appSource.indexOf("\n`;", articleStart);
    const articleContract = appSource.slice(articleStart, articleEnd);

    expect(articleContract).toContain("width: 100%;");
    expect(contract).toContain("min-width: 0;");
    expect(contract).toContain("max-width: 100%;");
    expect(contract).toContain("width: max-content;");
    expect(contract).toContain("min-width: 100%;");
    expect(contract).toContain("max-width: none;");
  });
});

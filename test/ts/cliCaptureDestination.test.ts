import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertAspectMountAvailable,
  getCaptureOutputPath,
  loadCaptureDestination,
  saveCaptureDestination,
  writeCaptureArtifact,
} from "../../scripts/cli/destinations";
import { validateCliArguments } from "../../scripts/cli/options";

describe("CLI capture destination", () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "napt-destination-test-"));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("defaults to Local Downloads and persists only the destination id", async () => {
    const settingsFile = join(directory, ".n-apt.json");
    await expect(loadCaptureDestination(settingsFile)).resolves.toBe("local");
    await saveCaptureDestination("aspect", settingsFile);
    await expect(loadCaptureDestination(settingsFile)).resolves.toBe("aspect");
    await expect(readFile(settingsFile, "utf8")).resolves.toBe(
      '{"version":1,"captureDestination":"aspect"}\n',
    );
  });

  it("resolves the configured Aspect mount and rejects missing mounts", () => {
    expect(
      getCaptureOutputPath({
        destination: "aspect",
        filename: "capture.napt",
        downloadsDirectory: "/home/test/Downloads",
        aspectPath: "/Volumes/Aspect/Captures",
      }),
    ).toBe("/Volumes/Aspect/Captures/capture.napt");
    expect(() =>
      getCaptureOutputPath({
        destination: "aspect",
        filename: "capture.napt",
        downloadsDirectory: "/home/test/Downloads",
      }),
    ).toThrow(/N_APT_ASPECT_PATH/);
  });

  it("keeps Downloads as default and permits an explicit output path", () => {
    expect(
      getCaptureOutputPath({
        destination: "local",
        filename: "capture.napt",
        downloadsDirectory: "/home/test/Downloads",
      }),
    ).toBe("/home/test/Downloads/capture.napt");
    expect(
      getCaptureOutputPath({
        destination: "aspect",
        filename: "capture.napt",
        downloadsDirectory: "/home/test/Downloads",
        aspectPath: "/Volumes/Aspect",
        outputOverride: "/tmp/capture.napt",
      }),
    ).toBe("/tmp/capture.napt");
  });

  it("writes artifacts into Downloads and an existing Aspect mount", async () => {
    const downloads = join(directory, "Downloads");
    const aspect = join(directory, "Aspect");
    await mkdir(aspect);
    const localOutput = join(downloads, "local.napt");
    const aspectOutput = join(aspect, "aspect.napt");

    await writeCaptureArtifact(localOutput, new Uint8Array([1, 2]), "local");
    await writeCaptureArtifact(aspectOutput, new Uint8Array([3, 4]), "aspect");

    await expect(readFile(localOutput)).resolves.toEqual(Buffer.from([1, 2]));
    await expect(readFile(aspectOutput)).resolves.toEqual(Buffer.from([3, 4]));
  });

  it("fails clearly when the Aspect mount is missing", async () => {
    await expect(
      writeCaptureArtifact(
        join(directory, "not-mounted", "capture.napt"),
        new Uint8Array([1]),
        "aspect",
      ),
    ).rejects.toThrow(/Aspect mount folder is unavailable/);
    await expect(assertAspectMountAvailable("relative/Aspect")).rejects.toThrow(
      /absolute path/,
    );
  });

  it("accepts only local and Aspect CLI destination options", () => {
    expect(
      validateCliArguments([
        "capture",
        "iq",
        "--allow-mutations",
        "--destination",
        "aspect",
      ]),
    ).toContain("aspect");
    expect(() =>
      validateCliArguments([
        "capture",
        "iq",
        "--allow-mutations",
        "--destination",
        "mega",
      ]),
    ).toThrow(/local, aspect/);
  });
});

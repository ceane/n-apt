import {
  formatSnapshotLocation,
  formatSnapshotLocationLine,
  reverseGeocodeSnapshotLocation,
} from "@n-apt/capture/snapshotLocation";

describe("snapshot location", () => {
  it("keeps coordinates and appends the readable place on one line", () => {
    expect(
      formatSnapshotLocationLine(
        { lat: "37.774900", lon: "-122.419400" },
        "Mission District, San Francisco, California, United States",
      ),
    ).toBe(
      "Location: 37.774900, -122.419400 – Mission District, San Francisco, California, United States",
    );
  });

  it("formats the most useful address fields as one line", () => {
    expect(
      formatSnapshotLocation({
        neighbourhood: "Mission District",
        city: "San Francisco",
        state: "California",
        country: "United States",
      }),
    ).toBe("Mission District, San Francisco, California, United States");
  });

  it("reverse geocodes coordinates through the address response", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ address: { city: "Portland", country: "United States" } }),
    }) as jest.Mock;

    await expect(reverseGeocodeSnapshotLocation("45", "-122")).resolves.toBe(
      "Portland, United States",
    );
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("lat=45&lon=-122"),
      expect.objectContaining({ headers: { Accept: "application/json" } }),
    );
  });
});

import { fileURLToPath } from "node:url";

import { createIpCountryLookup } from "../../server/utils/ipCountryLookup";

const databasePath = fileURLToPath(
  new URL("../fixtures/GeoLite2-Country-Test.mmdb", import.meta.url),
);

describe("IP country MMDB integration", () => {
  it("opens a real MMDB and resolves IPv4 and IPv6 country records", async () => {
    const lookup = createIpCountryLookup();

    await expect(lookup.lookup("81.2.69.142", databasePath)).resolves.toBe("GB");
    await expect(lookup.lookup("2001:218::", databasePath)).resolves.toBe("JP");
    await expect(lookup.lookup("1.1.1.1", databasePath)).resolves.toBeNull();
  });
});

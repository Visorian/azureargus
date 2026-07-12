import { isRfc1918Ipv4Address } from "../../app/utils/ipAddress";

describe("IP address classification", () => {
  it.each([
    "10.0.0.0",
    "10.255.255.255",
    "172.16.0.0",
    "172.31.255.255",
    "192.168.0.0",
    "192.168.255.255",
  ])("recognizes RFC 1918 address %s", (address) => {
    expect(isRfc1918Ipv4Address(address)).toBe(true);
  });

  it.each([
    "9.255.255.255",
    "11.0.0.0",
    "169.254.1.1",
    "172.15.255.255",
    "172.32.0.0",
    "192.167.255.255",
    "192.169.0.0",
    "fc00::1",
    "10.0.0",
    "10.0.0.256",
    "010.0.0.1",
    "example.com",
  ])("rejects non-RFC 1918 address %s", (address) => {
    expect(isRfc1918Ipv4Address(address)).toBe(false);
  });
});

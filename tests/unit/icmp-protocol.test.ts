import { formatIcmpProtocol } from "../../app/utils/icmpProtocol";

describe("ICMP protocol formatting", () => {
  it.each([
    ["ICMP Type=0", "ICMP Type=0 (Echo Reply)"],
    ["ICMP Type=3", "ICMP Type=3 (Destination Unreachable)"],
    ["ICMP Type=8", "ICMP Type=8 (Echo Request)"],
    ["ICMP Type=11", "ICMP Type=11 (Time Exceeded)"],
    ["ICMP Type=42", "ICMP Type=42 (Extended Echo Request)"],
  ])("formats %s", (protocol, expected) => {
    expect(formatIcmpProtocol(protocol)).toBe(expected);
  });

  it("preserves protocol suffixes", () => {
    expect(formatIcmpProtocol("ICMP Type=3 Code=1")).toBe(
      "ICMP Type=3 (Destination Unreachable) Code=1",
    );
  });

  it.each([
    "TCP",
    "ICMP",
    "ICMP Type=1",
    "ICMP Type=99",
    "ICMP Type=8invalid",
    "prefix ICMP Type=8",
  ])("leaves unsupported protocol %s unchanged", (protocol) => {
    expect(formatIcmpProtocol(protocol)).toBe(protocol);
  });

  it("does not duplicate an existing meaning", () => {
    const protocol = "ICMP Type=8 (Echo Request)";
    expect(formatIcmpProtocol(protocol)).toBe(protocol);
  });
});

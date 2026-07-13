const ICMP_TYPE_MEANINGS: Readonly<Record<number, string>> = {
  0: "Echo Reply",
  3: "Destination Unreachable",
  4: "Source Quench (Deprecated)",
  5: "Redirect",
  6: "Alternate Host Address (Deprecated)",
  8: "Echo Request",
  9: "Router Advertisement",
  10: "Router Solicitation",
  11: "Time Exceeded",
  12: "Parameter Problem",
  13: "Timestamp Request",
  14: "Timestamp Reply",
  15: "Information Request (Deprecated)",
  16: "Information Reply (Deprecated)",
  17: "Address Mask Request (Deprecated)",
  18: "Address Mask Reply (Deprecated)",
  19: "Reserved for Security",
  30: "Traceroute (Deprecated)",
  31: "Datagram Conversion Error (Deprecated)",
  32: "Mobile Host Redirect (Deprecated)",
  33: "IPv6 Where-Are-You (Deprecated)",
  34: "IPv6 I-Am-Here (Deprecated)",
  35: "Mobile Registration Request (Deprecated)",
  36: "Mobile Registration Reply (Deprecated)",
  37: "Domain Name Request (Deprecated)",
  38: "Domain Name Reply (Deprecated)",
  39: "SKIP (Deprecated)",
  40: "Photuris",
  41: "Experimental Mobility Protocols",
  42: "Extended Echo Request",
  43: "Extended Echo Reply",
  253: "RFC3692-style Experiment 1",
  254: "RFC3692-style Experiment 2",
  255: "Reserved",
};

export function formatIcmpProtocol(value: string) {
  const match = /^ICMP Type=(0|[1-9]\d{0,2})(?=$|\s)/i.exec(value);
  if (!match?.[1]) {
    return value;
  }

  const meaning = ICMP_TYPE_MEANINGS[Number(match[1])];
  if (!meaning) {
    return value;
  }

  const suffix = value.slice(match[0].length);
  return suffix.startsWith(` (${meaning})`) ? value : `${match[0]} (${meaning})${suffix}`;
}

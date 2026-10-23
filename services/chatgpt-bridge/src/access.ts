import { BlockList, isIP } from 'node:net';

const privateRanges = [
  ['10.0.0.0', 8, 'ipv4'], ['172.16.0.0', 12, 'ipv4'], ['192.168.0.0', 16, 'ipv4'], ['fc00::', 7, 'ipv6'],
] as const;

/** Only private LAN ranges are configurable; public networks and wildcard ranges are rejected. */
export function isPrivateLanCidr(cidr: string) {
  const match = /^(.*)\/(0|[1-9]\d*)$/.exec(cidr);
  if (!match) return false;
  const address = match[1]!, prefix = Number(match[2]), version = isIP(address);
  if (!version || prefix > (version === 4 ? 32 : 128)) return false;
  return privateRanges.some(([network, minimumPrefix, family]) => {
    if (prefix < minimumPrefix || (version === 4 ? 'ipv4' : 'ipv6') !== family) return false;
    const range = new BlockList();
    range.addSubnet(network, minimumPrefix, family);
    return range.check(address, family);
  });
}

export function lanAccess(cidrs: string[]) {
  const allowed = new BlockList();
  allowed.addAddress('127.0.0.1');
  allowed.addAddress('::1', 'ipv6');
  for (const cidr of cidrs) {
    if (!isPrivateLanCidr(cidr)) throw new Error('Un sous-réseau LAN privé est requis.');
    const [address, prefix] = cidr.split('/');
    allowed.addSubnet(address!, Number(prefix), isIP(address!) === 4 ? 'ipv4' : 'ipv6');
  }
  return (address: string) => allowed.check(address, isIP(address) === 6 ? 'ipv6' : 'ipv4');
}

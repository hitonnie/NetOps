/** Simulated public Internet: hosts that answer from behind the ISP. */

export interface InternetHost {
  name: string;
  ip: string;
  tcp: number[];
  udp: number[];
  icmp: boolean;
  malicious?: boolean;
}

export const INTERNET_HOSTS: InternetHost[] = [
  { name: 'dns.google', ip: '8.8.8.8', tcp: [53, 443], udp: [53], icmp: true },
  { name: 'one.one.one.one', ip: '1.1.1.1', tcp: [53, 443], udp: [53], icmp: true },
  { name: 'www.google.com', ip: '142.250.72.4', tcp: [80, 443], udp: [], icmp: true },
  { name: 'github.com', ip: '140.82.112.3', tcp: [22, 443], udp: [], icmp: true },
  { name: 'figma.com', ip: '151.101.1.164', tcp: [443], udp: [], icmp: true },
  { name: 'outlook.office.com', ip: '52.96.165.18', tcp: [443], udp: [], icmp: false },
  { name: 'portal.bankline.com', ip: '193.36.40.17', tcp: [443], udp: [], icmp: false },
  { name: 'tracker.atlassian.net', ip: '104.192.141.1', tcp: [443], udp: [], icmp: true },
  { name: 'update.microsoft.com', ip: '13.107.4.50', tcp: [80, 443], udp: [], icmp: false },
  { name: 'archive.ubuntu.com', ip: '91.189.91.82', tcp: [80, 443], udp: [], icmp: true },
  { name: 'backup.cloudvault.io', ip: '34.117.59.81', tcp: [443], udp: [], icmp: true },
  // threat-intel: known bad infrastructure used by scenarios
  { name: 'cdn-telemetry-sync.net', ip: '45.155.205.99', tcp: [443, 8443], udp: [], icmp: false, malicious: true },
  { name: 'update-check.xyz', ip: '185.220.101.47', tcp: [443, 4444], udp: [], icmp: false, malicious: true },
  { name: 'img-cdn-static.top', ip: '91.92.248.13', tcp: [443, 8080], udp: [], icmp: false, malicious: true },
];

export function internetHostByIp(ip: string): InternetHost | undefined {
  return INTERNET_HOSTS.find((h) => h.ip === ip);
}

export function internetHostByName(name: string): InternetHost | undefined {
  const n = name.toLowerCase().replace(/\.$/, '');
  return INTERNET_HOSTS.find((h) => h.name === n);
}

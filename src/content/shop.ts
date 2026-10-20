export interface ShopItem {
  id: string;
  name: string;
  category: 'Spares' | 'Network upgrades' | 'Security' | 'Services & training';
  price: number;
  kind: 'consumable' | 'upgrade';
  qty?: number;
  desc: string;
  effect: string;
}

export const SHOP: ShopItem[] = [
  { id: 'cable', name: 'Cat6 patch cables (3-pack)', category: 'Spares', price: 45, kind: 'consumable', qty: 3, desc: 'Pre-terminated copper patch leads for desks and racks.', effect: 'Needed to replace damaged or degraded copper cables.' },
  { id: 'fiber', name: 'Fiber patch + 1000BASE-SX SFP', category: 'Spares', price: 240, kind: 'consumable', qty: 1, desc: 'LC-LC multimode patch lead and a matching optic.', effect: 'Repairs a failed fiber uplink (cable or optic).' },
  { id: 'psu', name: 'Desktop power supply', category: 'Spares', price: 95, kind: 'consumable', qty: 1, desc: 'Replacement PSU for OptiPlex/Precision desktops and printers.', effect: 'Fixes a device with a failed power supply.' },
  { id: 'ups', name: 'UPS for server room & IDF cabinets', category: 'Network upgrades', price: 2400, kind: 'upgrade', desc: 'Line-interactive UPS units with 20 minutes of runtime.', effect: 'Short power blips no longer reboot switches, the firewall or servers.' },
  { id: 'redundant-uplinks', name: 'Redundant fiber uplinks (all IDFs)', category: 'Network upgrades', price: 1800, kind: 'upgrade', desc: 'A second fiber run and optic from each access switch to the core.', effect: 'Spanning tree fails over automatically if a primary uplink dies.' },
  { id: 'isp-1g', name: 'Internet circuit upgrade: 500 Mb/s → 1 Gb/s', category: 'Network upgrades', price: 3000, kind: 'upgrade', desc: 'Upgrade the ISP circuit (one-off fee for this campaign).', effect: 'Doubles Internet capacity; congestion is far less likely.' },
  { id: 'lte-backup', name: 'LTE backup WAN', category: 'Network upgrades', price: 1200, kind: 'upgrade', desc: '5G/LTE failover router behind the firewall.', effect: 'During an ISP outage the office stays online at reduced speed.' },
  { id: 'poe-injectors', name: 'PoE+ injectors for SW-OFFICE APs', category: 'Network upgrades', price: 180, kind: 'upgrade', desc: 'Mid-span injectors for AP-MTG and AP-LOBBY.', effect: 'Those APs no longer depend on SW-OFFICE\'s small PoE budget.' },
  { id: 'sw-office-upgrade', name: 'Replace SW-OFFICE with a C9200-24P', category: 'Network upgrades', price: 2600, kind: 'upgrade', desc: 'Same configuration, 370 W PoE budget instead of 110 W.', effect: 'Ends PoE budget problems on the office switch.' },
  { id: 'nms', name: 'Network monitoring suite (NMS)', category: 'Services & training', price: 1500, kind: 'upgrade', desc: 'SNMP polling, link utilisation and device health dashboards.', effect: 'Unlocks the utilisation overlay and device health map; outages are detected sooner.' },
  { id: 'ids', name: 'IDS/IPS threat subscription', category: 'Security', price: 2500, kind: 'upgrade', desc: 'Signature updates and threat-intel feeds for the edge firewall.', effect: 'Security alerts name the affected host and switch port; known C2 hosts are auto-blocked.' },
  { id: 'edr', name: 'EDR licences (all endpoints)', category: 'Security', price: 2000, kind: 'upgrade', desc: 'Endpoint detection & response agent on every PC and laptop.', effect: 'Remote host isolation, faster scans and re-images; fewer malware infections.' },
  { id: 'ddos', name: 'Upstream DDoS scrubbing service', category: 'Security', price: 2200, kind: 'upgrade', desc: 'ISP-side volumetric attack filtering.', effect: 'Denial-of-service floods are filtered before they reach your circuit.' },
  { id: 'training', name: 'CCNA bootcamp for the IT team', category: 'Services & training', price: 600, kind: 'upgrade', desc: 'A week of hands-on routing & switching training.', effect: '+4 hint tokens and +5 manager confidence.' },
];

export const START_INVENTORY: Record<string, number> = { cable: 3, fiber: 0, psu: 1 };

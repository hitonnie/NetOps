/**
 * In-game manual / runbook. Lightweight markup:
 *   ## heading, - bullet, ``` code block ```, `inline`, **bold**
 */
export interface Article {
  id: string;
  title: string;
  section: 'Start here' | 'Method' | 'Layer 1–2' | 'Layer 3' | 'Services' | 'Wireless & power' | 'Security' | 'Reference';
  tags: string[];
  body: string;
}

export const MANUAL: Article[] = [
  {
    id: 'getting-started',
    title: 'Getting started',
    section: 'Start here',
    tags: ['controls', 'help', 'keys', 'navigation'],
    body: `You are the only network engineer at Brightloop Software. Incidents appear at the **top right**. Your job: diagnose, fix the root cause, then **verify** and close.

## Moving around
- NetOps is a PC game: play with a mouse and keyboard.
- Drag the office with the mouse to pan; mouse wheel to zoom.
- Keyboard: \`W A S D\` or arrow keys pan, \`+\` / \`-\` zoom, \`0\` fits the office.
- Click a device to open its inspection window. Click a person to see what they're doing.
- The **Network** panel (\`N\`) lists every device — handy for keyboard users and for finding things fast.

## Time
- \`Space\` pauses. Keys \`1\`–\`5\` pick 1×…16× speed. New incidents slow the game back to 1× (Settings).
- At 1× one in-game minute takes 3 real seconds. People arrive around 07:00 and leave around 18:00.

## Panels
- \`I\` Inbox · \`T\` Tasks · \`B\` Shop · \`M\` Manager · \`H\` Manual · \`N\` Network · \`L\` Event log · \`C\` cycles cable view.

## The loop
- Read the symptom carefully — reports are often vague or misleading.
- Investigate with device panels, the CLI and the topology.
- Fix the underlying cause (not just the symptom).
- Click **Verify & close**. The game checks real connectivity for the affected users.`,
  },
  {
    id: 'office-network',
    title: 'The office network (topology & IP plan)',
    section: 'Start here',
    tags: ['ip plan', 'vlan', 'subnet', 'topology', 'addresses', 'servers'],
    body: `## Topology
\`\`\`
Internet ── ISP-GW 203.0.113.1
              │ (Gi0/0/0, 203.0.113.2, NAT outside)
           FW-EDGE  (inside Gi0/0/1 10.0.0.1/30)
              │
           CORE-SW1 (Gi1/0/24 10.0.0.2/30, SVIs = gateways, DHCP server)
   ┌──────────┼──────────┬───────────────┐
 SW-ENG     SW-DQA     SW-OFFICE      servers (Gi1/0/1-5), NOC-PC (Gi1/0/10)
 Gi1/1/1    Gi1/1/2    Gi1/1/3   ← fiber trunks, native VLAN 998
\`\`\`

## VLANs and subnets (all /24, gateway = .1 on CORE-SW1)
\`\`\`
VLAN  Name       Subnet           Who
10    ENG        10.10.10.0/24    Engineering desktops, PRN-ENG (.5)
20    DESIGN     10.10.20.0/24    Design desktops, PRN-DSGN (.5)
30    QA         10.10.30.0/24    QA desktops
40    FINANCE    10.10.40.0/24    Finance desktops, PRN-FIN (.5)   [ACL FIN-IN]
50    OFFICE     10.10.50.0/24    Reception, meeting-room ports, camera, VC bar
70    WIFI-CORP  10.10.70.0/24    Laptops via APs (APs: .2–.6)
99    MGMT       10.10.99.0/24    Switch SVIs (.1 core, .11 ENG, .12 DQA, .13 OFFICE), NOC-PC .50
100   SERVERS    10.10.100.0/24   Servers
998   NATIVE     (unused)         Trunk native VLAN
999   QUARANTINE (no gateway)     Unused/isolated ports
\`\`\`

## Servers
\`\`\`
SRV-DC01   10.10.100.10  DNS (named) for corp.local, forwards to 8.8.8.8 / 1.1.1.1
SRV-FILE   10.10.100.20  SMB file shares (smbd)       files.corp.local
SRV-GIT    10.10.100.30  GitLab (gitlab)               git / ci.corp.local
SRV-APP    10.10.100.40  nginx + ERP                   erp / staging / wiki.corp.local
SRV-BACKUP 10.10.100.50  restic offsite backups (01:00–05:00)
\`\`\`

## DHCP
CORE-SW1 runs IOS DHCP pools ENG, DESIGN, QA, FINANCE, OFFICE, WIFI. Addresses .1–.20 are excluded in each pool for static devices.`,
  },
  {
    id: 'cli-basics',
    title: 'Using the CLI (Cisco IOS style)',
    section: 'Start here',
    tags: ['ios', 'enable', 'configure', 'modes', 'abbreviation', 'question mark', 'tab', 'history'],
    body: `## Modes
\`\`\`
SW-ENG>              user EXEC      (show, ping)
SW-ENG#              privileged     enable
SW-ENG(config)#      global config  configure terminal
SW-ENG(config-if)#   interface      interface gi1/0/5
\`\`\`
- \`exit\` goes up one level; \`end\` (or Ctrl+Z) returns to \`#\`.
- \`do <command>\` runs an EXEC command from config mode, e.g. \`do show ip int brief\`.
- Prefix any config command with \`no\` to remove it: \`no shutdown\`, \`no ip route …\`.

## Speed tricks
- Abbreviations work if unique: \`sh ip int br\`, \`conf t\`, \`int gi1/0/5\`, \`no shut\`.
- Press \`?\` for context help (without Enter). \`Tab\` completes a keyword.
- ↑/↓ recall command history.
- Filter output: \`show running-config | include vlan\`, \`| section dhcp\`, \`| begin interface\`.

## Errors you'll see
- \`% Invalid input detected at '^' marker.\` — typo or wrong mode (the caret points at it).
- \`% Incomplete command.\` — more arguments needed.
- \`% Ambiguous command\` — the abbreviation matches several keywords.

Changes take effect immediately but live only in **running-config** until you save (see "Saving configuration").`,
  },
  {
    id: 'troubleshooting-method',
    title: 'A troubleshooting method (bottom-up)',
    section: 'Method',
    tags: ['osi', 'method', 'layers', 'approach', 'diagnose'],
    body: `Work from one affected user outward, layer by layer. Stop when you find the first thing that's wrong.

- **Scope** — who is affected? One user, one department/VLAN, one switch, wired vs Wi-Fi, everyone? The pattern points to the shared component.
- **Layer 1 (physical)** — power, cable, link lights. PC: \`ipconfig\` says "Media disconnected"? Switch: \`show interfaces status\` (connected / notconnect / disabled / err-disabled).
- **Layer 2** — right VLAN? Trunks carrying it? \`show vlan brief\`, \`show interfaces trunk\`, \`show mac address-table\`.
- **Layer 3** — sensible IP/mask/gateway? \`ipconfig /all\`, \`ping <gateway>\`, \`tracert\`, \`show ip route\`, ACLs.
- **DNS** — does \`nslookup name\` work when \`ping IP\` does?
- **Service** — is the server process running and listening? \`tnc host -Port n\`, \`systemctl status\`, \`ss -tulpn\`.

## Good habits
- Change one thing at a time and re-test.
- Check \`show logging\` — devices often tell you what happened (and who changed what).
- After fixing, verify from the **user's** perspective, then close the incident.
- Save working configs.`,
  },
  {
    id: 'change-management',
    title: 'Change management & collateral damage',
    section: 'Method',
    tags: ['change', 'rollback', 'mistake', 'outage', 'collateral'],
    body: `Every change you make is logged in the **Event log** (\`L\`). If users lose connectivity shortly after one of your changes and no other incident explains it, a new incident is opened: *"Users lost connectivity right after a change"*.

- Before changing a production device, note the current state (\`show running-config interface …\`).
- Don't shut ports or VLANs "to see what happens".
- \`show startup-config\` shows the last saved version — compare to roll back.
- A reload (\`reload\`) discards unsaved changes and takes the device offline for several minutes.`,
  },
  {
    id: 'interface-states',
    title: 'Interface states: up, down, disabled, err-disabled',
    section: 'Layer 1–2',
    tags: ['shutdown', 'no shutdown', 'notconnect', 'administratively down', 'err-disabled', 'status'],
    body: `\`show ip interface brief\` and \`show interfaces status\` are your first look at a switch.

\`\`\`
Status / Protocol            Meaning
up / up (connected)          link OK
administratively down        someone typed "shutdown" → "no shutdown"
down / down (notconnect)     no link: cable, far end off, far end shut
err-disabled                 the switch disabled it (port-security, BPDU guard)
inactive (status column)     access VLAN doesn't exist on this switch
\`\`\`

- Recover an err-disabled port: fix the cause, then \`shutdown\` followed by \`no shutdown\` (or \`clear errdisable interface …\`). \`no shutdown\` alone does **not** recover it.
- An SVI (\`interface Vlan10\`) is up only if the VLAN exists and at least one port in that VLAN is up ("autostate").`,
  },
  {
    id: 'physical-layer',
    title: 'Physical layer: cables, optics, power',
    section: 'Layer 1–2',
    tags: ['cable', 'fiber', 'sfp', 'crc', 'unplugged', 'psu', 'reseat', 'replace'],
    body: `- **No link** on both ends with ports enabled → cable or optic. Try *Reseat cable* first, then *Replace cable*.
- **Link up but slow, CRC errors increasing, stuck at 100 Mb/s** → damaged copper. Replace the cable.
- **Fiber uplink down, "Rx power low"** in the logs → failed optic or fiber. Replace via the port's *Replace optic/fiber* action (needs a spare from the Shop).
- **Device dark** → power. Check it's switched on; a failed PSU needs a replacement part.

Physical actions are in each device window (Overview / Ports). Spares are bought in the Shop (\`B\`).`,
  },
  {
    id: 'interface-counters',
    title: 'Reading interface counters',
    section: 'Layer 1–2',
    tags: ['show interfaces', 'crc', 'errors', 'collisions', 'txload', 'rate'],
    body: `\`show interfaces gi1/0/5\` shows speed/duplex, load and error counters.

- \`reliability 255/255\` is perfect; lower means errors.
- \`txload/rxload x/255\` — utilisation. 255/255 = saturated.
- \`input errors, CRC\` rising → bad cable/optic or duplex mismatch (full-duplex side).
- \`late collision\` rising → duplex mismatch (half-duplex side).
- \`5 minute input/output rate\` — current traffic.

Run the command twice a minute apart: **rising** counters matter, old ones may be history. \`clear counters\` resets them.`,
  },
  {
    id: 'duplex',
    title: 'Speed & duplex mismatch',
    section: 'Layer 1–2',
    tags: ['duplex', 'speed', 'auto', 'half', 'full', 'mismatch', 'late collision'],
    body: `If one side is hard-coded (e.g. \`speed 100\`, \`duplex full\`) and the other auto-negotiates, auto-negotiation fails and the auto side falls back to **half duplex**. The link comes up, but performance is terrible: late collisions on the half side, CRC errors on the full side.

Fix: make both sides match — normally \`speed auto\` and \`duplex auto\` on the switch port.`,
  },
  {
    id: 'vlans',
    title: 'VLANs and access ports',
    section: 'Layer 1–2',
    tags: ['vlan', 'access', 'switchport', 'show vlan brief'],
    body: `A VLAN is a separate broadcast domain. In this office each department has its own VLAN and subnet (see "The office network").

\`\`\`
interface gi1/0/7
 switchport mode access
 switchport access vlan 20
 description DSN-07 contractor
 no shutdown
\`\`\`
- \`show vlan brief\` lists VLANs and their access ports.
- If you assign a VLAN that doesn't exist, IOS creates it — a typo silently creates a useless VLAN with no gateway or DHCP.
- If a VLAN is deleted (\`no vlan 10\`), its ports become **inactive**. Recreate it with \`vlan 10\` / \`name ENG\`.`,
  },
  {
    id: 'trunks',
    title: 'Trunks and allowed VLANs',
    section: 'Layer 1–2',
    tags: ['trunk', '802.1q', 'allowed vlan', 'switchport trunk', 'uplink'],
    body: `Trunks carry many VLANs between switches, each frame tagged with 802.1Q (except the native VLAN).

\`\`\`
interface gi1/1/1
 switchport mode trunk
 switchport trunk native vlan 998
 switchport trunk allowed vlan 20,30,70,99
\`\`\`
- \`show interfaces trunk\` — compare **both ends**. A VLAN must be allowed on both.
- \`switchport trunk allowed vlan add 30\` adds; without \`add\` you **replace** the whole list (a classic outage!).
- Symptom of a missing VLAN: one VLAN on a switch is dead while others on the same switch work.`,
  },
  {
    id: 'native-vlan',
    title: 'Native VLAN mismatch',
    section: 'Layer 1–2',
    tags: ['native vlan', 'mismatch', 'untagged', 'cdp'],
    body: `Frames in the native VLAN cross a trunk **untagged**. If the two ends disagree on the native VLAN, untagged frames from VLAN X on one side land in VLAN Y on the other.

- CDP warns: \`%CDP-4-NATIVE_VLAN_MISMATCH\` in \`show logging\`.
- Here every trunk uses native VLAN 998 (an unused VLAN — good practice).
- Fix: \`switchport trunk native vlan 998\` on the misconfigured side.`,
  },
  {
    id: 'cdp',
    title: 'CDP: discovering neighbours',
    section: 'Layer 1–2',
    tags: ['cdp', 'neighbors', 'discovery'],
    body: `\`show cdp neighbors\` lists Cisco devices directly connected to each port (switches, the firewall, access points). \`show cdp neighbors detail\` adds IP addresses and native VLAN. PCs and printers don't run CDP — use the MAC address table and the device windows to trace them.`,
  },
  {
    id: 'mac-table',
    title: 'MAC table & tracing an IP to a switch port',
    section: 'Layer 1–2',
    tags: ['mac address-table', 'arp', 'trace', 'find host', 'locate'],
    body: `To find where an IP address is physically plugged in:

\`\`\`
CORE-SW1# show ip arp 10.10.40.23           → MAC f8bc.1200.1a2b on Vlan40
CORE-SW1# show mac address-table address f8bc.1200.1a2b
  40  f8bc.1200.1a2b  DYNAMIC  Gi1/1/3     → towards SW-OFFICE
SW-OFFICE# show mac address-table address f8bc.1200.1a2b
  40  f8bc.1200.1a2b  DYNAMIC  Gi1/0/3     → the access port
SW-OFFICE# show interfaces status | include Gi1/0/3   → description / desk
\`\`\`
- If a MAC is learned on an uplink/trunk, keep following it to the next switch.
- The first half of a MAC (the OUI) identifies the vendor: TP-Link, Raspberry Pi, etc. look suspicious on a corporate LAN.`,
  },
  {
    id: 'port-security',
    title: 'Port security',
    section: 'Layer 1–2',
    tags: ['port-security', 'sticky', 'violation', 'err-disabled', 'maximum'],
    body: `Port security limits which/how many MAC addresses may use an access port. Finance ports allow **1** MAC (sticky).

\`\`\`
switchport port-security
switchport port-security maximum 1
switchport port-security violation shutdown
switchport port-security mac-address sticky
\`\`\`
- A second device (e.g. a personal desk switch + laptop) causes a violation → port **err-disabled**.
- \`show port-security\` / \`show port-security interface gi1/0/3\` show counts and the last offending MAC.
- Remove the unauthorised device, then \`shutdown\` + \`no shutdown\`. If a PC was legitimately replaced, \`clear port-security sticky interface …\`.`,
  },
  {
    id: 'stp',
    title: 'Spanning tree & redundant uplinks',
    section: 'Layer 1–2',
    tags: ['stp', 'spanning-tree', 'redundancy', 'blocking', 'bpdu guard', 'portfast'],
    body: `Spanning tree blocks redundant paths so Ethernet loops can't form. If the active path fails, a blocked one takes over.

- \`show spanning-tree vlan 10\` — Root/Desg ports forward (FWD); Altn ports are blocked (BLK).
- Buying **Redundant fiber uplinks** gives each access switch a second, normally-blocked uplink.
- Access ports use \`spanning-tree portfast\` (start forwarding immediately) and \`spanning-tree bpduguard enable\` (err-disable the port if a switch is plugged in).

Simulation note: STP is modelled as "first path wins"; timers and root election are simplified.`,
  },
  {
    id: 'uplinks',
    title: 'Uplinks: when a whole switch drops',
    section: 'Layer 1–2',
    tags: ['uplink', 'switch down', 'fiber', 'trunk down'],
    body: `If **everyone behind one access switch** (wired and Wi-Fi) is down at once, suspect the shared parts: the switch's power or its uplink.

- On the core: \`show interfaces status\` for Gi1/1/1–3. On the access switch: \`show logging\` for optic alarms.
- If the optic or fiber failed, replace it (Shop: *Fiber patch + SFP*).
- Alternatively move the uplink to a spare SFP port and configure it identically to the old one (trunk, native 998, allowed VLANs).`,
  },
  {
    id: 'ip-addressing',
    title: 'IP addressing basics',
    section: 'Layer 3',
    tags: ['ip', 'address', 'mask', 'static', 'dhcp', 'ipconfig'],
    body: `A host needs four things: **IP address**, **subnet mask**, **default gateway**, **DNS server(s)**. Here they normally come from DHCP.

\`\`\`
ipconfig /all
   IPv4 Address . . . : 10.10.10.27
   Subnet Mask  . . . : 255.255.255.0
   Default Gateway  . : 10.10.10.1
   DNS Servers  . . . : 10.10.100.10
   DHCP Enabled . . . : Yes
\`\`\`
- A host with **DHCP Enabled: No** has static settings someone typed — check them carefully.
- To revert a PC to DHCP: device window → *Network settings* → DHCP, or \`netsh interface ip set address "Ethernet" dhcp\`.`,
  },
  {
    id: 'subnetting',
    title: 'Subnet masks and "is it local?"',
    section: 'Layer 3',
    tags: ['subnet', 'mask', 'prefix', '/24', '/16', 'cidr'],
    body: `A host decides whether a destination is **local** (ARP for it directly) or **remote** (send to the gateway) using its mask.

\`\`\`
10.10.10.27/24  →  local network 10.10.10.0 – 10.10.10.255
10.10.10.27/16  →  local network 10.10.0.0  – 10.10.255.255   (too big!)
\`\`\`
With a /16 mask, the PC thinks the server 10.10.100.30 is on its own LAN, ARPs for it, gets no answer, and never uses the gateway. The Internet still works because 8.8.8.8 is clearly remote.

Common masks: /24 = 255.255.255.0, /30 = 255.255.255.252 (point-to-point links), /16 = 255.255.0.0.`,
  },
  {
    id: 'default-gateway',
    title: 'Default gateway',
    section: 'Layer 3',
    tags: ['gateway', 'default gateway', 'router', 'svi'],
    body: `The default gateway is the router address a host sends off-subnet traffic to. Here every VLAN's gateway is \`.1\` on CORE-SW1 (an SVI).

Symptoms of a wrong gateway: same-subnet things work (printer, neighbour's PC) but **nothing off-subnet does** (servers, Internet). \`ping <gateway>\` fails.

Layer-2 switches (SW-ENG etc.) use \`ip default-gateway 10.10.99.1\` for their own management traffic.`,
  },
  {
    id: 'arp',
    title: 'ARP',
    section: 'Layer 3',
    tags: ['arp', 'mac', 'resolution', 'arp -a', 'show ip arp'],
    body: `ARP maps an IP address to a MAC address on the local subnet.

- PC: \`arp -a\`. Router/switch: \`show ip arp\` (or \`show arp\`).
- "Destination host unreachable" from your **own** IP on Windows = ARP failed for a local destination (or the gateway).
- The core's ARP table is the best place to map a suspicious IP to a MAC.`,
  },
  {
    id: 'duplicate-ip',
    title: 'Duplicate IP addresses',
    section: 'Layer 3',
    tags: ['duplicate', 'conflict', 'dupaddr', 'ip conflict'],
    body: `When two devices use the same IP, ARP answers flap between them and traffic randomly goes to the wrong one — intermittent failures.

- Windows shows "IP address conflict" and \`ipconfig /all\` marks the address \`(Duplicate)\`.
- The core logs \`%IP-4-DUPADDR: Duplicate address … sourced by <mac>\`.
- \`show ip arp <ip>\` repeated shows the MAC changing.
- Fix the device that shouldn't have the address (usually a manually configured PC).`,
  },
  {
    id: 'dhcp',
    title: 'DHCP (pools, exclusions, leases)',
    section: 'Layer 3',
    tags: ['dhcp', 'pool', 'lease', 'excluded-address', 'renew', 'dora', 'default-router', 'dns-server'],
    body: `Clients broadcast **D**iscover → server **O**ffers → client **R**equests → server **A**cknowledges. CORE-SW1 is the DHCP server.

\`\`\`
ip dhcp excluded-address 10.10.20.1 10.10.20.20
ip dhcp pool DESIGN
 network 10.10.20.0 255.255.255.0
 default-router 10.10.20.1
 dns-server 10.10.100.10
 domain-name corp.local
 lease 1
\`\`\`
- \`show ip dhcp pool\` — total / leased / excluded addresses. \`show ip dhcp binding\` — who has what.
- **Exhaustion**: leased + excluded = total → new clients get no offer → APIPA. Fix the exclusion, shorten the lease, \`clear ip dhcp binding *\`.
- **Wrong options** (gateway/DNS): fix the pool, then clients must **renew** (\`ipconfig /renew\`, a restart, or wait for lease renewal). Use the incident's *Ask users to restart* button.`,
  },
  {
    id: 'apipa',
    title: 'APIPA (169.254.x.x)',
    section: 'Layer 3',
    tags: ['apipa', '169.254', 'self-assigned', 'limited connectivity'],
    body: `If a Windows PC gets **no DHCP answer**, it self-assigns 169.254.x.x/16. This means:
- the PC has link (Layer 1 is fine), but
- no DHCP server answered in its broadcast domain: wrong/missing VLAN, broken trunk, DHCP pool exhausted, or the server is unreachable.

It keeps retrying every few minutes; \`ipconfig /renew\` retries immediately.`,
  },
  {
    id: 'routing',
    title: 'Routing and static routes',
    section: 'Layer 3',
    tags: ['route', 'static', 'default route', 'show ip route', 'gateway of last resort', 'next hop'],
    body: `\`show ip route\` lists Connected (C), Local (L) and Static (S) routes. \`S*\` is the default route (gateway of last resort).

\`\`\`
CORE-SW1:  ip route 0.0.0.0 0.0.0.0 10.0.0.1        (everything else → firewall)
FW-EDGE:   ip route 0.0.0.0 0.0.0.0 203.0.113.1     (→ ISP)
           ip route 10.10.0.0 255.255.0.0 10.0.0.2  (inside networks → core)
\`\`\`
- A static route is only installed if its next hop is on a connected subnet — a typo'd next hop silently disappears from the table.
- Remember the **return path**: traffic must be routable in both directions.
- \`traceroute\` / \`tracert\` show where packets stop.`,
  },
  {
    id: 'nat',
    title: 'NAT / PAT at the edge',
    section: 'Layer 3',
    tags: ['nat', 'pat', 'overload', 'translations', 'inside', 'outside'],
    body: `Private 10.x addresses can't travel on the Internet. FW-EDGE translates inside sources to its public address (PAT / "overload").

\`\`\`
interface Gi0/0/1  ip nat inside
interface Gi0/0/0  ip nat outside
ip access-list standard NAT-INSIDE
 10 permit 10.10.0.0 0.0.255.255
ip nat inside source list NAT-INSIDE interface Gi0/0/0 overload
\`\`\`
- Only sources **permitted** by the NAT ACL are translated. Untranslated private sources are dropped by the ISP.
- \`show ip nat translations\` shows active sessions — great for seeing *who* is using the Internet link.`,
  },
  {
    id: 'acl',
    title: 'Access control lists (ACLs)',
    section: 'Layer 3',
    tags: ['acl', 'access-list', 'wildcard', 'permit', 'deny', 'implicit deny', 'sequence', 'access-group'],
    body: `ACLs are checked **top-down, first match wins**, with an invisible **deny any** at the end.

\`\`\`
ip access-list extended FIN-IN
 5  permit icmp 10.10.40.0 0.0.0.255 any
 10 permit udp 10.10.40.0 0.0.0.255 host 10.10.100.10 eq domain
 20 permit tcp 10.10.40.0 0.0.0.255 host 10.10.100.40 eq 443
 30 deny   ip 10.10.40.0 0.0.0.255 10.10.0.0 0.0.255.255
 40 permit ip 10.10.40.0 0.0.0.255 any
interface Vlan40
 ip access-group FIN-IN in
\`\`\`
- **Wildcard masks** are inverted subnet masks: /24 → \`0.0.0.255\`; a single host → \`host x.x.x.x\`.
- Edit by sequence number: in \`ip access-list extended NAME\` mode use \`no 20\` then \`20 permit …\`, or insert above with a lower number (\`5 deny …\`).
- \`show access-lists\` shows hit counters — watch which line matches.
- \`show ip interface vlan40\` shows which ACL is applied in/out.

Simulation note: ACL evaluation is **stateful** — return traffic of permitted connections is allowed.`,
  },
  {
    id: 'dns',
    title: 'DNS and nslookup',
    section: 'Services',
    tags: ['dns', 'nslookup', 'dig', 'resolve', 'name', 'record', 'named', 'bind'],
    body: `DNS turns names into IPs. Clients ask SRV-DC01 (10.10.100.10); it answers corp.local itself and forwards other names to 8.8.8.8 / 1.1.1.1.

\`\`\`
nslookup git.corp.local          (Windows)
dig github.com                    (Linux)
nslookup git.corp.local 1.1.1.1   (ask a specific server)
\`\`\`
- \`ping 10.10.100.30\` works but \`ping git.corp.local\` doesn't → DNS.
- "DNS request timed out" → server unreachable or the DNS service is down.
- "Non-existent domain" → the record doesn't exist.
- A **wrong** record (old IP) resolves fine but leads nowhere — compare with the IP plan.
- Edit records in SRV-DC01's **DNS** tab. Service: \`systemctl status named\`.`,
  },
  {
    id: 'servers',
    title: 'Servers & services (Linux)',
    section: 'Services',
    tags: ['systemctl', 'service', 'journalctl', 'disk', 'df', 'restart', 'linux'],
    body: `Server problems are often the **service**, not the network: the server answers ping but the application fails.

\`\`\`
systemctl status smbd            # running? failed?
sudo systemctl restart smbd      # needs sudo
journalctl -u gitlab -n 20       # recent logs for a unit
ss -tulpn                        # what is listening on which port
df -h                            # disk space
sudo journalctl --vacuum-size=500M   # free space used by old logs
\`\`\`
- A full disk makes services crash and refuse to restart until space is freed.
- The server window's **Services** tab offers the same actions with buttons.`,
  },
  {
    id: 'ports',
    title: 'Ports & testing a service',
    section: 'Services',
    tags: ['tcp', 'udp', 'port', '443', '445', '53', 'tnc', 'curl'],
    body: `\`\`\`
53  DNS (udp)     80/443  web     445  SMB file shares
22  SSH           9100    printing  8443  ERP API (internal)
\`\`\`
- Windows: \`tnc files.corp.local -Port 445\` → TcpTestSucceeded True/False. \`curl https://erp.corp.local\`.
- Ping succeeds but the TCP test fails → firewall/ACL or the service isn't listening.`,
  },
  {
    id: 'congestion',
    title: 'Congestion & utilisation',
    section: 'Services',
    tags: ['slow', 'congestion', 'bandwidth', 'utilisation', 'txload', 'backup'],
    body: `"Everything is slow for everyone" usually means a shared link is full.

- Internet link: \`show interfaces gi0/0/0\` on FW-EDGE → \`txload\`/\`rxload\` near 255/255 and huge output rates.
- Find the talker: \`show ip nat translations\` (many sessions from one inside IP), then look at that host.
- Buying bandwidth rarely fixes a misbehaving job — fix the job (schedule backups overnight).
- The NMS upgrade adds a utilisation overlay to the map.`,
  },
  {
    id: 'isp',
    title: 'ISP problems & escalation',
    section: 'Services',
    tags: ['isp', 'outage', 'wan', 'ticket', 'circuit', 'lte'],
    body: `If your edge can reach the ISP gateway (203.0.113.1) but nothing beyond, the fault is in the provider network.

- Prove it: from FW-EDGE \`ping 203.0.113.1\` (works) and \`traceroute 8.8.8.8\` (stops after it).
- Open a ticket from the **ISP-GW** device window and keep the manager informed with status updates.
- An **LTE backup** (Shop) keeps the office online at reduced speed during outages.`,
  },
  {
    id: 'wireless',
    title: 'Wireless: coverage, channels, interference',
    section: 'Wireless & power',
    tags: ['wifi', 'wireless', 'ap', 'channel', 'interference', '2.4ghz', '1 6 11', 'ssid', 'signal'],
    body: `Laptops join the SSID **CorpNet** through five APs. Each AP bridges clients into VLAN 70.

- 2.4 GHz channels overlap; only **1, 6 and 11** are non-overlapping. Neighbouring APs should use different ones.
- Co-channel interference (another AP — yours or a neighbour's — on the same channel nearby) makes Wi-Fi "connected, full bars, but slow".
- Laptop: \`netsh wlan show interfaces\` (signal, channel) and \`netsh wlan show networks\` (what else is on the air).
- Change an AP's channel/power in its **Wireless** tab. The *Wi-Fi coverage* map layer shows channels.`,
  },
  {
    id: 'poe',
    title: 'Power over Ethernet (PoE)',
    section: 'Wireless & power',
    tags: ['poe', 'power inline', 'budget', 'ap power', 'ilpower'],
    body: `APs, cameras and video bars are powered by their switch port. Each switch has a **PoE budget** (SW-OFFICE: only 110 W).

\`\`\`
show power inline            # available / used / per-port status
interface gi1/0/10
 power inline never          # stop powering a device on this port
\`\`\`
- When the budget runs out, the switch denies power to further ports (here: allocated in port order). Logs show \`%ILPOWER-5-ILPOWER_POWER_DENY\`.
- Fixes: stop powering non-essential devices, PoE injectors, or a switch with a bigger budget (Shop).`,
  },
  {
    id: 'incident-response',
    title: 'Security incident response',
    section: 'Security',
    tags: ['security', 'incident response', 'contain', 'eradicate', 'recover', 'ir'],
    body: `Security incidents (marked ⚠) follow a fixed order:

- **Identify** the affected host — usually you only have an IP. Map it to MAC → switch port → desk (see "MAC table").
- **Contain** quickly: shut the port, move it to VLAN 999 (QUARANTINE, no gateway), or isolate with EDR. Containment stops spreading but doesn't remove the threat.
- **Eradicate**: re-image the machine (or EDR scan, if licensed). Block the attacker infrastructure at the firewall so other hosts can't reach it.
- **Recover**: put the user back on the network (undo the containment), verify.
- **Communicate**: status updates to your manager.

Delays matter: malware spreads laterally and may start exfiltrating data.`,
  },
  {
    id: 'malware',
    title: 'Malware & command-and-control (C2)',
    section: 'Security',
    tags: ['malware', 'c2', 'beacon', 'netstat', 'tasklist', 'reimage', 'edr'],
    body: `Infected machines "beacon" to a command-and-control (C2) server at regular intervals.

- On the PC: \`netstat -ano\` shows connections and owning PIDs; \`tasklist\` shows a process with a look-alike name (e.g. \`svch0st.exe\`).
- On the firewall: \`show logging\` shows sessions from the host to the C2 IP; \`show ip nat translations\`.
- Block the C2 for everyone: \`ip access-list extended INSIDE-OUT\` → \`5 deny ip any host <c2-ip>\` (above the permit!).
- Clean the PC: **Re-image** (Security tab). EDR licences (Shop) add remote isolation and quick scans.`,
  },
  {
    id: 'rogue-devices',
    title: 'Rogue & unknown devices',
    section: 'Security',
    tags: ['rogue', 'unknown device', 'oui', 'raspberry pi', 'tp-link', 'remove'],
    body: `Unknown devices show up as unexpected MAC addresses: \`show mac address-table interface gi1/0/15\`, vendor OUIs like TP-Link or Raspberry Pi, or an IDS alert from an unknown IP.

- Find the port (MAC table), check the wall-port label, shut the port.
- Physically remove the device: select it in the office view → *Remove device*.
- Prevent repeats: shut unused ports (VLAN 999), port security, DHCP snooping, BPDU guard.`,
  },
  {
    id: 'dhcp-snooping',
    title: 'DHCP snooping',
    section: 'Security',
    tags: ['dhcp snooping', 'rogue dhcp', 'trust', 'untrusted'],
    body: `DHCP snooping lets only **trusted** ports send DHCP server messages. A rogue router on an access port can no longer hand out addresses.

\`\`\`
ip dhcp snooping
ip dhcp snooping vlan 20,30
interface gi1/1/1
 ip dhcp snooping trust        ← the uplink towards the real DHCP server
\`\`\`
Forgetting to trust the uplink blocks the **real** server too — everyone loses DHCP. \`show ip dhcp snooping\` shows the trusted ports.`,
  },
  {
    id: 'dos',
    title: 'Denial of service (DoS)',
    section: 'Security',
    tags: ['dos', 'ddos', 'syn flood', 'firewall cpu', 'outside-in'],
    body: `A SYN flood exhausts the firewall's session table and CPU; everyone's Internet becomes sluggish.

- \`show processes cpu\` and \`show logging\` on FW-EDGE; \`show access-lists OUTSIDE-IN\` hit counters.
- Drop the attackers before the permit: \`ip access-list extended OUTSIDE-IN\` → \`5 deny ip 198.51.100.0 0.0.0.255 any\`.
- Volumetric floods must be filtered upstream: request ISP filtering (ISP-GW window) or buy the scrubbing service.`,
  },
  {
    id: 'saving-config',
    title: 'Saving configuration (running vs startup)',
    section: 'Reference',
    tags: ['write memory', 'copy run start', 'startup-config', 'save', 'reload'],
    body: `IOS keeps two configs: **running-config** (active, in RAM) and **startup-config** (loaded at boot).

\`\`\`
copy running-config startup-config      (or: write memory)
show startup-config
\`\`\`
If a device reloads — power blip, \`reload\` — unsaved changes are lost and an old problem can come back. Tasks remind you to save after incidents. A UPS (Shop) prevents power-blip reboots.`,
  },
  {
    id: 'hints-scoring',
    title: 'Hints, scoring and the manager',
    section: 'Reference',
    tags: ['hints', 'score', 'tokens', 'sla', 'manager', 'budget'],
    body: `- **SLA**: P1 30 min · P2 60 min · P3 2 h · P4 4 h (in-game time). Breaches upset your manager; doubling it escalates severity.
- **Score** per incident depends on severity, speed, hints used and failed verifications. Unverified auto-closes score less.
- **Hints** (3 per incident): in *Earned* mode each costs a token (you earn one per incident solved within SLA). In *Free* mode they cost nothing but reduce that incident's score by 25% each. Change in Settings.
- **Manager confidence** rises with quick fixes and status updates and falls with outages and breaches. At 0 you're fired (you can keep playing in sandbox mode).
- **Budget** is topped up every evening based on the day's productivity.`,
  },
  {
    id: 'command-reference',
    title: 'Command reference',
    section: 'Reference',
    tags: ['commands', 'reference', 'cheat sheet', 'windows', 'linux', 'ios'],
    body: `## Cisco IOS (switches, core, firewall)
\`\`\`
show ip interface brief        show interfaces [status|trunk|<if>]
show running-config [| section x] show vlan brief
show mac address-table [address <mac>|interface <if>|vlan <n>]
show ip route                  show ip arp [ip]
show cdp neighbors [detail]    show ip dhcp binding|pool|conflict
show access-lists              show ip nat translations
show power inline              show port-security [interface <if>]
show spanning-tree vlan <n>    show logging   show processes cpu
ping <ip|name>  traceroute <ip|name>   clear counters
configure terminal → interface <if> | vlan <n> | ip route … | ip dhcp pool …
  shutdown / no shutdown, description, switchport mode access|trunk,
  switchport access vlan <n>, switchport trunk allowed vlan [add|remove] <list>,
  switchport trunk native vlan <n>, speed/duplex, power inline auto|never,
  ip access-list extended <name>, ip dhcp snooping …
copy running-config startup-config | write memory | reload
\`\`\`
## Windows PCs
\`\`\`
ipconfig [/all|/release|/renew|/flushdns]   ping [-n N]   tracert
nslookup <name> [server]   arp -a   route print   netstat -ano   tasklist
tnc <host> -Port <n>   curl <url>   netsh interface ip show config
netsh interface ip set address "Ethernet" dhcp | static <ip> <mask> <gw>
netsh wlan show interfaces | networks   shutdown /r
\`\`\`
## Linux servers
\`\`\`
ip a   ip route   ping -c 4   traceroute   dig / nslookup
systemctl status|restart <svc>   journalctl -u <svc>   ss -tulpn   df -h
sudo journalctl --vacuum-size=500M   cat /etc/resolv.conf   top
\`\`\`
## Out of scope
Dynamic routing (OSPF/EIGRP/BGP), EtherChannel configuration, VTP, voice VLANs, IPv6, SNMP and AAA are not simulated — the CLI says so when you try them.`,
  },
  {
    id: 'simulation-notes',
    title: 'What is simulated (and what isn\'t)',
    section: 'Reference',
    tags: ['limitations', 'model', 'simulation', 'accuracy'],
    body: `**Modelled:** link state, speed/duplex negotiation, PoE budgets, VLANs, access/trunk ports, native VLANs, MAC learning, STP blocking of redundant links, SVIs, static routing, ARP, IOS DHCP (pools, exclusions, leases, conflicts, relay), DNS (zone + forwarders), extended/standard ACLs, PAT, wireless association/interference, port security, DHCP snooping, interface counters, link utilisation, services on servers, and a stateful firewall.

**Simplified:** STP timers/elections, TCP behaviour (latency/loss are estimated from utilisation), ACLs are stateful, PoE is allocated in port order, APs are autonomous (no controller), IPv4 only.

**Not modelled:** dynamic routing protocols, EtherChannel config, VTP, QoS, IPv6, AAA/RADIUS, SNMP. Commands for these print an "outside the scope of this simulation" message.`,
  },
];

export function searchManual(q: string): Article[] {
  const t = q.trim().toLowerCase();
  if (!t) return MANUAL;
  const words = t.split(/\s+/);
  return MANUAL.map((a) => {
    const hay = `${a.title} ${a.tags.join(' ')} ${a.body}`.toLowerCase();
    let score = 0;
    for (const w of words) {
      if (a.title.toLowerCase().includes(w)) score += 5;
      if (a.tags.some((x) => x.includes(w))) score += 3;
      if (hay.includes(w)) score += 1;
      else return { a, score: -1 };
    }
    return { a, score };
  })
    .filter((x) => x.score > 0)
    .sort((x, y) => y.score - x.score)
    .map((x) => x.a);
}

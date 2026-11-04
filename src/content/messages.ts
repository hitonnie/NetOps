/** Text generation for employee emails, noise mail and manager messages. */
import { money } from '../core/money';
import { pick, type RngState } from '../core/rng';
import type { RosterEntry } from '../world/roster';

export interface Failing {
  label: string;
  stage: string;
  detail: string;
  internal: boolean;
}

const GREET = ['Hi IT,', 'Hey,', 'Hello,', 'Hi there,', 'Morning!', 'Hi team,'];
const SIGN = ['Thanks!', 'Thanks in advance.', 'Cheers,', 'Help please 🙏', 'Thank you!', 'Appreciate it,'];

/** Turn a list of failing checks into a plain-language complaint. */
export function complaint(r: RngState, who: RosterEntry, failing: Failing[], allFailing: boolean): { subject: string; body: string } {
  const stages = new Set(failing.map((f) => f.stage));
  const internalOnly = failing.every((f) => f.internal);
  const externalOnly = failing.every((f) => !f.internal);
  let subject: string;
  let body: string;
  if (stages.has('link')) {
    subject = pick(r, ['No network at my desk', 'Computer says no network', 'Network cable unplugged??', 'Lost connection completely']);
    body = pick(r, [
      "My computer suddenly says there's no network connection at all. The little network icon has a red X.",
      'Everything stopped working at once — Windows says the network cable is unplugged, but I haven\'t touched anything.',
      'My laptop/PC shows no network connection whatsoever. Restarting didn\'t help.',
    ]);
  } else if (stages.has('ip')) {
    subject = pick(r, ['"No Internet access" on my PC', 'Limited connectivity?', 'Network shows a weird address']);
    body = pick(r, [
      'Windows says "No Internet access" and nothing loads. A colleague had me run ipconfig and the address starts with 169.254 — no idea what that means.',
      'I\'m connected but it says limited connectivity. Nothing works, internal or external.',
      'Nothing loads. The network icon has a yellow warning triangle.',
    ]);
  } else if (stages.has('dns') && allFailing) {
    subject = pick(r, ['Websites say "server not found"', 'Nothing will load by name', 'Internet broken?']);
    body = pick(r, [
      'Every site I open says "This site can\'t be reached — server IP address could not be found". Teams is offline too.',
      'Browser says DNS_PROBE_FINISHED_NXDOMAIN for everything, including our internal tools.',
    ]);
  } else if (stages.has('quality') && failing.every((f) => f.stage === 'quality')) {
    subject = pick(r, ['Network is SO slow', 'Everything is crawling', 'Video calls keep freezing']);
    body = pick(r, [
      'Everything is painfully slow today. Pages half-load and my video call keeps freezing.',
      'Downloads crawl and calls drop every few minutes. Is something wrong with the network?',
      `It technically works but it's unusably slow — ${failing.map((f) => f.label).slice(0, 2).join(' and ')} take forever.`,
    ]);
  } else if (internalOnly) {
    subject = pick(r, [`Can't reach ${failing[0].label}`, 'Internal tools down?', `${failing[0].label} not working`]);
    body = `${failing.map((f) => f.label).join(', ')} ${failing.length > 1 ? "don't" : "doesn't"} work for me (${failing[0].stage === 'service' ? 'it says connection refused / service error' : 'it just times out'}). ${pick(r, ['The Internet and email are fine though.', 'External sites work.', 'Weirdly, Google works fine.'])}`;
  } else if (externalOnly) {
    subject = pick(r, ['No Internet', 'External sites not loading', 'Internet down?']);
    body = `I can't reach ${failing.map((f) => f.label).join(', ')}. ${pick(r, ['Our internal tools still work.', 'The wiki and other internal stuff load fine.', 'Internal sites are OK.'])}`;
  } else {
    subject = pick(r, ['Nothing works', 'Network problems', 'Can\'t work — network down']);
    body = `None of these work for me: ${failing.map((f) => f.label).join(', ')}. ${pick(r, ["I can't get anything done.", 'Please help, I have a deadline.', 'Is there an outage?'])}`;
  }
  return { subject, body: `${pick(r, GREET)}\n\n${body}\n\n${pick(r, SIGN)}\n${who.name.split(' ')[0]}\n${who.role}, ${who.dept} · desk ${who.desk}` };
}

export function thanks(r: RngState, who: RosterEntry): { subject: string; body: string } {
  return {
    subject: pick(r, ['Working again — thanks!', 'All good now', 'Fixed! 🎉', 'Back online']),
    body: `${pick(r, ['Hi,', 'Hey,'])}\n\n${pick(r, ["It's working again — whatever you did, thank you!", 'Everything is back to normal on my side. Thanks for the quick fix.', 'Back in business. Much appreciated!'])}\n\n${who.name.split(' ')[0]}`,
  };
}

export function printerComplaint(r: RngState, who: RosterEntry, printer: string): { subject: string; body: string } {
  return {
    subject: pick(r, ['Printer not printing', `${printer} ignoring my jobs`, 'Print jobs disappearing']),
    body: `${pick(r, GREET)}\n\nI sent something to ${printer} twice and nothing came out. ${pick(r, ['The queue just says "error".', 'It shows as printed on my side.', 'Other people seem to have the same problem.'])}\n\n${who.name.split(' ')[0]}`,
  };
}

export const NOISE: { from: string; subject: string; body: string }[] = [
  { from: 'People Ops', subject: 'Friday lunch: tacos 🌮', body: 'Reminder: team lunch is in the kitchen on Friday at 12:30. Vegetarian options available!' },
  { from: 'Facilities', subject: 'Fire alarm test Thursday 10:00', body: 'The fire alarm will be tested on Thursday at 10:00. No need to evacuate.' },
  { from: 'Security Awareness', subject: 'Phishing reminder', body: 'Reminder: never open unexpected attachments. Report suspicious mail to security@brightloop.example.' },
  { from: 'IT Vendors Weekly', subject: 'Webinar: Wi-Fi 7 for SMBs', body: 'Join our free webinar about Wi-Fi 7 deployments. (Marketing email — safe to archive.)' },
  { from: 'Finance', subject: 'Expense reports due Friday', body: 'Please submit all expense reports by Friday EOD.' },
  { from: 'Facilities', subject: 'Kitchen dishwasher', body: 'The kitchen dishwasher is being serviced this afternoon. Please be patient!' },
  { from: 'Engineering', subject: 'Demo day next week', body: 'Engineering demo day is next Wednesday at 16:00 in Atlas. All welcome.' },
  { from: 'People Ops', subject: 'Welcome our new hires', body: 'Please welcome the two new engineers starting this week. Say hi if you see them!' },
  { from: 'ISP Account Team', subject: 'Planned maintenance notice', body: 'Planned maintenance in your area next month, 02:00–04:00. Expected impact: none (redundant core).' },
];

export function managerWelcome(): { subject: string; body: string } {
  return {
    subject: 'Welcome aboard — your first day',
    body: `Hi,\n\nWelcome to Brightloop Software! You're our network engineer now — the office network, the NOC and everything plugged into it are yours.\n\nHow I'll judge things:\n• Keep productivity high. When the network breaks, people can't work, and that costs us money.\n• Fix the root cause, then verify it — closing tickets that aren't really fixed wastes everyone's time.\n• Keep me informed on big outages (use "Send status update" on an incident).\n• Spend the IT budget wisely. Good investments make your life easier.\n\nYou start with a budget of ${money(12000)} — that's 12,000 sigils; I'll top it up every evening based on how the day went.\n\nGood luck!\nDana Whitfield, COO`,
  };
}

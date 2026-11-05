/**
 * Evaluation corpus. Every detection change is measured against it.
 *
 * `pii` lists the values that MUST be caught (any one of `types`). Anything the
 * default policy would act on (scrub, warn, block) that is not listed is a
 * false positive. Benign cases have `pii: []`.
 *
 * Secrets below are the vendors' published documentation examples or
 * obviously synthetic values; none is a live credential.
 */
export interface Case {
  text: string;
  pii: Array<{ value: string; types: string[] }>;
  note?: string;
}

const secret = (value: string) => ({ value, types: ['SECRET_KEY'] });
const phone = (value: string) => ({ value, types: ['PHONE_NUMBER'] });

export const BENIGN: Case[] = [
  { text: 'Tell me what you think about the M. version', pii: [] },
  { text: 'What is the capital of France?', pii: [], note: 'location is notify-only' },
  { text: 'Meeting at 12:30:45 tomorrow', pii: [], note: 'time is not IPv6' },
  { text: 'The logs show 10:15:30 and 23:59:59 for both events', pii: [] },
  { text: 'We upgraded to version 1.2.3.4 last week', pii: [], note: 'version is not IPv4' },
  { text: 'Requires Python v3.11.4.2 or newer', pii: [] },
  { text: 'What is the token limit of the API?', pii: [], note: 'keyword without assignment' },
  { text: 'We are doing a secret santa this year', pii: [] },
  { text: 'The password policy requires 12 characters', pii: [] },
  { text: 'Order number 1234567890 shipped on Monday', pii: [], note: '10 digits, no phone context' },
  { text: 'Invoice 20240115001 total 4500', pii: [] },
  { text: 'AB12 THIS IS SOME UPPER CASE TEXT', pii: [], note: 'IBAN shape without mod-97' },
  { text: 'Compare Google and Microsoft cloud offerings', pii: [], note: 'ORG is notify-only' },
  { text: 'Visit Paris, Lyon and Geneva this summer', pii: [] },
  { text: 'Write a function that reverses a linked list in Python', pii: [] },
  { text: 'const x = items.map((i) => i.id).filter(Boolean);', pii: [] },
  { text: 'git commit -m "fix: handle empty input" && git push origin main', pii: [] },
  { text: 'SELECT id, name FROM users WHERE created_at > 2024-01-15', pii: [] },
  { text: 'Quelle est la différence entre un mutex et un sémaphore ?', pii: [] },
  { text: 'Erkläre mir bitte den Unterschied zwischen TCP und UDP', pii: [] },
  { text: 'Spiegami come funziona la ricorsione con un esempio', pii: [] },
  { text: 'Set the timeout to 30.5 seconds and retry 3 times', pii: [] },
  { text: 'The ratio is 3.14.15 in the draft', pii: [] },
  { text: 'password: <your-password-here>', pii: [], note: 'placeholder' },
  { text: 'export API_KEY=${API_KEY}', pii: [], note: 'placeholder' },
  { text: 'My favourite colours are red, green and blue.', pii: [] },
  { text: 'The class std::vector holds elements', pii: [], note: 'not IPv6' },
];

export const POSITIVE: Case[] = [
  { text: 'Contact me at jane.roe@example.com please', pii: [{ value: 'jane.roe@example.com', types: ['EMAIL_ADDRESS'] }] },
  // secrets: the formats the old rules missed
  { text: 'key: sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123', pii: [secret('sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123')] },
  { text: 'OPENAI=sk-proj-abcdefghijklmnopqrstuvwxyz012345', pii: [secret('sk-proj-abcdefghijklmnopqrstuvwxyz012345')] },
  { text: 'aws id AKIAIOSFODNN7EXAMPLE here', pii: [secret('AKIAIOSFODNN7EXAMPLE')] },
  { text: 'token ghp_abcdefghijklmnopqrstuvwxyz0123456789 leaked', pii: [secret('ghp_abcdefghijklmnopqrstuvwxyz0123456789')] },
  { text: 'xoxb-1234567890-abcdefghij is the slack bot', pii: [secret('xoxb-1234567890-abcdefghij')] },
  { text: 'password=hunter2hunter2', pii: [secret('hunter2hunter2')] },
  { text: 'Authorization: Bearer abcdefghijklmnop1234567890', pii: [secret('abcdefghijklmnop1234567890')] },
  { text: 'DATABASE_URL=postgres://admin:s3cretpw@db.internal/app', pii: [secret('s3cretpw')] },
  // phones: local formats inside sentences of any language
  { text: 'call me on 06 12 34 56 78', pii: [phone('06 12 34 56 78')], note: 'FR number in English sentence' },
  { text: 'My mobile is 079 123 45 67', pii: [phone('079 123 45 67')], note: 'Swiss' },
  { text: 'Appelle-moi au +33 6 12 34 56 78', pii: [phone('+33 6 12 34 56 78')] },
  { text: 'Rufen Sie mich an: 030 12345678', pii: [phone('030 12345678')] },
  { text: 'Call (555) 867-5309 tomorrow', pii: [phone('(555) 867-5309')] },
  // financial / national ids (checksum-valid)
  { text: 'IBAN FR76 3000 6000 0112 3456 7890 189', pii: [{ value: 'FR76 3000 6000 0112 3456 7890 189', types: ['IBAN_CODE'] }] },
  { text: 'Mon IBAN: CH93 0076 2011 6238 5295 7', pii: [{ value: 'CH93 0076 2011 6238 5295 7', types: ['IBAN_CODE'] }] },
  { text: 'card 4111 1111 1111 1111 exp 12/29', pii: [{ value: '4111 1111 1111 1111', types: ['CREDIT_CARD'] }] },
  { text: 'AVS 756.1234.5678.97', pii: [{ value: '756.1234.5678.97', types: ['CH_AHV'] }] },
  { text: 'NIR 2 69 05 49 588 157 80', pii: [{ value: '2 69 05 49 588 157 80', types: ['FR_NIR'] }] },
  { text: 'Steuer-ID: 65929970489', pii: [{ value: '65929970489', types: ['DE_TAX_ID'] }] },
  { text: 'SSN 123-45-6789', pii: [{ value: '123-45-6789', types: ['SSN'] }] },
  // network
  { text: 'the server is 8.8.8.8 and it is down', pii: [{ value: '8.8.8.8', types: ['IP_ADDRESS'] }] },
  { text: 'ssh to 2001:db8::ff00:42:8329 now', pii: [{ value: '2001:db8::ff00:42:8329', types: ['IP_ADDRESS'] }] },
  // names (always-on layer; transformer NER improves recall further)
  { text: 'Bonjour, je suis Jean Dupont', pii: [{ value: 'Jean Dupont', types: ['PERSON'] }] },
  { text: 'Please email Marie-Claire Lefebvre about it', pii: [{ value: 'Marie-Claire Lefebvre', types: ['PERSON'] }] },
  { text: 'Concernant M. Bllaca, ces absences sont problématiques', pii: [{ value: 'Bllaca', types: ['PERSON'] }] },
  { text: 'Mme Dupont-Lachapelle a appelé hier', pii: [{ value: 'Dupont-Lachapelle', types: ['PERSON'] }] },
  { text: 'Please forward this to Dr. Okonkwo today', pii: [{ value: 'Okonkwo', types: ['PERSON'] }] },
  { text: 'Hans Müller wohnt in Berlin', pii: [{ value: 'Hans Müller', types: ['PERSON'] }] },
];

export const CORPUS: Case[] = [...BENIGN, ...POSITIVE];

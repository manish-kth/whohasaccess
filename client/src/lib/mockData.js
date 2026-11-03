// Realistic mock Drive data for Demo Mode (no Google account required).
// Shape mirrors exactly what the real Drive scan returns, so the whole
// frontend works identically whether data is real or mocked.

const ME = { emailAddress: 'you@acme.com', displayName: 'You', photoLink: null }

const PEOPLE = {
  alice: { emailAddress: 'alice@acme.com', displayName: 'Alice Nguyen' },
  ben: { emailAddress: 'ben@acme.com', displayName: 'Ben Carter' },
  chandra: { emailAddress: 'chandra@acme.com', displayName: 'Chandra Rao' },
  dana: { emailAddress: 'dana@acme.com', displayName: 'Dana Lopez' },
  // external collaborators (different domains)
  evan: { emailAddress: 'evan@contractor.io', displayName: 'Evan Prize (Contractor)' },
  freelance: { emailAddress: 'maria@freelance-design.com', displayName: 'Maria Soto' },
  oldvendor: { emailAddress: 'rep@acme-vendor-old.com', displayName: 'Vendor Rep' },
  accountant: { emailAddress: 'books@ledgerandco.com.au', displayName: 'Ledger & Co' },
  personal: { emailAddress: 'bens.personal.gmail@gmail.com', displayName: 'ben (personal)' },
  exintern: { emailAddress: 'summer.intern.2023@gmail.com', displayName: 'Summer Intern' },
  // a group
  team: { emailAddress: 'marketing-team@acme.com', displayName: 'Marketing Team', type: 'group' },
  // a client who shares a big folder with you (you don't own any of it)
  client: { emailAddress: 'office@bigclient.com.au', displayName: 'Big Client Office' },
}

let _pid = 1000
const pid = () => `perm_${_pid++}`

function perm(person, role, extra = {}) {
  return {
    id: pid(),
    type: person.type || 'user',
    role,
    emailAddress: person.emailAddress,
    displayName: person.displayName,
    photoLink: person.photoLink || null,
    deleted: false,
    ...extra,
  }
}
const ownerPerm = () => perm(ME, 'owner')
const anyonePerm = (role = 'reader', extra = {}) => ({
  id: pid(), type: 'anyone', role, displayName: 'Anyone with the link', ...extra,
})
const domainPerm = (role = 'reader') => ({
  id: pid(), type: 'domain', role, domain: 'acme.com', displayName: 'Everyone at acme.com',
})

let _fid = 1
const fid = () => `file_${_fid++}`

function file(name, mimeType, permissions, opts = {}) {
  const days = opts.ageDays ?? Math.floor(Math.random() * 400)
  const modified = new Date(Date.now() - days * 864e5).toISOString()
  return {
    id: fid(),
    name,
    mimeType,
    webViewLink: 'https://drive.google.com/demo',
    createdTime: new Date(Date.now() - (days + 30) * 864e5).toISOString(),
    modifiedTime: modified,
    viewedByMeTime: modified,
    size: opts.size ?? null,
    shared: permissions.length > 1,
    ownedByMe: true,
    parents: opts.parent ? [opts.parent] : [],
    owners: [{ emailAddress: ME.emailAddress, displayName: ME.displayName }],
    capabilities: { canShare: true },
    permissions,
  }
}

// A file someone else owns and shared with you.
function sharedFile(name, mimeType, owner, permissions, opts = {}) {
  return {
    ...file(name, mimeType, [perm(owner, 'owner'), ...permissions], opts),
    ownedByMe: false,
    owners: [{ emailAddress: owner.emailAddress, displayName: owner.displayName }],
    capabilities: { canShare: Boolean(opts.canShare) },
  }
}

const DOC = 'application/vnd.google-apps.document'
const SHEET = 'application/vnd.google-apps.spreadsheet'
const SLIDE = 'application/vnd.google-apps.presentation'
const FOLDER = 'application/vnd.google-apps.folder'
const PDF = 'application/pdf'
const IMG = 'image/png'
const JPG = 'image/jpeg'
const ZIP = 'application/zip'

const P = PEOPLE

export function buildMockDrive() {
  _pid = 1000
  _fid = 1
  const files = []
  const add = (f) => { files.push(f); return f }

  // Top-level folders
  const fin = add(file('Finance', FOLDER, [ownerPerm(), perm(P.accountant, 'writer'), perm(P.dana, 'reader')], { ageDays: 12 }))
  const hr = add(file('HR', FOLDER, [ownerPerm(), perm(P.alice, 'writer')], { ageDays: 40 }))
  const brand = add(file('Public Brand Assets', FOLDER, [ownerPerm(), anyonePerm('reader')], { ageDays: 300 }))
  const design = add(file('Website Redesign', FOLDER, [ownerPerm(), perm(P.freelance, 'writer'), perm(P.ben, 'writer')], { ageDays: 44 }))
  const archive = add(file('Archive 2021', FOLDER, [ownerPerm(), perm(P.oldvendor, 'reader'), perm(P.exintern, 'writer')], { ageDays: 900 }))
  const personal = add(file('Personal', FOLDER, [ownerPerm()], { ageDays: 70 }))
  const mkt = add(file('Marketing', FOLDER, [ownerPerm(), perm(P.team, 'writer')], { ageDays: 8 }))

  // Things that are plainly leaking
  add(file('Q3 Board Deck (FINAL).pptx', SLIDE, [ownerPerm(), anyonePerm('reader', { allowFileDiscovery: true }), perm(P.alice, 'writer')], { ageDays: 20 }))
  add(file('Company Payroll 2025.xlsx', SHEET, [ownerPerm(), anyonePerm('reader')], { ageDays: 5, parent: fin.id }))
  add(file('Customer Feedback (open link).xlsx', SHEET, [ownerPerm(), anyonePerm('writer'), perm(P.team, 'writer')], { ageDays: 120, parent: mkt.id }))
  add(file('Office Wifi & Door Codes', DOC, [ownerPerm(), domainPerm('reader'), perm(P.personal, 'reader')], { ageDays: 90 }))
  add(file('Passport scan - MK.pdf', PDF, [ownerPerm(), perm(P.accountant, 'reader')], { ageDays: 500, parent: personal.id }))
  add(file('Tax Return 2023.pdf', PDF, [ownerPerm(), perm(P.accountant, 'reader')], { ageDays: 420, parent: fin.id }))
  add(file('Bank statements Jan-Jun.pdf', PDF, [ownerPerm(), perm(P.accountant, 'reader'), perm(P.exintern, 'reader')], { ageDays: 650, parent: fin.id }))
  add(file('Employee Salaries 2024.xlsx', SHEET, [ownerPerm(), perm(P.alice, 'writer'), perm(P.exintern, 'writer')], { ageDays: 380, parent: hr.id }))
  add(file('Roadmap (shared w/ personal gmail).doc', DOC, [ownerPerm(), perm(P.personal, 'reader'), perm(P.ben, 'writer')], { ageDays: 15 }))
  add(file('2023 Vendor Contract.pdf', PDF, [ownerPerm(), perm(P.oldvendor, 'reader')], { ageDays: 720, parent: archive.id }))
  add(file('Contractor SOW.pdf', PDF, [ownerPerm(), perm(P.evan, 'reader'), perm(P.alice, 'writer')], { ageDays: 60 }))
  add(file('API keys (staging).txt', 'text/plain', [ownerPerm(), perm(P.evan, 'writer')], { ageDays: 200 }))
  add(file('Investor update - CONFIDENTIAL.doc', DOC, [ownerPerm(), perm(P.freelance, 'commenter', { expirationTime: new Date(Date.now() + 12 * 864e5).toISOString() })], { ageDays: 9 }))
  add(file('Old logo (pending transfer).ai', IMG, [ownerPerm(), perm(P.freelance, 'writer', { pendingOwner: true })], { ageDays: 33 }))

  // Internal, healthy
  add(file('Marketing Plan 2025', DOC, [ownerPerm(), perm(P.team, 'writer'), perm(P.dana, 'writer'), perm(P.chandra, 'reader')], { ageDays: 8, parent: mkt.id }))
  add(file('Sprint Planning', SHEET, [ownerPerm(), perm(P.ben, 'writer'), perm(P.chandra, 'writer')], { ageDays: 2 }))
  add(file('1:1 Notes — Alice', DOC, [ownerPerm(), perm(P.alice, 'writer')], { ageDays: 1, parent: hr.id }))
  add(file('Budget Forecast', SHEET, [ownerPerm(), perm(P.dana, 'reader')], { ageDays: 30, parent: fin.id }))
  add(file('Hiring — Interview Scorecards', SHEET, [ownerPerm(), perm(P.alice, 'reader'), perm(P.chandra, 'reader')], { ageDays: 18, parent: hr.id }))
  add(file('OKRs Q4', DOC, [ownerPerm(), perm(P.team, 'commenter'), perm(P.dana, 'writer')], { ageDays: 11 }))
  add(file('All-Hands Notes', DOC, [ownerPerm(), domainPerm('reader')], { ageDays: 3 }))

  // Private (only me)
  add(file('Draft — resignation (private).doc', DOC, [ownerPerm()], { ageDays: 4, parent: personal.id }))
  add(file('Receipts 2025', FOLDER, [ownerPerm()], { ageDays: 50, parent: personal.id }))
  add(file('Screenshot 2025-09-01.png', IMG, [ownerPerm()], { size: '248000', ageDays: 40 }))

  // Things inside shared folders inherit the folder's sharing. Drive reports that
  // through permissionDetails; the mock does the same for the big folders and
  // leaves it out for Brand Assets so the parent-walk fallback gets exercised.
  const inherit = (folder, ...perms) => perms.map((p) => ({ ...p, id: pid(), permissionDetails: [{ inherited: true, inheritedFrom: folder.id }] }))
  for (const name of ['Logo pack.zip', 'Press photos', 'Brand colours.pdf']) {
    add(file(name, name.endsWith('.pdf') ? PDF : name.endsWith('.zip') ? ZIP : FOLDER, [ownerPerm(), anyonePerm('reader')], { ageDays: 120, parent: brand.id }))
  }
  for (let i = 0; i < 38; i++) {
    add(file(`Homepage mock v${i + 1}.png`, IMG, [ownerPerm(), ...inherit(design, perm(P.freelance, 'writer'), perm(P.ben, 'writer'))], { ageDays: 44 + i, parent: design.id }))
  }
  for (let i = 0; i < 24; i++) {
    add(file(`Invoice 2021-${String(i + 1).padStart(3, '0')}.pdf`, PDF, [ownerPerm(), ...inherit(archive, perm(P.oldvendor, 'reader'), perm(P.exintern, 'writer'))], { ageDays: 900 + i * 3, parent: archive.id }))
  }
  for (let i = 0; i < 12; i++) {
    add(file(`Campaign asset ${i + 1}.png`, IMG, [ownerPerm(), ...inherit(mkt, perm(P.team, 'writer'))], { ageDays: 8 + i, parent: mkt.id }))
  }

  // Shared with me: a client's photo archive (big, so paging gets exercised) plus a few others.
  const clientFolder = add(sharedFile('Client Projects', FOLDER, P.client, [perm(ME, 'writer'), perm(P.evan, 'reader')], { ageDays: 500, canShare: true }))
  add(sharedFile('Contractor Timesheets', SHEET, P.evan, [perm(ME, 'reader')], { ageDays: 25 }))
  add(sharedFile('Brand Guidelines (from Maria)', PDF, P.freelance, [perm(ME, 'commenter'), anyonePerm('reader')], { ageDays: 90 }))
  // Ownership offered to you (consumer-style two-step transfer, waiting on you).
  add(sharedFile('Office floor plan.pdf', PDF, P.client, [perm(ME, 'writer', { pendingOwner: true })], { ageDays: 3 }))
  add(sharedFile('Lease agreement 2024.pdf', PDF, P.client, [perm(ME, 'writer', { pendingOwner: true }), perm(P.evan, 'reader')], { ageDays: 6 }))
  for (let i = 0; i < 1200; i++) {
    const photo = sharedFile(`Site photo ${String(i + 1).padStart(4, '0')}.jpg`, JPG, P.client,
      inherit(clientFolder, perm(ME, 'writer'), perm(P.evan, 'reader')), { ageDays: 30 + (i % 300), canShare: i % 2 === 0, parent: clientFolder.id })
    add(photo)
  }
  return { me: ME, files }
}

// Sharing timeline for the demo's file drawer.
export function mockHistory(fileId) {
  const n = Number(String(fileId).replace(/\D/g, '')) || 1
  const d = (daysAgo) => new Date(Date.now() - daysAgo * 864e5).toISOString()
  return [
    { at: d(3 + (n % 20)), actorIsMe: true, added: [{ role: 'writer', type: 'user', isMe: false }], removed: [] },
    { at: d(60 + (n % 200)), actorIsMe: n % 3 !== 0, added: [{ role: 'reader', type: 'anyone' }], removed: [] },
    { at: d(400 + (n % 300)), actorIsMe: true, added: [{ role: 'reader', type: 'user', isMe: false }], removed: [{ role: 'writer', type: 'user' }] },
  ]
}

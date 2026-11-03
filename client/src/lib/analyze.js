// Turns the raw scan payload (files + permissions) into everything the UI needs:
// per-file exposure, people, domains, the folder map, the issue list for the
// fix-it flow, and a security score. Runs entirely in the browser, one pass.

import { sensitivity, SENSITIVE_THRESHOLD } from './sensitive.js'

export const ROLE_RANK = { owner: 5, organizer: 5, fileOrganizer: 4, writer: 3, commenter: 2, reader: 1 }
export const ROLE_LABEL = {
  owner: 'Owner', organizer: 'Manager', fileOrganizer: 'Content manager',
  writer: 'Editor', commenter: 'Commenter', reader: 'Viewer',
}
export const EDIT_ROLES = new Set(['writer', 'fileOrganizer', 'organizer'])

// Exposure levels, least to most exposed.
export const LEVELS = ['private', 'internal', 'domain', 'external', 'public-link', 'public-web']
export const LEVEL_INFO = {
  'public-web': { label: 'Findable on the web', short: 'Public (web)', color: 'var(--c-public-web)', rank: 5 },
  'public-link': { label: 'Anyone with the link', short: 'Public link', color: 'var(--c-public)', rank: 4 },
  external: { label: 'External people', short: 'External', color: 'var(--c-external)', rank: 3 },
  domain: { label: 'Everyone in a domain', short: 'Domain-wide', color: 'var(--c-domain)', rank: 2 },
  internal: { label: 'People in your domain', short: 'Internal', color: 'var(--c-internal)', rank: 1 },
  private: { label: 'Only you', short: 'Private', color: 'var(--c-private)', rank: 0 },
}

export const FOLDER = 'application/vnd.google-apps.folder'
const DAY = 864e5
export const STALE_DAYS = 365

export function domainOf(email) {
  if (!email || !email.includes('@')) return null
  return email.split('@')[1].toLowerCase()
}

export const FREE_MAIL = new Set(['gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.co.uk', 'yahoo.com.au', 'hotmail.com', 'outlook.com', 'live.com', 'icloud.com', 'me.com', 'proton.me', 'protonmail.com', 'aol.com', 'mail.com', 'yandex.com', 'zoho.com'])

// Stable key + classification for a permission.
export function classify(perm, myDomain) {
  if (perm.type === 'anyone') return { key: '__anyone__', kind: 'anyone', level: perm.allowFileDiscovery ? 'public-web' : 'public-link' }
  if (perm.type === 'domain') return { key: `__domain__:${perm.domain}`, kind: 'domain', level: 'domain' }
  const email = (perm.emailAddress || '').toLowerCase()
  const dom = domainOf(email)
  const kind = perm.type === 'group' ? 'group' : 'user'
  const external = Boolean(dom && myDomain && dom !== myDomain)
  return { key: email || perm.id, kind, external, personalEmail: FREE_MAIL.has(dom), level: external ? 'external' : 'internal' }
}

export function kindOf(perm) {
  return perm.type === 'anyone' ? 'anyone' : perm.type === 'domain' ? 'domain' : perm.type === 'group' ? 'group' : 'user'
}
export function permName(perm) {
  return perm.displayName || (perm.type === 'anyone' ? 'Anyone with the link' : perm.type === 'domain' ? `Everyone at ${perm.domain}` : perm.emailAddress)
}

export function fileType(mimeType) {
  if (!mimeType) return 'File'
  if (mimeType === FOLDER) return 'Folder'
  if (mimeType.includes('document')) return 'Doc'
  if (mimeType.includes('spreadsheet')) return 'Sheet'
  if (mimeType.includes('presentation')) return 'Slides'
  if (mimeType.includes('form')) return 'Form'
  if (mimeType.includes('pdf')) return 'PDF'
  if (mimeType.startsWith('image/')) return 'Image'
  if (mimeType.startsWith('video/')) return 'Video'
  if (mimeType.startsWith('audio/')) return 'Audio'
  if (/zip|compressed|tar/.test(mimeType)) return 'Archive'
  return 'File'
}

export function fileIcon(mimeType) {
  const t = fileType(mimeType)
  return { Folder: '📁', Doc: '📄', Sheet: '📊', Slides: '📑', Form: '📝', PDF: '📕', Image: '🖼️', Video: '🎬', Audio: '🎵', Archive: '🗜️', File: '📎' }[t]
}

// Can the signed-in user change this permission? Owners can't be touched, and
// on files you don't own Drive only lets you if you're allowed to share the file.
export function canRemove(file, perm) {
  if (perm.role === 'owner') return false
  return file.ownedByMe || Boolean(file.capabilities?.canShare)
}

// Only drive.google.com / docs.google.com links are rendered as links.
export function safeLink(url) {
  return typeof url === 'string' && /^https:\/\/(drive|docs)\.google\.com\//.test(url) ? url : null
}

const ts = (s) => (s ? Date.parse(s) || 0 : 0)

// Where a permission comes from. Sharing a folder gives everyone on it access to
// everything inside, so removing them once on that folder cleans up all of it.
// Returns { sourceId, direct }: sourceId is the folder the access is inherited
// from (or the file itself when it was shared directly).
function sourceOf(f, p, key, byId, keysOf) {
  const details = p.permissionDetails
  if (details?.length) {
    const direct = details.some((d) => !d.inherited)
    const from = details.find((d) => d.inherited && d.inheritedFrom)?.inheritedFrom
    return { sourceId: direct || !from ? f.id : from, direct }
  }
  // No inheritance details: walk up through scanned parent folders that grant
  // the same access, and treat the topmost one as the source.
  let src = f.id
  let cur = f
  for (let depth = 0; depth < 50; depth++) {
    const parent = cur.parents?.[0] && byId.get(cur.parents[0])
    if (!parent || !keysOf(parent).has(key)) break
    src = parent.id
    cur = parent
  }
  return { sourceId: src, direct: src === f.id }
}

export function ageBucket(days) {
  if (days == null) return null
  if (days < 30) return '<30d'
  if (days < 90) return '1–3mo'
  if (days < 365) return '3–12mo'
  if (days < 730) return '1–2y'
  return '2y+'
}
export const AGE_BUCKETS = ['<30d', '1–3mo', '3–12mo', '1–2y', '2y+']

const RISK_BASE = { 'public-web': 40, 'public-link': 30, external: 18, domain: 10, internal: 4, private: 0 }

// Main analysis. scope: 'owned' (files I own) or 'shared' (files shared with me).
export function analyze(scan, scope = 'owned', ignores = []) {
  const now = Date.now()
  const myEmail = (scan.me?.emailAddress || '').toLowerCase()
  const myDomain = domainOf(myEmail)
  const all = scan.files || []
  const ownedCount = all.reduce((n, f) => n + (f.ownedByMe ? 1 : 0), 0)
  const files = all.filter((f) => (scope === 'owned' ? f.ownedByMe : !f.ownedByMe))
  const byId = new Map(all.map((f) => [f.id, f]))
  // Ignore list (see lib/ignores.js): a file key covers the file and, for a
  // folder, everything inside it.
  const ig = new Set((ignores || []).map((e) => e.key))
  const isFileIgnored = (f) => {
    if (!ig.size) return false
    let id = f.id
    for (let depth = 0; id && depth < 64; depth++) {
      if (ig.has('file:' + id)) return true
      id = byId.get(id)?.parents?.[0]
    }
    return false
  }
  const keyCache = new Map()
  const keysOf = (file) => {
    let keys = keyCache.get(file.id)
    if (!keys) {
      keys = new Set((file.permissions || []).filter((p) => !p.deleted).map((p) => classify(p, myDomain).key))
      keyCache.set(file.id, keys)
    }
    return keys
  }

  const people = new Map() // key -> aggregated person
  const domains = new Map() // domain -> aggregate
  const covers = new Map() // folder id -> number of items that inherit access from it
  const issues = {
    'public-web': [], 'sensitive-exposed': [], 'public-link': [], 'external-editors': [],
    'stale-external': [], 'personal-email': [], 'domain-wide': [], 'pending-owner': [], 'expiring': [],
  }
  const levelCounts = Object.fromEntries(LEVELS.map((l) => [l, 0]))
  const ageCounts = Object.fromEntries(AGE_BUCKETS.map((b) => [b, 0]))
  const typeCounts = new Map()
  let sharedCount = 0, publicCount = 0, externalShareCount = 0, sensitiveExposed = 0, staleShared = 0
  const ignoredItems = []
  let ignoredFiles = 0

  for (const f of files) {
    const perms = (f.permissions || []).filter((p) => !p.deleted)
    const sens = sensitivity(f.name)
    const touched = Math.max(ts(f.modifiedTime), ts(f.viewedByMeTime), ts(f.sharedWithMeTime))
    const ageDays = touched ? Math.floor((now - touched) / DAY) : null
    let lvl = 0, others = 0, externalEditors = 0, hasExternal = false, hasDomain = false, hasPublic = false, discoverable = false
    let expiring = false, pendingOwner = false
    const counted = new Set() // sources already credited for this file
    const items = []
    const fIgn = isFileIgnored(f)
    let ignoredCount = 0

    for (const p of perms) {
      const c = classify(p, myDomain)
      const email = (p.emailAddress || '').toLowerCase()
      if (c.kind === 'user' && email === myEmail) {
        // My own permission is not a share. The one case that matters is an
        // ownership invite addressed to me: it goes in the pending list only.
        if (p.pendingOwner && !f.ownedByMe) {
          pendingOwner = true
          const mineItem = {
            fileId: f.id, permissionId: p.id, name: f.name, mimeType: f.mimeType, role: p.role,
            perm: p, personKey: email, level: 'internal', removable: false, sourceId: f.id, direct: true,
            webViewLink: safeLink(f.webViewLink), ageDays, sensitive: sens.score >= SENSITIVE_THRESHOLD, ignored: fIgn, mine: true,
          }
          items.push(mineItem)
          if (!fIgn) issues['pending-owner'].push(mineItem)
        }
        continue
      }
      if (p.pendingOwner) pendingOwner = true
      if (p.role === 'owner') {
        // the owner of a file shared with me still shows up as a person
      } else {
        others++
        if (p.expirationTime) expiring = true
        const r = LEVEL_INFO[c.level].rank
        if (r > lvl) lvl = r
        if (c.kind === 'anyone') { hasPublic = true; if (p.allowFileDiscovery) discoverable = true }
        if (c.kind === 'domain') hasDomain = true
        if (c.external) { hasExternal = true; if (EDIT_ROLES.has(p.role)) externalEditors++ }
      }

      const removable = canRemove(f, p)
      const { sourceId, direct } = p.role === 'owner' ? { sourceId: f.id, direct: true } : sourceOf(f, p, c.key, byId, keysOf)
      if (!direct && !counted.has(sourceId)) { counted.add(sourceId); covers.set(sourceId, (covers.get(sourceId) || 0) + 1) }
      const item = {
        fileId: f.id, permissionId: p.id, name: f.name, mimeType: f.mimeType, role: p.role,
        perm: p, personKey: c.key, level: c.level, removable, sourceId, direct,
        webViewLink: safeLink(f.webViewLink), ageDays, sensitive: sens.score >= SENSITIVE_THRESHOLD,
        ignored: fIgn || ig.has('person:' + c.key) || ig.has(`pair:${sourceId}|${c.key}`),
        mine: false,
      }
      items.push(item)
      if (item.ignored && p.role !== 'owner') { ignoredCount++; ignoredItems.push(item) }

      let person = people.get(c.key)
      if (!person) {
        person = {
          key: c.key, kind: c.kind, level: c.level,
          external: !!c.external, personalEmail: !!c.personalEmail,
          email: c.kind === 'user' || c.kind === 'group' ? p.emailAddress : null,
          name: permName(p),
          domain: p.domain || domainOf(p.emailAddress),
          photo: p.photoLink || null,
          topRole: p.role, removable: 0, editorFiles: 0, staleFiles: 0, sensitiveFiles: 0, ignoredFiles: 0, lastTouched: 0,
          ignored: ig.has('person:' + c.key),
          files: [],
        }
        people.set(c.key, person)
      }
      if ((ROLE_RANK[p.role] || 0) > (ROLE_RANK[person.topRole] || 0)) person.topRole = p.role
      if (removable) person.removable++
      if (EDIT_ROLES.has(p.role)) person.editorFiles++
      if (ageDays != null && ageDays >= STALE_DAYS) person.staleFiles++
      if (item.sensitive) person.sensitiveFiles++
      if (item.ignored) person.ignoredFiles++
      if (touched > person.lastTouched) person.lastTouched = touched
      person.files.push(item)

      if (c.kind === 'user' || c.kind === 'group') {
        const dom = person.domain
        if (dom) {
          let d = domains.get(dom)
          if (!d) { d = { domain: dom, external: !!c.external, personalEmail: !!c.personalEmail, people: new Set(), files: 0, editors: 0 }; domains.set(dom, d) }
          d.people.add(c.key); d.files++; if (EDIT_ROLES.has(p.role)) d.editors++
        }
      }

      // Issues (fix-it flow). A permission can land in several; each is a view.
      // Ignored shares are left out here (and so out of the score).
      if (p.role !== 'owner' && !item.ignored) {
        if (c.kind === 'anyone' && p.allowFileDiscovery) issues['public-web'].push(item)
        else if (c.kind === 'anyone') issues['public-link'].push(item)
        if (c.kind === 'domain') issues['domain-wide'].push(item)
        if (c.external && EDIT_ROLES.has(p.role)) issues['external-editors'].push(item)
        if (c.external && ageDays != null && ageDays >= STALE_DAYS) issues['stale-external'].push(item)
        if (c.personalEmail) issues['personal-email'].push(item)
        if (item.sensitive && (c.kind === 'anyone' || c.external || c.kind === 'domain')) issues['sensitive-exposed'].push(item)
        if (p.expirationTime) issues['expiring'].push(item)
      }
      if (p.pendingOwner && !item.ignored) issues['pending-owner'].push(item)
    }

    const level = LEVELS[lvl]
    const stale = ageDays != null && ageDays >= STALE_DAYS
    let risk = RISK_BASE[level] * Math.min(2.5, 1 + sens.score * 0.35)
    if (stale && others) risk *= 1.2
    risk += externalEditors * 6
    const allIgnored = others > 0 && ignoredCount >= others
    if (allIgnored) { risk = 0; ignoredFiles++ }
    f._ignored = allIgnored
    f._ignoredCount = ignoredCount
    f._items = items
    f._others = others
    f._level = level
    f._lvl = lvl
    f._public = hasPublic
    f._discoverable = discoverable
    f._external = hasExternal
    f._domain = hasDomain
    f._sens = sens
    f._sensitive = sens.score >= SENSITIVE_THRESHOLD
    f._ageDays = ageDays
    f._stale = stale
    f._expiring = expiring
    f._pendingOwner = pendingOwner
    f._externalEditors = externalEditors
    f._risk = Math.round(risk)
    f._type = fileType(f.mimeType)
    f._link = safeLink(f.webViewLink)

    levelCounts[level]++
    if (others) {
      sharedCount++
      const b = ageBucket(ageDays); if (b) ageCounts[b]++
      typeCounts.set(f._type, (typeCounts.get(f._type) || 0) + 1)
      if (stale) staleShared++
    }
    if (hasPublic) publicCount++
    if (hasExternal) externalShareCount++
    if (f._sensitive && lvl >= 2) sensitiveExposed++
  }
  for (const f of files) f._covers = covers.get(f.id) || 0
  // Children index over everything scanned, for folder-wide actions.
  const children = new Map()
  for (const f of all) {
    const pid = f.parents?.[0]
    if (!pid) continue
    let list = children.get(pid)
    if (!list) { list = []; children.set(pid, list) }
    list.push(f)
  }

  // Group each person's access by where it comes from, biggest folders first.
  for (const person of people.values()) person.groups = groupBySource(person.files, byId)
  for (const k of Object.keys(issues)) issues[k] = { key: k, items: issues[k], groups: groupBySource(issues[k], byId) }

  const peopleList = [...people.values()].sort((a, b) => b.files.length - a.files.length)
  const externalPeople = peopleList.filter((p) => p.external)
  const domainList = [...domains.values()]
    .map((d) => ({ ...d, people: d.people.size }))
    .sort((a, b) => b.files - a.files)

  // Security score: start at 100, take points off per problem class (capped so
  // one huge class can't zero everything), and say what moves the needle.
  const n = (k) => issues[k].items.length
  const penalties = [
    ['public-web', 'Findable on the web', Math.min(40, 12 * n('public-web'))],
    ['sensitive-exposed', 'Sensitive files exposed', Math.min(25, 5 * n('sensitive-exposed'))],
    ['public-link', 'Public links', n('public-link') ? Math.min(30, 10 + 2 * n('public-link')) : 0],
    ['external-editors', 'External editors', Math.min(10, n('external-editors'))],
    ['stale-external', 'Stale external shares', Math.min(10, Math.ceil(n('stale-external') / 2))],
    ['personal-email', 'Personal email accounts', Math.min(8, n('personal-email'))],
    ['domain-wide', 'Domain-wide links', Math.min(5, n('domain-wide'))],
  ].filter((p) => p[2] > 0).sort((a, b) => b[2] - a[2])
  const score = Math.max(0, 100 - penalties.reduce((s, p) => s + p[2], 0))
  const grade = score >= 90 ? 'A' : score >= 75 ? 'B' : score >= 60 ? 'C' : score >= 40 ? 'D' : 'F'

  return {
    me: scan.me,
    myDomain,
    scope,
    scopes: scan.scopes || ['owned'],
    stopped: scan.stopped,
    counts: { owned: ownedCount, shared: all.length - ownedCount },
    scannedAt: scan.scannedAt,
    demo: scan.demo,
    cached: Boolean(scan.cached),
    files,
    byId,
    children,
    people: peopleList,
    domains: domainList,
    issues,
    ignored: { items: ignoredItems, groups: groupBySource(ignoredItems, byId) },
    ignores: ignores || [],
    levelCounts,
    ageCounts,
    typeCounts: [...typeCounts.entries()].map(([type, count]) => ({ type, count })).sort((a, b) => b.count - a.count),
    score: { value: score, grade, penalties: penalties.map(([key, label, points]) => ({ key, label, points })) },
    totals: {
      files: files.length,
      shared: sharedCount,
      people: peopleList.filter((p) => p.kind === 'user' || p.kind === 'group').length,
      external: externalPeople.length,
      publicFiles: publicCount,
      discoverable: n('public-web'),
      externalFiles: externalShareCount,
      domainWide: n('domain-wide'),
      sensitiveExposed,
      staleShared,
      externalEditors: n('external-editors'),
      personalEmails: n('personal-email'),
      pendingOwner: n('pending-owner'),
      expiring: n('expiring'),
      ignored: ignoredItems.length,
      ignoredFiles,
    },
  }
}

const sameGrantee = (p, q) => p.type === q.type && (p.type === 'anyone' || (p.type === 'domain'
  ? (p.domain || '').toLowerCase() === (q.domain || '').toLowerCase()
  : (p.emailAddress || '').toLowerCase() === (q.emailAddress || '').toLowerCase()))

// Groups permission items by the folder (or file) their access comes from.
export function groupBySource(items, byId) {
  const groups = new Map()
  for (const it of items) {
    // one group per (source, person): a folder shared with two people is two rows
    const gk = `${it.sourceId}|${it.personKey}`
    let g = groups.get(gk)
    if (!g) {
      const src = byId.get(it.sourceId)
      // The folder's own permission for this person (permission ids are per
      // grantee, so the inherited copy has the same id as the one on the folder).
      const own = src && src.id !== it.fileId ? (src.permissions || []).find((p) => !p.deleted && (p.id === it.permissionId || sameGrantee(p, it.perm))) : null
      g = {
        key: gk,
        sourceId: it.sourceId,
        permissionId: own?.id || it.permissionId,
        personKey: it.personKey,
        level: it.level,
        name: src?.name || (it.sourceId === it.fileId ? it.name : 'A parent folder (not in this scan)'),
        mimeType: src?.mimeType || (it.sourceId === it.fileId ? it.mimeType : FOLDER),
        role: own?.role || it.role,
        perm: own || it.perm,
        removable: own ? canRemove(src, own) : false,
        mine: false,
        webViewLink: src ? safeLink(src.webViewLink) : null,
        items: [],
      }
      groups.set(gk, g)
    }
    g.items.push(it)
    if (it.mine) g.mine = true
    if (it.sourceId === it.fileId) { g.role = it.role; g.perm = it.perm; g.permissionId = it.permissionId; g.removable = it.removable }
    else if (!byId.has(it.sourceId)) g.removable = g.removable || it.removable
  }
  return [...groups.values()].sort((x, y) => y.items.length - x.items.length)
}

// Folder map for the treemap: every folder's subtree totals, computed once.
// Returns { nodes: Map(id -> node), roots: [node] } where a node is
// { id, name, parentId, count, exposed, maxLvl, risk, children: [ids], loose }.
export function buildFolderMap(files, byId) {
  const nodes = new Map()
  const node = (f) => {
    let n = nodes.get(f.id)
    if (!n) {
      n = { id: f.id, name: f.name, parentId: f.parents?.[0] || null, count: 0, exposed: 0, maxLvl: 0, risk: 0, children: [], loose: 0, link: safeLink(f.webViewLink), own: 0 }
      nodes.set(f.id, n)
    }
    return n
  }
  for (const f of files) if (f.mimeType === FOLDER) node(f)
  const roots = []
  for (const n of nodes.values()) {
    const parent = n.parentId && nodes.get(n.parentId)
    if (parent) parent.children.push(n.id)
    else roots.push(n)
  }
  // Add every item to each folder above it.
  for (const f of files) {
    let id = f.parents?.[0]
    const isFolder = f.mimeType === FOLDER
    const selfLvl = f._lvl || 0
    const parent = id && nodes.get(id)
    if (!isFolder) { if (parent) parent.loose++ }
    if (isFolder) { const self = nodes.get(f.id); self.own = selfLvl; if (selfLvl > self.maxLvl) self.maxLvl = selfLvl }
    for (let depth = 0; id && depth < 64; depth++) {
      const n = nodes.get(id)
      if (!n) break
      n.count++
      if (f._others) n.exposed++
      if (selfLvl > n.maxLvl) n.maxLvl = selfLvl
      n.risk += f._risk || 0
      id = n.parentId
    }
  }
  const loose = { id: '__root__', name: 'My Drive (top level)', parentId: null, count: 0, exposed: 0, maxLvl: 0, risk: 0, children: [], loose: 0, link: null, own: 0 }
  for (const f of files) {
    if (f.mimeType === FOLDER) continue
    const pid = f.parents?.[0]
    if (!pid || !nodes.has(pid)) { loose.count++; loose.loose++; if (f._others) loose.exposed++; if ((f._lvl || 0) > loose.maxLvl) loose.maxLvl = f._lvl; loose.risk += f._risk || 0 }
  }
  roots.sort((a, b) => b.count - a.count)
  return { nodes, roots, loose }
}

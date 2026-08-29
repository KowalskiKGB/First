// Live GitHub numbers in the nav + open-source strip. Fails silently - the site
// works fine without them (unauthenticated API: 60 req/h per IP, cached below).
(async () => {
  const set = (id, v) => document.querySelectorAll('[data-gh="' + id + '"]').forEach(el => { el.textContent = v })
  try {
    let d = null
    const cached = sessionStorage.getItem('first_gh_repo')
    if (cached) d = JSON.parse(cached)
    else {
      const r = await fetch('https://api.github.com/repos/KowalskiKGB/First')
      if (!r.ok) return
      d = await r.json()
      sessionStorage.setItem('first_gh_repo', JSON.stringify({ stargazers_count: d.stargazers_count, forks_count: d.forks_count, open_issues_count: d.open_issues_count }))
    }
    const fmt = n => new Intl.NumberFormat('en').format(n)
    set('stars', 'GitHub ' + fmt(d.stargazers_count))
    set('stars-n', fmt(d.stargazers_count))
    set('forks-n', fmt(d.forks_count))
    set('issues-n', fmt(d.open_issues_count))
  } catch (e) { /* offline / rate-limited - leave placeholders */ }
})()

// About page: build the milestones timeline from published First releases. The
// static entries marked data-fallback stay when the API is unavailable.
;(async () => {
  const tl = document.getElementById('milestones')
  if (!tl) return
  try {
    let rel = null
    const cached = sessionStorage.getItem('first_gh_releases')
    if (cached) rel = JSON.parse(cached)
    else {
      const r = await fetch('https://api.github.com/repos/KowalskiKGB/First/releases?per_page=100')
      if (!r.ok) return
      rel = (await r.json()).filter(x => !x.draft && !x.prerelease)
        .map(x => ({ tag: x.tag_name, name: x.name, at: x.published_at, body: x.body || '', url: x.html_url }))
      sessionStorage.setItem('first_gh_releases', JSON.stringify(rel))
    }
    if (!rel.length) return
    const fmt = d => new Date(d).toLocaleDateString('en-GB', { year: 'numeric', month: 'long', day: 'numeric' })
    const blurb = md => {
      const lines = md.replace(/\r/g, '').split('\n')
      const start = lines.findIndex(l => l.trim() && !l.trim().startsWith('#'))
      if (start < 0) return ''
      const para = []
      for (let i = start; i < lines.length && lines[i].trim(); i++) para.push(lines[i].trim())
      const txt = para.join(' ').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[*_`>]/g, '')
      return txt.length > 220 ? txt.slice(0, 217).replace(/\s+\S*$/, '') + '\u2026' : txt
    }
    tl.querySelectorAll('[data-fallback]').forEach(el => el.remove())
    for (const x of rel.slice().reverse()) {
      const li = document.createElement('li')
      const title = x.name && x.name !== x.tag ? x.name : x.tag
      li.innerHTML = '<b></b><span class="when"></span><p></p>'
      li.querySelector('b').textContent = title.startsWith(x.tag) ? title : x.tag + ' - ' + title
      li.querySelector('.when').textContent = fmt(x.at)
      const p = li.querySelector('p')
      p.textContent = blurb(x.body) + ' '
      const a = document.createElement('a')
      a.href = x.url; a.rel = 'noopener'; a.textContent = 'notes'
      p.appendChild(a)
      tl.appendChild(li)
    }
  } catch (e) { /* fallback entries stay */ }
})()

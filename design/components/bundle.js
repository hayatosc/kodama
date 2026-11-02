/* @ds-bundle: {"format":4,"namespace":"Kodama","components":[{"name":"Kbd"},{"name":"Button"},{"name":"StatusBadge"},{"name":"Switch"},{"name":"AgentAvatar"},{"name":"Select"},{"name":"Tabs"},{"name":"Dialog"},{"name":"Prose"},{"name":"Message"},{"name":"ToolCall"},{"name":"ActivityFeed"},{"name":"SettingsList"},{"name":"Composer"},{"name":"Sidebar"},{"name":"ProfilePanel"},{"name":"Workspace"},{"name":"WorkspaceLive"},{"name":"Mobile"}]} */
/* Kodama preview helpers: the agent bird, its birdhouse, avatars, and side-by-side light/dark panes.
   In the SvelteKit app the bird and avatar become AgentAvatar.svelte. */
window.Kodama = (function () {
  // ---- the bird: 3/4 view facing right, body centre at 0,0, feet at y = 18.5 -------------------

  // Finch: align the gaze around the bill, keeping only a slight 3/4 perspective.
  function finchEyes(kind) {
    var shapes = {
      open: '<ellipse rx="1.35" ry="1.65" class="kd-eye"/><circle cx="-.4" cy="-.6" r=".36" class="kd-hl"/>',
      closed: '<path class="kd-lid" d="M-1.3 0q1.3 1.4 2.6 0"/>',
      happy: '<path class="kd-lid" d="M-1.3 .35q1.3-2.2 2.6 0"/>',
      wide: '<ellipse rx="1.65" ry="2" class="kd-eye"/><circle cx="-.45" cy="-.7" r=".46" class="kd-hl"/>',
      cross: '<path class="kd-lid" d="M-1.2-1.2 1.2 1.2M1.2-1.2-1.2 1.2"/>',
      worried:
        '<circle cy=".4" r="1.25" class="kd-eye"/><path class="kd-lid" d="M-1.5-2.9l2.8 .9"/>',
    }
    var left = shapes[kind] || shapes.open
    var right = kind === 'worried' ? left.replace('M-1.5-2.9l2.8 .9', 'M1.5-2.9l-2.8 .9') : left
    return (
      '<g class="kd-eyes"><g transform="translate(-2.2,-3.8)">' +
      left +
      '</g><g transform="translate(10.2,-4) scale(.92)">' +
      right +
      '</g></g>'
    )
  }
  var POSE_EYES = {
    sleep: 'closed',
    paused: 'closed',
    happy: 'happy',
    live: 'happy',
    surprised: 'wide',
    error: 'cross',
    worried: 'worried',
  }
  var PROPS = {
    paper:
      '<g transform="translate(12,4)"><rect width="9" height="11" rx="1.5" class="kd-paper"/><path d="M2 3h5M2 5.5h5M2 8h3" class="kd-fold"/></g>',
    letter:
      '<g class="kd-letter" transform="translate(1.5,3.5) rotate(-8)"><rect width="12" height="8.4" rx="1.6" class="kd-paper"/><path d="M1 1.2l5 3.4 5-3.4" class="kd-fold"/></g>',
    desk: '<g class="kd-desk"><rect x=".5" y="3.8" width="10" height="8" rx="1.3" class="kd-paper"/><path class="kd-ink" d="M2.2 6.5H8"/><path class="kd-ink kd-ink-2" d="M2.2 9h4"/></g>',
    pen: '<g class="kd-pen"><path class="kd-pen-body" d="M12.4 1.4L7.6 7.6"/><path class="kd-pen-tip" d="M7.6 7.6l-.9 1.5 1.6-.6z"/></g>',
    lens: '<g class="kd-lens"><path d="M-4.3 -.4l-3.6 4.5" class="kd-handle"/><circle cx="-1.6" cy="-4.1" r="4.4" class="kd-glass"/></g>',
  }
  var DEFAULT_PROP = { write: 'pen', work: 'lens' }
  var BODY =
    'M-14 3C-14-7-7.5-15 1.4-15 10.6-15 15.9-8.3 16 1.6 18.2 8.5 14.8 15.9 3.8 16.4-6.5 17.1-16 13.1-14 3Z'
  var faceSeq = 0
  function escapeXML(value) {
    return String(value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]
    })
  }
  function safeHue(h) {
    return /^(orange|yellow|green|teal|sky|blue|violet|plum|pink|red|brown|ink|system)$/.test(h)
      ? h
      : 'violet'
  }
  function bird(o) {
    o = o || {}
    var hue = safeHue(o.hue || o.color || 'violet'),
      pose = o.pose || 'idle'
    var cap = 'var(--agent-' + hue + ')',
      dark = 'color-mix(in srgb,' + cap + ' 80%,#3e3157)',
      edge = 'color-mix(in srgb,' + cap + ' 22%,#fffcf6)'
    var prop = o.prop === undefined ? DEFAULT_PROP[pose] : o.prop
    var outline = BODY
    var id = 'kd-face-' + ++faceSeq
    var face =
      '<defs><clipPath id="' +
      id +
      '"><path d="' +
      outline +
      '"/></clipPath></defs><path class="kd-facewhite" clip-path="url(#' +
      id +
      ')" d="M-10.7-4.6C-8.5-7.5-4.9-8.7-2.1-8C.5-7.4 2.7-6.5 4.8-6.5C6.9-6.5 8-8.3 10.3-8.2C14.2-8 18.8 1.7 18.6 8.3C18.6 16.9 7.6 20.8-3.7 17.1C-13.2 14.6-13.6 7.6-7.2 2.3C-12.8 2.3-12.7-2-10.7-4.6Z"/>'
    var tail =
      'M-11.9 7.9C-14.7 7.1-18.3 6.8-19.9 7.6-22.2 8.9-19.9 10.9-18 10.7L-10.3 10.7ZM-11.6 10.5C-14.2 10.4-17.4 10.8-18.5 12-20 13.7-17.8 14.5-16 13.8L-9.8 12.2Z'
    var lifted = pose === 'happy' || pose === 'live' || pose === 'stretch'
    var wingPath = lifted
      ? pose === 'stretch'
        ? 'M-10.8 3.5C-15.9-.4-18.2-8.9-15.8-14.4-13.1-14.1-9.1-6.9-7.8-.2Q-6.8 4.9-10.8 3.5Z'
        : 'M-11.2 4.8C-15.7 3.2-20.8-2.5-19-6.6-16.1-7-10.4-2.3-8.4 1.1Q-6.8 5.9-11.2 4.8Z'
      : 'M-11.7.2C-16.2 2.8-16.9 8.7-13 11.6-8.4 12.1-3.8 7.1-3.6 2.7-5.2-.3-8.7-.9-11.7.2Z'
    var wing =
      '<g class="kd-wing"><path d="' +
      wingPath +
      '" fill="' +
      cap +
      '"/><path d="' +
      wingPath +
      '" fill="#453464" opacity=".10"/>' +
      (!lifted
        ? '<path class="kd-featherlines" d="M-12.1 5.8q-.7 2.1-2 3.2M-8.6 6.2q-1 2.2-2.8 3.3"/>'
        : '') +
      '</g>'
    var farWing = lifted
      ? '<path d="M12.3 2C15.4-1.5 17.8-5.7 19.6-5.5 22.1-1.5 18.7 5.6 14.8 6.3Z" fill="' +
        dark +
        '"/>'
      : ''
    var beak =
      '<path class="kd-beak" d="M1.4-2.3 6.5-3 8.3-2.1Q7.6 .5 5 .6 2.7 .8 1.4-2.3Z"/><path class="kd-beak-top" d="M1.4-2.3Q1.9-4.7 4.2-5.2 6.1-5.3 8.3-2.1L5.2-1.1Z"/><path class="kd-bill-line" d="M1.6-2.2 5.2-1.1 8.1-2"/>'
    return (
      '<g class="kd-bird kd-p-' +
      escapeXML(pose) +
      ' kd-v-finch" style="--hue-dark:' +
      dark +
      ';--hue-edge:' +
      edge +
      '">' +
      (prop === 'paper' ? PROPS.paper : '') +
      '<g class="kd-breath"><g class="kd-bod">' +
      '<g class="kd-tail"><path d="' +
      tail +
      '" fill="' +
      cap +
      '"/><path d="' +
      tail +
      '" fill="#453464" opacity=".13"/></g>' +
      '<path class="kd-feet" d="M-3.8 15.5v3M-3.8 16.7l-1.7 1.1M-3.8 16.7l1.7 1.1M7.2 15.4v2.9M7.2 16.5l-1.7 1.1M7.2 16.5l1.7 1.1"/>' +
      farWing +
      '<path class="kd-body kd-body-edge" d="' +
      outline +
      '" fill="' +
      cap +
      '"/>' +
      face +
      wing +
      (prop === 'pen' ? PROPS.desk : '') +
      '<g class="kd-face">' +
      '<ellipse class="kd-blush" cx="-3.3" cy="-.8" rx="' +
      '1.65' +
      '" ry="' +
      '1.1' +
      '"/><ellipse class="kd-blush" cx="11.2" cy="' +
      '-1.1' +
      '" rx="' +
      '1.4' +
      '" ry="' +
      '.95' +
      '"/>' +
      finchEyes(POSE_EYES[pose] || 'open') +
      '<g transform="translate(0,.65)">' +
      beak +
      '</g>' +
      (prop === 'letter' ? PROPS.letter : '') +
      (prop === 'lens' ? '<g transform="translate(-.6,.3)">' + PROPS.lens + '</g>' : '') +
      (prop === 'pen' ? PROPS.pen : '') +
      '</g></g></g>' +
      (o.mark ? '<text class="kd-mark" x="13" y="-17">' + escapeXML(o.mark) + '</text>' : '') +
      '</g>'
    )
  }

  // ---- the birdhouse: every agent shares it; only the flag carries the agent's hue ------------
  // House units: hole centre 58,62; perch top at y = 77.5. Use viewBox "10 10 100 112".
  function house(o) {
    o = o || {}
    return (
      '<g class="kd-house">' +
      '<ellipse cx="56" cy="119.5" rx="15" ry="2" class="kd-ground"/>' +
      '<rect x="52" y="96" width="9" height="24" rx="3" class="kd-post"/>' +
      '<path d="M38 52L26 45v48c0 2 1 3.4 3 4l9 3.6z" class="kd-wood-side"/>' +
      '<path d="M38 52L58 34 78 52v45.5c0 1.4-1.1 2.5-2.5 2.5h-35c-1.4 0-2.5-1.1-2.5-2.5z" class="kd-wood"/>' +
      '<g class="kd-flag"><path d="M47.5 27.2V13.5" class="kd-pole"/><path d="M47.8 13.6l9.6 2.9-9.6 3z" fill="var(--agent-' +
      (o.hue || o.color || 'violet') +
      ')"/></g>' +
      '<path d="M57 31.5L35 51 23 44.5 45 25z" class="kd-roof-side"/>' +
      '<path d="M34 53.5L58 32 82 53.5" class="kd-roof"/>' +
      '<circle cx="58" cy="62" r="8.6" class="kd-hole"/>' +
      '<path d="M50.2 62a7.8 7.8 0 0 1 15.6 0" class="kd-hole-rim"/>' +
      (o.inside || '') +
      '<path d="M57 77.5h10.5a2.2 2.2 0 0 1 0 4.4H57z" class="kd-post"/>' +
      '</g>'
    )
  }
  var clipSeq = 0
  function sleeperInHole(hue) {
    var id = 'kd-hc-' + ++clipSeq
    return (
      '<defs><clipPath id="' +
      id +
      '"><circle cx="58" cy="62" r="8.6"/></clipPath></defs>' +
      '<g clip-path="url(#' +
      id +
      ')"><g transform="translate(55,67) scale(.86)">' +
      bird({ hue: hue, pose: 'sleep', prop: null }) +
      '</g></g>'
    )
  }

  // ---- avatars --------------------------------------------------------------------------------
  // A round avatar: the bird's head and chest inside a circle tinted with the agent's hue.
  // Asleep, the circle shows the agent's birdhouse in its own hue with z's drifting from it;
  // paused, the same house turns grey.
  var ALIAS = { running: 'write', queued: 'sleep' }
  var BADGE = { live: 'live', error: 'error', worried: 'error' }
  var discSeq = 0
  function avatar(o) {
    o = o || {}
    var pose = ALIAS[o.pose || o.mood] || o.pose || o.mood || 'idle'
    var hue = safeHue(o.color || o.hue || 'orange')
    var size = o.size || 36
    var id = 'kd-disc-' + ++discSeq
    var state = pose === 'sleep' || pose === 'paused' ? pose : 'awake'
    var inner
    if (state !== 'awake') {
      // Asleep or paused: the agent's own birdhouse, painted in its hue, fills the circle.
      // No bird is drawn inside: the hole stays dark, so the bird never changes scale.
      inner =
        '<g class="kd-home kd-home-tint" transform="translate(-27.8,-29.5) scale(.5)">' +
        house({ hue: hue }) +
        '</g>' +
        (pose === 'sleep' && size > 20
          ? '<g class="kd-z"><text x="4.2" y=".6">z</text><text x="7.6" y="-4.2">z</text><text x="10.6" y="-8.6">z</text></g>'
          : '')
    } else {
      var prop = size <= 20 ? null : o.prop === undefined ? DEFAULT_PROP[pose] : o.prop
      if (prop === 'paper') prop = null
      var scale = 0.93
      if (pose === 'stretch' || pose === 'happy' || pose === 'live') scale = Math.min(scale, 0.84)
      if (pose === 'tilt') scale = Math.min(scale, 0.8)
      if (pose === 'listen') scale = Math.min(scale, 0.85)
      inner =
        '<g transform="translate(2.2,.2) scale(' +
        scale +
        ')">' +
        bird({ hue: hue, pose: pose, prop: prop, mark: null }) +
        '</g>'
    }
    var mark =
      o.mark && size > 20
        ? '<text class="kd-mark kd-mark-disc" x="11" y="-10">' + escapeXML(o.mark) + '</text>'
        : ''
    var hasProp = o.prop || DEFAULT_PROP[pose]
    var badge =
      BADGE[pose] && !(hasProp && hasProp !== 'paper') && o.badge !== 'off' && size > 20
        ? '<span class="kd-avatar-badge kd-dot-' + BADGE[pose] + '"></span>'
        : ''
    return (
      '<svg viewBox="-20 -20 40 40" aria-hidden="true" class="kd-disc-' +
      state +
      (size <= 28 ? ' kd-tiny' : '') +
      '" style="--hue:var(--agent-' +
      hue +
      ')">' +
      '<defs><clipPath id="' +
      id +
      '"><circle r="20"/></clipPath></defs>' +
      '<circle r="20" class="kd-disc"/>' +
      '<g clip-path="url(#' +
      id +
      ')">' +
      inner +
      '</g>' +
      mark +
      '</svg>' +
      badge
    )
  }
  function renderAvatars(root) {
    var nodes = (root || document).querySelectorAll('[data-avatar]')
    for (var i = 0; i < nodes.length; i++) {
      var d = nodes[i].dataset
      nodes[i].classList.add('kd-avatar')
      nodes[i].innerHTML = avatar({
        color: d.avatar,
        pose: d.pose || d.mood,
        prop: d.prop,
        mark: d.mark,
        badge: d.badge,
        size: parseInt(nodes[i].style.getPropertyValue('--size'), 10) || 36,
      })
    }
  }

  // ---- light and dark, side by side ------------------------------------------------------------
  // Wraps every [data-pair] element ("row" or "stack") in a light pane and a dark copy.
  function pair(root) {
    var nodes = (root || document).querySelectorAll('[data-pair]')
    for (var i = 0; i < nodes.length; i++) {
      var src = nodes[i],
        layout = src.getAttribute('data-pair') || 'row'
      var wrap = document.createElement('div')
      wrap.className = 'kd-pair kd-pair-' + layout
      src.parentNode.insertBefore(wrap, src)
      src.removeAttribute('data-pair')
      ;['light', 'dark'].forEach(function (theme) {
        var pane = document.createElement('section')
        pane.className = 'kd-pane'
        pane.setAttribute('data-theme', theme)
        pane.innerHTML =
          '<span class="kd-pane-label">' + (theme === 'light' ? 'Light' : 'Dark') + '</span>'
        pane.appendChild(theme === 'light' ? src : src.cloneNode(true))
        wrap.appendChild(pane)
      })
    }
    renderAvatars(root)
    wire()
    initComposers(root)
  }

  // ---- interactions ----------------------------------------------------------------------------
  // One set of delegated listeners drives every card, so each cloned light/dark pane works alone.
  var ICON = {
    up: '<svg class="kd-icon" viewBox="0 0 16 16"><path d="M8 13V3M3.5 7.5 8 3l4.5 4.5"/></svg>',
    stop: '<svg class="kd-icon" viewBox="0 0 16 16"><rect x="4.5" y="4.5" width="7" height="7" rx="1.5" fill="currentColor" stroke="none"/></svg>',
    x: '<svg class="kd-icon" viewBox="0 0 16 16"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7"/></svg>',
    check: '<svg class="kd-icon kd-check" viewBox="0 0 16 16"><path d="m3.5 8.5 3 3 6-7"/></svg>',
  }
  function closeMenus(except) {
    var open = document.querySelectorAll('.kd-dropdown.is-open')
    for (var i = 0; i < open.length; i++)
      if (open[i] !== except) {
        open[i].classList.remove('is-open')
        var t = open[i].querySelector('[aria-expanded]')
        if (t) t.setAttribute('aria-expanded', 'false')
      }
  }
  function filterMenu(field) {
    var menu = field.closest('.kd-menu'),
      q = field.value.trim().toLowerCase(),
      shown = 0
    var nodes = menu.querySelector('.kd-menu-list').children,
      lastLabel = null,
      labelHas = false
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i]
      if (n.classList.contains('kd-menu-label')) {
        if (lastLabel) lastLabel.hidden = !labelHas
        lastLabel = n
        labelHas = false
        continue
      }
      if (n.classList.contains('kd-menu-sep')) {
        n.hidden = !!q
        continue
      }
      if (n.classList.contains('kd-menu-item')) {
        var hit = !q || n.textContent.toLowerCase().indexOf(q) !== -1
        n.hidden = !hit
        if (hit) {
          shown++
          labelHas = true
        }
      }
    }
    if (lastLabel) lastLabel.hidden = !labelHas
    var empty = menu.querySelector('.kd-menu-empty')
    if (empty) empty.hidden = shown > 0
  }
  function esc(t) {
    var d = document.createElement('div')
    d.textContent = t
    return d.innerHTML
  }

  // Composer: Enter sends now (interrupting a run), Tab queues while running, the queue drains in order.
  function composerParts(wrap) {
    return {
      input: wrap.querySelector('.kd-composer input'),
      right: wrap.querySelector('.kd-composer-right'),
      queue: wrap.querySelector('.kd-queue'),
      log: (wrap.closest('[data-kd-chat]') || wrap.parentNode).querySelector('[data-kd-log]'),
    }
  }
  function renderComposer(wrap) {
    var p = composerParts(wrap),
      running = wrap.getAttribute('data-running') === 'true'
    var text = p.input.value.trim()
    var html = ''
    if (running && text)
      html =
        '<button class="kd-btn kd-btn-primary kd-btn-round" data-kd-send aria-label="送信">' +
        ICON.up +
        '</button>'
    else if (running)
      html =
        '<button class="kd-btn kd-btn-primary kd-btn-round" data-kd-stop aria-label="停止">' +
        ICON.stop +
        '</button>'
    else
      html =
        '<button class="kd-btn kd-btn-primary kd-btn-round" data-kd-send aria-label="送信"' +
        (text ? '' : ' disabled') +
        '>' +
        ICON.up +
        '</button>'
    p.right.innerHTML = html
    p.input.placeholder = (wrap.getAttribute('data-agent') || 'assistant') + 'にメッセージ'
    var items = p.queue ? p.queue.querySelectorAll('.kd-queue-item') : []
    if (p.queue) {
      // The sheet opens while there is a queue, or while typing during a run, where it offers Tab.
      var canQueue = running && !!text
      p.queue.hidden = items.length === 0 && !canQueue
      var c = p.queue.querySelector('.kd-queue-count')
      if (c) {
        c.textContent = 'キュー ' + items.length
        c.hidden = items.length === 0
      }
      var note = p.queue.querySelector('.kd-queue-note')
      if (note) note.hidden = items.length === 0 || canQueue
      var add = p.queue.querySelector('.kd-queue-add')
      if (add) add.hidden = !canQueue
      for (var i = 0; i < items.length; i++)
        items[i].querySelector('.kd-queue-num').textContent = i + 1
    }
  }
  function logAppend(p, html, cls) {
    if (!p.log) return null
    var el = document.createElement('div')
    el.className = cls
    el.innerHTML = html
    p.log.appendChild(el)
    p.log.scrollTop = p.log.scrollHeight
    return el
  }
  function startRun(wrap) {
    var p = composerParts(wrap)
    wrap.setAttribute('data-running', 'true')
    renderComposer(wrap)
    var pill = logAppend(
      p,
      '考えています <span class="kd-typing"><i></i><i></i><i></i></span>',
      'kd-thinking kd-live-pill',
    )
    clearTimeout(wrap._kdTimer)
    wrap._kdTimer = setTimeout(function () {
      finishRun(wrap, pill)
    }, 2600)
  }
  function finishRun(wrap, pill) {
    var p = composerParts(wrap)
    if (pill && pill.parentNode) pill.parentNode.removeChild(pill)
    logAppend(p, '<p>了解しました。</p>', 'kd-bubble kd-msg kd-live-answer')
    wrap.setAttribute('data-running', 'false')
    renderComposer(wrap)
    var first = p.queue && p.queue.querySelector('.kd-queue-item')
    if (first) {
      var t = first.querySelector('.kd-queue-text').textContent
      first.parentNode.removeChild(first)
      setTimeout(function () {
        sendText(wrap, t, false)
      }, 400)
    }
  }
  function sendText(wrap, text, interrupt) {
    var p = composerParts(wrap)
    var pills = p.log ? p.log.querySelectorAll('.kd-live-pill') : []
    for (var i = 0; i < pills.length; i++) pills[i].parentNode.removeChild(pills[i])
    logAppend(
      p,
      esc(text) +
        (interrupt
          ? ' <span class="kd-badge kd-badge-running" style="height:18px;font-size:11px;vertical-align:1px">割り込み</span>'
          : ''),
      'kd-msg kd-msg-user',
    )
    startRun(wrap)
  }
  function composerSend(wrap) {
    var p = composerParts(wrap),
      text = p.input.value.trim()
    if (!text) return
    var running = wrap.getAttribute('data-running') === 'true'
    p.input.value = ''
    sendText(wrap, text, running)
  }
  function composerQueue(wrap) {
    var p = composerParts(wrap),
      text = p.input.value.trim()
    if (!text || !p.queue) return false
    var row = document.createElement('div')
    row.className = 'kd-queue-item'
    row.innerHTML =
      '<span class="kd-queue-num"></span><span class="kd-queue-text"></span><button class="kd-chip kd-chip-icon kd-queue-x" data-kd-unqueue aria-label="キューから外す">' +
      ICON.x +
      '</button>'
    row.querySelector('.kd-queue-text').textContent = text
    p.queue.querySelector('.kd-queue-items').appendChild(row)
    p.input.value = ''
    renderComposer(wrap)
    return true
  }

  var wired = false
  function wire() {
    if (wired) return
    wired = true
    document.addEventListener('click', function (e) {
      var t = e.target
      // Tool call: open and close the accordion
      var head = t.closest('.kd-tool-head')
      if (head && !t.closest('.kd-copy')) {
        var tool = head.parentNode
        if (tool.querySelector('.kd-tool-body')) {
          var open = !tool.hasAttribute('data-open')
          if (open) tool.setAttribute('data-open', '')
          else tool.removeAttribute('data-open')
          head.setAttribute('aria-expanded', open ? 'true' : 'false')
        }
        return
      }
      var more = t.closest('[data-kd-more]')
      if (more) {
        var out = more.closest('.kd-tool-out'),
          clamp = out && out.querySelector('.kd-clamp, .kd-unclamped')
        if (clamp) {
          var expanded = clamp.classList.toggle('kd-clamp') === false
          clamp.classList.toggle('kd-unclamped', expanded)
          more.textContent = expanded ? '折りたたむ' : 'すべて表示'
        }
        return
      }
      var copyBtn = t.closest('.kd-copy')
      if (copyBtn) {
        var label = copyBtn.getAttribute('data-label') || copyBtn.innerHTML
        copyBtn.setAttribute('data-label', label)
        try {
          var src = copyBtn.closest('.kd-tool-body, .kd-codeblock')
          var pre = src && src.querySelector('pre')
          if (pre && navigator.clipboard)
            navigator.clipboard.writeText(pre.textContent).catch(function () {})
        } catch {
          // Clipboard access can be refused; the label still confirms the click.
        }
        copyBtn.textContent = 'コピーしました'
        setTimeout(function () {
          copyBtn.innerHTML = label
        }, 1400)
        return
      }
      // Tabs
      var tab = t.closest('[role="tab"]')
      if (tab) {
        var list = tab.parentNode,
          tabs = list.querySelectorAll('[role="tab"]')
        for (var i = 0; i < tabs.length; i++)
          tabs[i].setAttribute('aria-selected', tabs[i] === tab ? 'true' : 'false')
        var scope = list.closest('[data-kd-tabs]')
        if (scope) {
          var panels = scope.querySelectorAll('[data-tab-panel]')
          for (var j = 0; j < panels.length; j++)
            panels[j].hidden =
              panels[j].getAttribute('data-tab-panel') !== tab.getAttribute('data-tab')
        }
        return
      }
      // Select: option, then trigger
      var opt = t.closest('.kd-dropdown .kd-menu-item')
      if (opt) {
        if (opt.getAttribute('aria-disabled') === 'true') return
        var dd = opt.closest('.kd-dropdown'),
          items = dd.querySelectorAll('.kd-menu-item')
        for (var k = 0; k < items.length; k++) {
          items[k].classList.remove('is-active')
          items[k].setAttribute('aria-selected', 'false')
          var c = items[k].querySelector('.kd-check')
          if (c) c.parentNode.removeChild(c)
        }
        opt.classList.add('is-active')
        opt.setAttribute('aria-selected', 'true')
        opt.insertAdjacentHTML('beforeend', ICON.check)
        var val = dd.querySelector('.kd-dropdown-value')
        if (val)
          val.textContent =
            opt.getAttribute('data-value') ||
            opt.querySelector('.kd-menu-text').firstChild.textContent
        closeMenus()
        return
      }
      var trig = t.closest('.kd-dropdown > .kd-select, .kd-dropdown > .kd-select-field')
      if (trig) {
        var d = trig.parentNode,
          willOpen = !d.classList.contains('is-open')
        closeMenus(d)
        d.classList.toggle('is-open', willOpen)
        trig.setAttribute('aria-expanded', willOpen ? 'true' : 'false')
        var f = d.querySelector('[data-kd-filter]')
        if (willOpen && f) {
          f.value = ''
          filterMenu(f)
          setTimeout(function () {
            f.focus()
          }, 0)
        }
        return
      }
      if (!t.closest('.kd-menu')) closeMenus()
      // Switch
      var sw = t.closest('.kd-switch')
      if (sw && !sw.disabled) {
        sw.setAttribute(
          'aria-checked',
          sw.getAttribute('aria-checked') === 'true' ? 'false' : 'true',
        )
        return
      }
      // Dialog
      var opener = t.closest('[data-kd-dialog-open]')
      if (opener) {
        var pane = opener.closest('.kd-pane') || document
        var dlg = pane.querySelector(
          '[data-kd-dialog="' + opener.getAttribute('data-kd-dialog-open') + '"]',
        )
        if (dlg) {
          dlg.hidden = false
          var first = dlg.querySelector('[data-kd-dialog-close]')
          if (first) first.focus()
        }
        return
      }
      var closer = t.closest('[data-kd-dialog-close]')
      if (closer) {
        var box = closer.closest('[data-kd-dialog]')
        if (box) box.hidden = true
        var done = closer.getAttribute('data-kd-done'),
          target = done && (closer.closest('.kd-pane') || document).querySelector(done)
        if (target) {
          target.textContent = target.getAttribute('data-done-text') || target.textContent
        }
        return
      }
      if (t.classList.contains('kd-scrim')) {
        t.closest('[data-kd-dialog]').hidden = true
        return
      }
      // Sheet (mobile): open by key within the same screen, close by the scrim or a close button
      var so = t.closest('[data-kd-sheet-open]')
      if (so) {
        var scope = so.closest('[data-kd-screen]') || so.closest('.kd-pane') || document
        var sh = scope.querySelector(
          '[data-kd-sheet="' + so.getAttribute('data-kd-sheet-open') + '"]',
        )
        if (sh) sh.hidden = false
        return
      }
      if (t.closest('[data-kd-sheet-close]') || t.classList.contains('kd-sheet-scrim')) {
        var sl = t.closest('[data-kd-sheet]')
        if (sl) {
          sl.hidden = true
          return
        }
      }
      // Composer
      var wrap = t.closest('.kd-composer-wrap[data-kd-live]')
      if (wrap) {
        if (t.closest('[data-kd-send]')) {
          composerSend(wrap)
          return
        }
        if (t.closest('[data-kd-stop]')) {
          clearTimeout(wrap._kdTimer)
          var pill =
            wrap.closest('[data-kd-chat]') &&
            wrap.closest('[data-kd-chat]').querySelector('.kd-live-pill')
          finishRun(wrap, pill)
          return
        }
        if (t.closest('[data-kd-queue]')) {
          composerQueue(wrap)
          return
        }
        if (t.closest('[data-kd-unqueue]')) {
          var r = t.closest('.kd-queue-item')
          r.parentNode.removeChild(r)
          renderComposer(wrap)
          return
        }
      }
      // Sidebar selection
      var row = t.closest('.kd-sidebar .kd-row, .kd-sidebar .kd-featured')
      if (row) {
        var nav = row.closest('.kd-sidebar'),
          cur = nav.querySelectorAll('[aria-current]')
        for (var m = 0; m < cur.length; m++) cur[m].removeAttribute('aria-current')
        row.setAttribute('aria-current', 'page')
      }
    })
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        closeMenus()
        var dl = document.querySelectorAll(
          '[data-kd-dialog]:not([hidden]), [data-kd-sheet]:not([hidden])',
        )
        for (var i = 0; i < dl.length; i++) dl[i].hidden = true
        return
      }
      if (e.key === 'Enter' && e.target.matches && e.target.matches('[data-kd-filter]')) {
        e.preventDefault()
        var firstOpt = e.target
          .closest('.kd-menu')
          .querySelector('.kd-menu-item:not([hidden]):not([aria-disabled="true"])')
        if (firstOpt) firstOpt.click()
        return
      }
      var input =
        e.target.closest && e.target.closest('.kd-composer-wrap[data-kd-live] .kd-composer input')
      if (!input || e.isComposing) return
      var wrap = input.closest('.kd-composer-wrap')
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        composerSend(wrap)
      } else if (
        e.key === 'Tab' &&
        !e.shiftKey &&
        wrap.getAttribute('data-running') === 'true' &&
        input.value.trim()
      ) {
        e.preventDefault()
        composerQueue(wrap)
      }
    })
    document.addEventListener('input', function (e) {
      if (e.target.matches && e.target.matches('[data-kd-filter]')) {
        filterMenu(e.target)
        return
      }
      var wrap = e.target.closest && e.target.closest('.kd-composer-wrap[data-kd-live]')
      if (wrap) renderComposer(wrap)
    })
  }
  function initComposers(root) {
    var w = (root || document).querySelectorAll('.kd-composer-wrap[data-kd-live]')
    for (var i = 0; i < w.length; i++) renderComposer(w[i])
  }

  return {
    bird: bird,
    house: house,
    sleeperInHole: sleeperInHole,
    PROPS: PROPS,
    avatar: avatar,
    renderAvatars: renderAvatars,
    pair: pair,
    wire: wire,
  }
})()

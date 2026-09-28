;(() => {
  const panel = document.querySelector('.pairing')
  const status = document.querySelector('#pairing-status')
  const token = document.querySelector('#pairing-create [name=csrfmiddlewaretoken]')
  if (!panel || !status || !token) return
  const deadline = Date.now() + Number(panel.dataset.remaining) * 1000
  let stopped = false
  window.addEventListener('pagehide', () => {
    stopped = true
  })
  const poll = async () => {
    if (stopped) return
    if (Date.now() >= deadline) {
      status.textContent = '确认码已过期，请重新生成。'
      return
    }
    try {
      const response = await fetch(panel.dataset.pollUrl, {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { 'X-CSRFToken': token.value },
      })
      const result = await response.json()
      if (!response.ok) {
        status.textContent = result.message || '确认状态暂时不可用，请重新生成确认码。'
        return
      }
      if (result.state === 'authenticated') {
        status.textContent = '确认成功，正在进入后台…'
        window.location.assign(result.redirect)
        return
      }
      status.textContent = '等待小程序确认…'
      window.setTimeout(poll, 2000)
    } catch {
      status.textContent = '连接中断，请检查网络后刷新此页。'
    }
  }
  window.setTimeout(poll, 2000)
})()

/* Floorp Bookmark Toolbar Autoswitch. MIT licensed. */
async function initialize() {
  const workspaceBars = browser.floorpWorkspaceBars
  const compatibility = workspaceBars && await workspaceBars.getCompatibility()
  if (!compatibility?.supported) {
    console.error('Floorp Bookmark Toolbar Autoswitch requires Floorp with experimental extension APIs enabled. Firefox is not supported.')
    if (!localStorage.getItem('compatibilityNoticeShown')) {
      await browser.tabs.create({ url: browser.runtime.getURL('compatibility.html') })
      localStorage.setItem('compatibilityNoticeShown', 'true')
    }
    return
  }
  await workspaceBars.start()
}

initialize().catch(console.error)

// Bridge content script — runs in ISOLATED world.
// Listens for the custom event dispatched by the MAIN-world fetch interceptor
// and forwards the payload to the background service worker via chrome.runtime.
window.addEventListener('__hrdc_employee_data__', (event) => {
  const customEvent = event as CustomEvent<string>;
  chrome.runtime.sendMessage({
    type: 'EMPLOYEE_DATA_CAPTURED',
    payload: customEvent.detail,
  });
});

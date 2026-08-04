// Runs in MAIN world (document_start) — has direct access to the page's fetch.
// Wraps the native fetch to intercept responses from getUpdatedEmployeeData.
(function () {
  const _fetch = window.fetch;

  window.fetch = async function (...args) {
    // Determine the URL before the call so we can check it without touching
    // the Request object twice (which would break some internal state).
    const url = typeof args[0] === 'string'
      ? args[0]
      : args[0] instanceof Request
        ? args[0].url
        : String(args[0]);

    const isTarget = url.includes('getUpdatedEmployeeData');

    // Always pass through — never await before returning to the page.
    const responsePromise = _fetch.apply(this, args);

    if (isTarget) {
      responsePromise.then((response) => {
        // Clone immediately before any consumer can read the body.
        const clone = response.clone();
        clone.text().then((text) => {
          try {
            const data = JSON.parse(text);
            window.dispatchEvent(
              new CustomEvent('__hrdc_employee_data__', {
                detail: JSON.stringify(data),
              })
            );
          } catch (_) {
            // Not JSON — ignore.
          }
        }).catch(() => {
          // Body unreadable — ignore.
        });
      }).catch(() => {
        // Fetch failed/aborted — nothing to capture.
      });
    }

    return responsePromise;
  };
})();

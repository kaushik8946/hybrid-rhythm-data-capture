// Background service worker — receives the captured employee data and
// triggers a chrome.downloads save so the JSON lands on the user's disk.
chrome.runtime.onMessage.addListener((message) => {
  if (message.type !== 'EMPLOYEE_DATA_CAPTURED') {
    return;
  }

  console.log('[HRDC] Employee data received, saving...');

  try {
    // Pretty-print the JSON before saving.
    const parsed = JSON.parse(message.payload as string);
    const json = JSON.stringify(parsed, null, 2);

    // URL.createObjectURL is not available in MV3 service workers —
    // use a base64 data URI instead.
    const base64 = btoa(unescape(encodeURIComponent(json)));
    const dataUrl = `data:application/json;base64,${base64}`;

    const timestamp = new Date()
      .toISOString()
      .replace(/[:.]/g, '-')
      .slice(0, 19); // e.g. 2025-07-10T14-32-05

    chrome.downloads.download(
      {
        url: dataUrl,
        filename: `getUpdatedEmployeeData_${timestamp}.json`,
        saveAs: false,
      },
      (downloadId) => {
        if (chrome.runtime.lastError) {
          console.error('[HRDC] Download failed:', chrome.runtime.lastError.message);
        } else {
          console.log('[HRDC] Saved as download ID:', downloadId);
        }
      }
    );
  } catch (err) {
    console.error('[HRDC] Failed to save employee data:', err);
  }
});

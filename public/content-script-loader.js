// Runs in MAIN world (document_start) — has direct access to the page's
// fetch and XMLHttpRequest. Wraps both transports to intercept responses
// from getUpdatedEmployeeData, whichever one Hybrid Rhythm happens to use.
//
// Every hook is defensive: the page's own request must never fail, change
// behaviour, or throw because of anything in this file.
(function () {
  var TARGET = 'getUpdatedEmployeeData';
  var EVENT_NAME = '__hrdc_employee_data__';

  /** True when a URL is the endpoint we care about. */
  function isTarget(url) {
    return typeof url === 'string' && url.indexOf(TARGET) !== -1;
  }

  /**
   * Hand a captured payload to the ISOLATED-world bridge.
   * Accepts either a JSON string or an already-parsed value; always emits a
   * JSON string so the bridge and background see one consistent shape.
   * Non-JSON and unserialisable payloads are silently discarded.
   */
  function emit(payload) {
    try {
      var data = typeof payload === 'string' ? JSON.parse(payload) : payload;
      window.dispatchEvent(
        new CustomEvent(EVENT_NAME, { detail: JSON.stringify(data) })
      );
    } catch (_) {
      // Not JSON, or not serialisable — ignore.
    }
  }

  // -------------------------------------------------------------------------
  // fetch
  // -------------------------------------------------------------------------

  var _fetch = window.fetch;

  window.fetch = function (...args) {
    // Determine the URL before the call so we can check it without touching
    // the Request object twice (which would break some internal state).
    const url = typeof args[0] === 'string'
      ? args[0]
      : args[0] instanceof Request
        ? args[0].url
        : String(args[0]);

    const target = isTarget(url);

    // Always pass through — never await before returning to the page.
    const responsePromise = _fetch.apply(this, args);

    if (target) {
      responsePromise.then((response) => {
        // Clone immediately before any consumer can read the body.
        const clone = response.clone();
        clone.text().then(emit).catch(() => {
          // Body unreadable — ignore.
        });
      }).catch(() => {
        // Fetch failed/aborted — nothing to capture.
      });
    }

    return responsePromise;
  };

  // -------------------------------------------------------------------------
  // XMLHttpRequest
  //
  // open() records the URL on the instance; send() attaches a listener that
  // reads the response once it arrives. We use addEventListener rather than
  // assigning onload so the page's own handlers are left untouched.
  // -------------------------------------------------------------------------

  var XHR = window.XMLHttpRequest;

  if (XHR && XHR.prototype) {
    var URL_PROP = '__hrdcUrl';
    var _open = XHR.prototype.open;
    var _send = XHR.prototype.send;

    XHR.prototype.open = function (method, url) {
      try {
        // Mark the instance non-enumerably so page code that iterates over
        // the XHR object does not see our bookkeeping.
        Object.defineProperty(this, URL_PROP, {
          value: isTarget(String(url)) ? String(url) : null,
          writable: true,
          configurable: true,
          enumerable: false,
        });
      } catch (_) {
        // Frozen/exotic XHR subclass — capture is skipped, request proceeds.
      }
      return _open.apply(this, arguments);
    };

    XHR.prototype.send = function () {
      try {
        if (this[URL_PROP]) {
          var xhr = this;
          xhr.addEventListener('load', function () {
            try {
              // Reading responseText throws when responseType is set to
              // anything other than '' or 'text', so branch on it.
              var type = xhr.responseType;
              if (type === 'json') {
                emit(xhr.response);
              } else if (type === '' || type === 'text') {
                emit(xhr.responseText);
              }
              // arraybuffer/blob/document responses are not JSON — ignore.
            } catch (_) {
              // Response unreadable — ignore.
            }
          });
        }
      } catch (_) {
        // Listener could not be attached — request still proceeds untouched.
      }
      return _send.apply(this, arguments);
    };
  }
})();

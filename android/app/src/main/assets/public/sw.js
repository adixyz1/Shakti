/**
 * Copyright 2018 Google Inc. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *     http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// If the loader is already loaded, just stop.
if (!self.define) {
  let registry = {};

  // Used for `eval` and `importScripts` where we can't get script URL by other means.
  // In both cases, it's safe to use a global var because those functions are synchronous.
  let nextDefineUri;

  const singleRequire = (uri, parentUri) => {
    uri = new URL(uri + ".js", parentUri).href;
    return registry[uri] || (
      
        new Promise(resolve => {
          if ("document" in self) {
            const script = document.createElement("script");
            script.src = uri;
            script.onload = resolve;
            document.head.appendChild(script);
          } else {
            nextDefineUri = uri;
            importScripts(uri);
            resolve();
          }
        })
      
      .then(() => {
        let promise = registry[uri];
        if (!promise) {
          throw new Error(`Module ${uri} didn’t register its module`);
        }
        return promise;
      })
    );
  };

  self.define = (depsNames, factory) => {
    const uri = nextDefineUri || ("document" in self ? document.currentScript.src : "") || location.href;
    if (registry[uri]) {
      // Module is already loading or loaded.
      return;
    }
    let exports = {};
    const require = depUri => singleRequire(depUri, uri);
    const specialDeps = {
      module: { uri },
      exports,
      require
    };
    registry[uri] = Promise.all(depsNames.map(
      depName => specialDeps[depName] || require(depName)
    )).then(deps => {
      factory(...deps);
      return exports;
    });
  };
}
define(['./workbox-25613826'], (function (workbox) { 'use strict';

  self.skipWaiting();
  workbox.clientsClaim();
  /**
   * The precacheAndRoute() method efficiently caches and responds to
   * requests for URLs in the manifest.
   * See https://goo.gl/S9QRab
   */
  workbox.precacheAndRoute([{
    "url": "registerSW.js",
    "revision": "1872c500de691dce40960bb85481de07"
  }, {
    "url": "manifest.webmanifest",
    "revision": "26699b1aafa5dec58f27e371c44aca3e"
  }, {
    "url": "index.html",
    "revision": "b3460eb416912923d60794c24b40b789"
  }, {
    "url": "icon.svg",
    "revision": "046dc9e505b84cb135e701675c35566c"
  }, {
    "url": "icons/icon-512x512.png",
    "revision": "b9708131c46702edd00802efac7ecee7"
  }, {
    "url": "icons/icon-192x192.png",
    "revision": "8e15130bd891a7eed8eb169f39efd628"
  }, {
    "url": "assets/index-CtPDDIip.css",
    "revision": null
  }, {
    "url": "assets/index-BmCUeVNu.js",
    "revision": null
  }, {
    "url": "icon.svg",
    "revision": "046dc9e505b84cb135e701675c35566c"
  }, {
    "url": "manifest.webmanifest",
    "revision": "26699b1aafa5dec58f27e371c44aca3e"
  }, {
    "url": ".well-known/assetlinks.json",
    "revision": "139c009de9b3aa9c2ad03845a7cceee3"
  }, {
    "url": "icons/icon-192x192.png",
    "revision": "8e15130bd891a7eed8eb169f39efd628"
  }, {
    "url": "icons/icon-512x512.png",
    "revision": "b9708131c46702edd00802efac7ecee7"
  }], {});
  workbox.cleanupOutdatedCaches();
  workbox.registerRoute(new workbox.NavigationRoute(workbox.createHandlerBoundToURL("/index.html"), {
    denylist: [/^\/api\//, /^\/ws\//, /^\/\.well-known\//, /\.apk$/i]
  }));
  workbox.registerRoute(({
    request,
    url
  }) => !url.pathname.startsWith("/api/") && (request.destination === "image" || request.destination === "font" || /\.(?:png|jpg|jpeg|svg|gif|webp|ico|woff2?)$/i.test(url.pathname)), new workbox.CacheFirst({
    "cacheName": "saathi-static-assets-cache-first",
    plugins: [new workbox.ExpirationPlugin({
      maxEntries: 60,
      maxAgeSeconds: 2592000
    })]
  }), 'GET');

}));

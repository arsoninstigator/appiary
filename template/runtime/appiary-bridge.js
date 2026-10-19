/**
 * appiary runtime bridge. this file is copied into the app's web assets at
 * build time with a config line prepended (window.__appiaryConfig), and a
 * script tag is injected as the first thing in the user's index.html head.
 *
 * everything is vanilla on purpose: the user's web app may run inside or
 * outside the native shell, and on any bundler or none. all surfaces are
 * fail-soft: outside the shell they return safe defaults instead of
 * throwing, so the same web code runs on the open web untouched.
 *
 * surfaces:
 * - appiary.channel / version / buildNumber: distribution channel and
 *   version identity (window.appiary.channel === 'samsung' etc.)
 * - appiary.push: register(), token, onMessage(payload) for foreground
 *   rendering, onTap(payload) for cold-start routing
 * - appiary.local: schedule/cancel notifications, onMessage while the app
 *   is foregrounded
 * - appiary.permissions: state(id) and request(id) with normalized states
 *   granted | prompt | blocked | unknown
 * - appiary.updates.check(): direct-channel version check against the
 *   user's own endpoint; the user's ui decides what to show
 */
;(function () {
  var cfg = window.__appiaryConfig || {}
  var cap = window.Capacitor || {}
  var plugins = cap.Plugins || {}
  var native = !!(cap.isNativePlatform && cap.isNativePlatform())

  function normalizeState(s) {
    if (s === 'granted') return 'granted'
    if (s === 'prompt') return 'prompt'
    /* 'denied' on ios and 'prompt-with-rationale' on android both mean:
       the os will not show the dialog again without settings. */
    if (s === 'denied' || s === 'prompt-with-rationale' || s === 'blocked') return 'blocked'
    return 'unknown'
  }

  var surface = {
    camera: function () { return plugins.Camera },
    photoLibrary: function () { return plugins.Camera },
    microphone: function () { return null },
    location: function () { return plugins.Geolocation },
    push: function () { return plugins.PushNotifications }
  }

  var appiary = {
    native: native,
    channel: cfg.channel || 'web',
    version: cfg.version || null,
    buildNumber: cfg.buildNumber || null,

    push: {
      register: function () {
        var p = plugins.PushNotifications
        if (!p) return Promise.resolve(null)
        return p.requestPermissions().then(function () { return p.register() })
      },
      token: function (cb) {
        var p = plugins.PushNotifications
        if (!p) return
        p.addListener('registration', function (e) { cb(e.value) })
      },
      /** foreground payloads: the system stays quiet while the app is open,
          the web app renders this in its own in-app notification ui */
      onMessage: function (cb) {
        var p = plugins.PushNotifications
        if (!p) return
        p.addListener('pushNotificationReceived', function (e) { cb(e.data || e) })
      },
      /** taps (including cold starts) arrive here for deep-link routing */
      onTap: function (cb) {
        var p = plugins.PushNotifications
        if (!p) return
        p.addListener('pushNotificationActionPerformed', function (e) { cb((e.action && e.action.data) || e.data) })
      }
    },

    local: {
      schedule: function (n) {
        var p = plugins.LocalNotifications
        if (!p) return Promise.resolve(null)
        return p.schedule({ notifications: [n] })
      },
      cancel: function (id) {
        var p = plugins.LocalNotifications
        if (!p) return Promise.resolve(null)
        return p.cancel({ notifications: [{ id: id }] })
      },
      onMessage: function (cb) {
        var p = plugins.LocalNotifications
        if (!p) return
        p.addListener('localNotificationReceived', function (e) { cb(e) })
      }
    },

    permissions: {
      /** normalized os state; 'blocked' means feature gating should fall
          back, not re-ask */
      state: function (id) {
        var plugin = surface[id] ? surface[id]() : undefined
        if (id === 'microphone') {
          if (!navigator.permissions || !navigator.permissions.query) {
            return Promise.resolve('unknown')
          }
          return navigator.permissions.query({ name: 'microphone' })
            .then(function (r) { return normalizeState(r.state === 'prompt' ? 'prompt' : r.state) })
            .catch(function () { return 'unknown' })
        }
        if (!plugin || !plugin.checkPermissions) return Promise.resolve(native ? 'unknown' : 'granted')
        return plugin.checkPermissions().then(function (states) {
          var key = ({
            camera: 'camera', photoLibrary: 'photos', location: 'location', push: 'receive'
          })[id]
          return normalizeState(states[key])
        })
      },
      request: function (id) {
        var plugin = surface[id] ? surface[id]() : undefined
        if (id === 'microphone') {
          if (!navigator.mediaDevices) return Promise.resolve('unknown')
          return navigator.mediaDevices.getUserMedia({ audio: true })
            .then(function (s) { s.getTracks().forEach(function (t) { t.stop() }); return 'granted' })
            .catch(function (e) { return e && e.name === 'NotFoundError' ? 'unknown' : 'blocked' })
        }
        if (!plugin || !plugin.requestPermissions) return Promise.resolve(native ? 'unknown' : 'granted')
        return plugin.requestPermissions().then(function () {
          return appiary.permissions.state(id)
        })
      }
    },

    updates: {
      /** direct-channel updater: fetch the user's endpoint, compare against
          the baked-in build number, let their ui decide what to show.
          the endpoint returns { buildNumber, url, note }. */
      check: function () {
        if (!cfg.updateCheckUrl) return Promise.resolve({ available: false, reason: 'no-check-url' })
        return fetch(cfg.updateCheckUrl, { cache: 'no-store' })
          .then(function (r) {
            if (!r.ok) throw new Error('update endpoint returned ' + r.status)
            return r.json()
          })
          .then(function (d) {
            var remote = Number(d.buildNumber)
            var newer = Number.isFinite(remote) && remote > Number(cfg.buildNumber)
            return { available: newer, buildNumber: remote || null, url: d.url || null, note: d.note || null }
          })
          .catch(function (e) {
            return { available: false, reason: e.message }
          })
      }
    }
  }

  window.appiary = appiary
})()

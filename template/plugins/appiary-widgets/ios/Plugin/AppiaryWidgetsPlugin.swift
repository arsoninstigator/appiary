import Foundation
import Capacitor

/**
 * the staged ios data surface for home-screen widgets. set/clear write the
 * app's data snapshot to userdefaults; the widgetkit extension target that
 * renders it is the follow-up step (extension target generation needs
 * pbxproj surgery verified on a real mac runner). honest state: the data
 * half exists, the pixels half does not yet, and the docs say so.
 */
@objc(AppiaryWidgetsPlugin)
public class AppiaryWidgetsPlugin: CAPPlugin {
  static let key = "appiary_widget_data"

  @objc func set(_ call: CAPPluginCall) {
    let title = call.getString("title") ?? ""
    let body = call.getString("body") ?? ""
    let kind = call.getString("kind") ?? "default"
    let snapshot: [String: Any] = [
      "title": title,
      "body": body,
      "kind": kind,
      "updatedAt": Date().timeIntervalSince1970 * 1000
    ]
    UserDefaults.standard.set(snapshot, forKey: AppiaryWidgetsPlugin.key)
    call.resolve(["set": true])
  }

  @objc func clear(_ call: CAPPluginCall) {
    UserDefaults.standard.removeObject(forKey: AppiaryWidgetsPlugin.key)
    call.resolve()
  }

  @objc func get(_ call: CAPPluginCall) {
    if let snapshot = UserDefaults.standard.dictionary(forKey: AppiaryWidgetsPlugin.key) {
      var out: [String: Any] = snapshot
      out["set"] = true
      call.resolve(out)
    } else {
      call.resolve(["set": false])
    }
  }
}

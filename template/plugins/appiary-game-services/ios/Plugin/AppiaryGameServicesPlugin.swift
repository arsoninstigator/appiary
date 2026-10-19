import Foundation
import Capacitor
import GameKit

/**
 * apple game center, the ios half of the gameServices capability.
 * the game-center entitlement is injected at build time when the
 * capability is declared (entitlementsFor in src/permissions.js).
 *
 * api verified against the gamekit docs; the first real game build is
 * its compile test.
 */
@objc(AppiaryGameServicesPlugin)
public class AppiaryGameServicesPlugin: CAPPlugin, CAPBridgedPlugin {
  public let identifier = "AppiaryGameServices"
  public let jsName = "AppiaryGameServices"
  public let pluginMethods: [CAPBridgedPluginMethod] = [
    CAPBridgedPluginMethod(resultSetType: nil, name: "signIn"),
    CAPBridgedPluginMethod(resultSetType: nil, name: "unlock"),
    CAPBridgedPluginMethod(resultSetType: nil, name: "increment"),
    CAPBridgedPluginMethod(resultSetType: nil, name: "submitScore"),
    CAPBridgedPluginMethod(resultSetType: nil, name: "playerInfo"),
    CAPBridgedPluginMethod(resultSetType: nil, name: "showAchievements"),
    CAPBridgedPluginMethod(resultSetType: nil, name: "showLeaderboards")
  ]

  private var authenticated = false

  @objc func signIn(_ call: CAPPluginCall) {
    let player = GKLocalPlayer.local
    player.authenticateHandler = { [weak self] vc, error in
      if let vc = vc {
        self?.bridge?.viewController?.present(vc, animated: true) {
          call.resolve(["authenticated": GKLocalPlayer.local.isAuthenticated])
        }
      } else {
        self?.authenticated = player.isAuthenticated
        call.resolve(["authenticated": player.isAuthenticated])
      }
    }
  }

  @objc func unlock(_ call: CAPPluginCall) {
    guard let achievementId = call.getString("achievementId") else {
      call.reject("achievementId is required")
      return
    }
    let achievement = GKAchievement(identifier: achievementId)
    achievement.percentComplete = 100.0
    achievement.showsCompletionBanner = true
    GKAchievement.report([achievement]) { error in
      if let error = error { call.reject("unlock failed: \(error.localizedDescription)") }
      else { call.resolve() }
    }
  }

  @objc func increment(_ call: CAPPluginCall) {
    // game center achievements are percent-based, not step-based; map
    // steps onto percentComplete additively (declared per-game by the owner).
    guard let achievementId = call.getString("achievementId"),
          let steps = call.getDouble("steps") else {
      call.reject("achievementId and steps are required")
      return
    }
    let achievement = GKAchievement(identifier: achievementId)
    achievement.percentComplete = min(100.0, achievement.percentComplete + steps)
    GKAchievement.report([achievement]) { error in
      if let error = error { call.reject("increment failed: \(error.localizedDescription)") }
      else { call.resolve() }
    }
  }

  @objc func submitScore(_ call: CAPPluginCall) {
    guard let leaderboardId = call.getString("leaderboardId") else {
      call.reject("leaderboardId is required")
      return
    }
    let score = GKScore(leaderboardIdentifier: leaderboardId)
    score.value = Int64(call.getDouble("score") ?? 0)
    GKScore.report([score]) { error in
      if let error = error { call.reject("score submit failed: \(error.localizedDescription)") }
      else { call.resolve() }
    }
  }

  @objc func playerInfo(_ call: CAPPluginCall) {
    let player = GKLocalPlayer.local
    if !player.isAuthenticated {
      call.reject("not signed in")
      return
    }
    player.loadPhoto(size: .normal) { [weak player] image, _ in
      call.resolve([
        "id": player?.gamePlayerID ?? "",
        "displayName": player?.displayName ?? "",
        "title": player?.title ?? ""
      ])
    }
  }

  private func presentGameCenter(_ call: CAPPluginCall, state: GKGameCenterViewControllerState) {
    let vc = GKGameCenterViewController()
    vc.gameCenterDelegate = self
    vc.viewState = state
    bridge?.viewController?.present(vc, animated: true)
    call.resolve()
  }

  @objc func showAchievements(_ call: CAPPluginCall) {
    presentGameCenter(call, state: .achievements)
  }

  @objc func showLeaderboards(_ call: CAPPluginCall) {
    presentGameCenter(call, state: .leaderboards)
  }
}

extension AppiaryGameServicesPlugin: GKGameCenterControllerDelegate {
  public func gameCenterViewControllerDidFinish(_ viewController: GKGameCenterViewController) {
    viewController.dismiss(animated: true)
  }
}

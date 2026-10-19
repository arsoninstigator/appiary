export interface AppiaryGameServicesPlugin {
  signIn(): Promise<{ authenticated: boolean }>
  unlock(options: { achievementId: string }): Promise<void>
  increment(options: { achievementId: string, steps: number }): Promise<void>
  submitScore(options: { leaderboardId: string, score: number }): Promise<void>
  playerInfo(): Promise<{ id: string, displayName: string, title: string }>
  showAchievements(): Promise<void>
  showLeaderboards(): Promise<void>
}
declare const AppiaryGameServices: AppiaryGameServicesPlugin
export { AppiaryGameServices }

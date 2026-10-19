package appiary.game.services;

import android.app.Activity;
import android.content.Intent;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import com.google.android.gms.games.AchievementsClient;
import com.google.android.gms.games.LeaderboardsClient;
import com.google.android.gms.games.PlayGames;
import com.google.android.gms.games.PlayersClient;

/**
 * google play games v2. sign-in state is checked silently; the v2 sdk
 * surfaces the play games account picker through the play store itself
 * when explicit sign-in is needed. play games initialization happens in
 * MainActivity.onCreate (patchMainActivityGames).
 *
 * api verified against the play games v2 developer docs; the first real
 * game build is its compile test.
 */
@CapacitorPlugin(name = "AppiaryGameServices")
public class AppiaryGameServicesPlugin extends Plugin {

  @PluginMethod
  public void signIn(final PluginCall call) {
    Activity activity = getActivity();
    if (activity == null) {
      call.reject("no activity");
      return;
    }
    try {
      PlayGames.getGamesSignInClient(activity).isAuthenticated()
        .addOnCompleteListener(task -> {
          boolean signedIn = task.isSuccessful() && task.getResult().isAuthenticated();
          if (signedIn) {
            JSObject ret = new JSObject();
            ret.put("authenticated", true);
            call.resolve(ret);
          } else {
            PlayGames.getGamesSignInClient(activity).signIn()
              .addOnCompleteListener(signInTask -> {
                JSObject ret = new JSObject();
                ret.put("authenticated", signInTask.isSuccessful() && signInTask.getResult().isAuthenticated());
                call.resolve(ret);
              });
          }
        });
    } catch (Exception e) {
      call.reject("play games sign-in failed: " + e.getMessage());
    }
  }

  @PluginMethod
  public void unlock(PluginCall call) {
    String achievementId = call.getString("achievementId");
    if (achievementId == null) {
      call.reject("achievementId is required");
      return;
    }
    AchievementsClient client = PlayGames.getAchievementsClient(getActivity());
    client.unlockImmediate(achievementId)
      .addOnSuccessListener(r -> call.resolve())
      .addOnFailureListener(e -> call.reject("unlock failed: " + e.getMessage()));
  }

  @PluginMethod
  public void increment(PluginCall call) {
    String achievementId = call.getString("achievementId");
    Integer steps = call.getInt("steps", 1);
    if (achievementId == null) {
      call.reject("achievementId is required");
      return;
    }
    AchievementsClient client = PlayGames.getAchievementsClient(getActivity());
    client.incrementImmediate(achievementId, steps)
      .addOnSuccessListener(r -> call.resolve())
      .addOnFailureListener(e -> call.reject("increment failed: " + e.getMessage()));
  }

  @PluginMethod
  public void submitScore(PluginCall call) {
    String leaderboardId = call.getString("leaderboardId");
    Integer score = call.getInt("score", 0);
    if (leaderboardId == null) {
      call.reject("leaderboardId is required");
      return;
    }
    LeaderboardsClient client = PlayGames.getLeaderboardsClient(getActivity());
    client.submitScoreImmediate(leaderboardId, score)
      .addOnSuccessListener(r -> call.resolve())
      .addOnFailureListener(e -> call.reject("score submit failed: " + e.getMessage()));
  }

  @PluginMethod
  public void playerInfo(PluginCall call) {
    PlayersClient client = PlayGames.getPlayersClient(getActivity());
    client.getCurrentPlayer()
      .addOnSuccessListener(player -> {
        JSObject ret = new JSObject();
        ret.put("id", player.getPlayerId());
        ret.put("displayName", player.getDisplayName());
        ret.put("title", player.getTitle() == null ? "" : player.getTitle());
        call.resolve(ret);
      })
      .addOnFailureListener(e -> call.reject("player info failed: " + e.getMessage()));
  }

  @PluginMethod
  public void showAchievements(PluginCall call) {
    AchievementsClient client = PlayGames.getAchievementsClient(getActivity());
    client.getAchievementsIntent()
      .addOnSuccessListener(intent -> {
        startActivityForResult(call, intent, "achievementsResult");
      })
      .addOnFailureListener(e -> call.reject("achievements ui failed: " + e.getMessage()));
  }

  @PluginMethod
  public void showLeaderboards(PluginCall call) {
    LeaderboardsClient client = PlayGames.getLeaderboardsClient(getActivity());
    client.getAllLeaderboardsIntent()
      .addOnSuccessListener(intent -> {
        startActivityForResult(call, intent, "leaderboardsResult");
      })
      .addOnFailureListener(e -> call.reject("leaderboards ui failed: " + e.getMessage()));
  }
}

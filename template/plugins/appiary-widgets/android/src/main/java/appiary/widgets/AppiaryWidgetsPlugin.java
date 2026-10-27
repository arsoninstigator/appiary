package appiary.widgets;

import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.appwidget.AppWidgetManager;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONObject;

/**
 * the data half of home-screen widgets: the webview app calls
 * appiary.widget.set() while it is alive, and the snapshot lands in
 * shared storage the widget provider reads while the webview is dead.
 * android half is fully real: the receiver in this module's manifest
 * registers the provider, so declaring the widgets capability at intake
 * is all an app needs.
 */
@CapacitorPlugin(name = "AppiaryWidgets")
public class AppiaryWidgetsPlugin extends Plugin {

  static final String PREFS = "appiary_widget";
  static final String KEY = "data";

  /** read the current snapshot (also used by the provider). */
  public static JSONObject readData(Context context) {
    SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    String raw = prefs.getString(KEY, null);
    if (raw == null) return null;
    try {
      return new JSONObject(raw);
    } catch (org.json.JSONException e) {
      return null;
    }
  }

  static void writeData(Context context, JSONObject data) {
    SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    prefs.edit().putString(KEY, data.toString()).apply();
  }

  /** nudge the provider so an in-session set() shows up on the home screen
   *  immediately (updatePeriodSeconds alone would lag up to 30 min). */
  static void refreshWidgets(Context context) {
    AppWidgetManager manager = AppWidgetManager.getInstance(context);
    ComponentName provider = new ComponentName(context, AppiaryWidgetProvider.class);
    int[] ids = manager.getAppWidgetIds(provider);
    if (ids == null || ids.length == 0) return;
    Intent update = new Intent(context, AppiaryWidgetProvider.class);
    update.setAction(AppWidgetManager.ACTION_APPWIDGET_UPDATE);
    update.putExtra(AppWidgetManager.EXTRA_APPWIDGET_IDS, ids);
    context.sendBroadcast(update);
  }

  @PluginMethod
  public void set(PluginCall call) {
    String title = call.getString("title", "");
    String body = call.getString("body", "");
    String kind = call.getString("kind", "default");
    JSONObject data = new JSONObject();
    try {
      data.put("title", title);
      data.put("body", body);
      data.put("kind", kind);
      data.put("updatedAt", System.currentTimeMillis());
      writeData(getContext(), data);
    } catch (org.json.JSONException e) {
      call.reject("widget data serialization failed");
      return;
    }
    refreshWidgets(getContext());
    JSObject out = new JSObject();
    out.put("set", true);
    out.put("updatedAt", System.currentTimeMillis());
    call.resolve(out);
  }

  @PluginMethod
  public void clear(PluginCall call) {
    SharedPreferences prefs = getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    prefs.edit().remove(KEY).apply();
    refreshWidgets(getContext());
    call.resolve();
  }

  @PluginMethod
  public void get(PluginCall call) {
    JSONObject data = readData(getContext());
    JSObject out = new JSObject();
    if (data != null) {
      out.put("title", data.opt("title"));
      out.put("body", data.opt("body"));
      out.put("kind", data.opt("kind"));
      out.put("updatedAt", data.opt("updatedAt"));
      out.put("set", true);
    } else {
      out.put("set", false);
    }
    call.resolve(out);
  }
}

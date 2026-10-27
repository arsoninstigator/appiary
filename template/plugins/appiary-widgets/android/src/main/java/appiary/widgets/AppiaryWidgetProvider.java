package appiary.widgets;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.widget.RemoteViews;

import org.json.JSONObject;

/**
 * the pixels half: renders the app's last data snapshot (or an honest
 * placeholder when the app has not written one yet). the webview cannot
 * be consulted here - it is dead when the home screen redraws - so the
 * snapshot in shared storage is the single source of truth.
 */
public class AppiaryWidgetProvider extends AppWidgetProvider {

  @Override
  public void onUpdate(Context context, AppWidgetManager manager, int[] appWidgetIds) {
    JSONObject data = AppiaryWidgetsPlugin.readData(context);
    for (int id : appWidgetIds) {
      RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.appiary_widget);
      if (data != null) {
        views.setTextViewText(R.id.widget_title, data.optString("title", ""));
        views.setTextViewText(R.id.widget_body, data.optString("body", ""));
      } else {
        views.setTextViewText(R.id.widget_title, "appiary");
        views.setTextViewText(R.id.widget_body, "open the app once to feed me data");
      }
      manager.updateAppWidget(id, views);
    }
  }
}

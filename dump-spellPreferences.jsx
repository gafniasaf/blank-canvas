// Dump keys of app.spellPreferences (ExtendScript) for exploration.

var out = [];
if (!app.spellPreferences) {
  out.push("ERROR: app.spellPreferences not available");
} else {
  out.push("spellPreferences type=" + app.spellPreferences.constructor.name);
  var props = null;
  try { props = app.spellPreferences.properties; } catch (e0) { props = null; }
  if (!props) {
    out.push("No .properties");
  } else {
    var keys = [];
    for (var k in props) keys.push(k);
    keys.sort();
    out.push("keys=" + keys.length);
    for (var i = 0; i < Math.min(200, keys.length); i++) {
      out.push(keys[i] + "=" + String(props[keys[i]]));
    }
    if (keys.length > 200) out.push("...truncated...");
  }
}

out.join("\n");



































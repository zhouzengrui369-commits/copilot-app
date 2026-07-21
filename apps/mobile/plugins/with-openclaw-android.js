const { AndroidConfig, withAndroidManifest } = require("expo/config-plugins");

module.exports = function withOpenClawAndroid(config) {
  return withAndroidManifest(config, (config) => {
    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(config.modResults);
    application.$ = application.$ || {};
    application.$["android:usesCleartextTraffic"] = "true";
    return config;
  });
};

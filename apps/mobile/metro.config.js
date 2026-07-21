const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

config.watchFolders = [];
config.resolver.nodeModulesPaths = [
  path.resolve(__dirname, "node_modules"),
  path.resolve(__dirname, "../../node_modules"),
];
config.resolver.extraNodeModules = {
  ...(config.resolver.extraNodeModules || {}),
  "react-is": path.resolve(__dirname, "../../node_modules/react-is"),
};
config.resolver.disableHierarchicalLookup = true;
config.resolver.useWatchman = false;

module.exports = config;
